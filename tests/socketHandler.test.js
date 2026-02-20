'use strict';

/**
 * Socket integration tests for socketHandlers.js
 *
 * A real HTTP + Socket.io server is spun up on a random port before the suite.
 * Each test creates fresh socket clients and tears them down in afterEach.
 * Because Jest isolates module state per test file, the roomManager Map starts
 * empty, so we can also reach into it directly (via `require('../roomManager')`)
 * to set up specific game-state scenarios without going through the full flow.
 */

const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { io: ClientIO } = require('socket.io-client');
const { registerSocketHandlers } = require('../socketHandlers');
const rm = require('../roomManager');

// ─── Server Lifecycle ─────────────────────────────────────────────────────────

let httpServer, ioServer, serverPort;
const liveClients = [];

beforeAll((done) => {
  httpServer = createServer();
  ioServer = new Server(httpServer, { cors: { origin: '*' } });
  ioServer.on('connection', (socket) => registerSocketHandlers(ioServer, socket));
  httpServer.listen(0, () => {
    serverPort = httpServer.address().port;
    done();
  });
});

afterAll(async () => {
  liveClients.forEach((c) => { try { c.disconnect(); } catch (_) {} });
  await new Promise((resolve) => ioServer.close(resolve));
  await new Promise((resolve) => {
    try { httpServer.close(resolve); } catch (_) { resolve(); }
  });
});

afterEach((done) => {
  // Disconnect all clients created during the test, then wait a tick so
  // the server's `disconnect` handler has time to clean up room state.
  while (liveClients.length) liveClients.pop().disconnect();
  setTimeout(done, 80);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a connected socket.io client and register it for teardown. */
function connect() {
  const client = ClientIO(`http://localhost:${serverPort}`, {
    forceNew: true,
    autoConnect: true,
  });
  liveClients.push(client);
  return client;
}

/**
 * Wait for a specific event on a socket.
 * Rejects if the event does not fire within `timeout` ms.
 */
function on(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timeout waiting for "${event}" on socket ${socket.id}`)),
      timeout
    );
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

/**
 * Helper: host creates a room, optional guests join, host starts the game, all
 * players complete the peek phase.  Returns { host, guests, roomCode, currentTurn }.
 * `guests` is an array of socket clients (length = numPlayers - 1).
 */
async function setupGame(numPlayers = 2) {
  const host = connect();
  const guests = [];
  for (let i = 1; i < numPlayers; i++) guests.push(connect());

  // Host creates room
  const roomCreated = on(host, 'room-created');
  host.emit('host-game', { playerName: 'Alice' });
  const { roomCode } = await roomCreated;

  // Guests join
  for (let i = 0; i < guests.length; i++) {
    const joined = on(guests[i], 'room-joined');
    guests[i].emit('join-game', { playerName: `Player${i + 2}`, roomCode });
    await joined;
  }

  // Start game — every client gets cards-dealt
  const allDealt = Promise.all([host, ...guests].map((c) => on(c, 'cards-dealt')));
  host.emit('start-game');
  await allDealt;

  // Peek phase — phase-changed fires once all players emit peek-done
  const phasePlay = on(host, 'phase-changed');
  [host, ...guests].forEach((c) => c.emit('peek-done'));
  const { currentTurn } = await phasePlay;

  return { host, guests, roomCode, currentTurn };
}

/**
 * Identify which client's socket.id matches `currentTurn`.
 * Returns { active, idle } — the acting player and all others.
 */
function splitByTurn(host, guests, currentTurn) {
  const all = [host, ...guests];
  const active = all.find((c) => c.id === currentTurn);
  const idle = all.filter((c) => c.id !== currentTurn);
  return { active, idle };
}

// ─── Room Management ──────────────────────────────────────────────────────────

describe('Room creation and joining (socket)', () => {
  test('host-game → room-created with roomCode and player info', async () => {
    const client = connect();
    const p = on(client, 'room-created');
    client.emit('host-game', { playerName: 'Alice' });
    const data = await p;

    expect(data.roomCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(data.you.name).toBe('Alice');
    expect(data.you.isHost).toBe(true);
  });

  test('join-game → room-joined for joiner, player-list-updated for host', async () => {
    const host = connect();
    const guest = connect();

    const created = on(host, 'room-created');
    host.emit('host-game', { playerName: 'Alice' });
    const { roomCode } = await created;

    const [guestJoined, hostUpdate] = await Promise.all([
      on(guest, 'room-joined'),
      on(host, 'player-list-updated'),
      (async () => {
        guest.emit('join-game', { playerName: 'Bob', roomCode });
      })(),
    ]);

    expect(guestJoined.roomCode).toBe(roomCode);
    expect(guestJoined.you.name).toBe('Bob');
    expect(hostUpdate.players).toHaveLength(2);
  });

  test('join-game → join-error when game is in progress', async () => {
    const { roomCode } = await setupGame(2);
    const late = connect();
    const err = on(late, 'join-error');
    late.emit('join-game', { playerName: 'Latecomer', roomCode });
    const data = await err;
    expect(data.message).toMatch(/in progress/i);
  });

  test('join-game → join-error on duplicate name', async () => {
    const host = connect();
    const guest = connect();

    const created = on(host, 'room-created');
    host.emit('host-game', { playerName: 'Alice' });
    const { roomCode } = await created;

    const err = on(guest, 'join-error');
    guest.emit('join-game', { playerName: 'Alice', roomCode }); // duplicate
    const data = await err;
    expect(data.message).toMatch(/name already taken/i);
  });
});

// ─── Game Start & Peek Phase ──────────────────────────────────────────────────

describe('Game start and peek phase (socket)', () => {
  test('start-game → every player receives cards-dealt with 4 private cards', async () => {
    const host = connect();
    const guest = connect();

    const created = on(host, 'room-created');
    host.emit('host-game', { playerName: 'Alice' });
    const { roomCode } = await created;

    const joined = on(guest, 'room-joined');
    guest.emit('join-game', { playerName: 'Bob', roomCode });
    await joined;

    const [hostCards, guestCards] = await Promise.all([
      on(host, 'cards-dealt'),
      on(guest, 'cards-dealt'),
      (async () => host.emit('start-game'))(),
    ]);

    expect(hostCards.myCards).toHaveLength(4);
    expect(guestCards.myCards).toHaveLength(4);
    // Each player's private cards should differ (overwhelmingly likely)
    const hostIds = hostCards.myCards.map((c) => c.id).sort().join();
    const guestIds = guestCards.myCards.map((c) => c.id).sort().join();
    expect(hostIds).not.toBe(guestIds);
  });

  test('peek-done from all players → phase-changed to "play"', async () => {
    const host = connect();
    const guest = connect();

    const created = on(host, 'room-created');
    host.emit('host-game', { playerName: 'Alice' });
    const { roomCode } = await created;

    const joined = on(guest, 'room-joined');
    guest.emit('join-game', { playerName: 'Bob', roomCode });
    await joined;

    const allDealt = Promise.all([on(host, 'cards-dealt'), on(guest, 'cards-dealt')]);
    host.emit('start-game');
    await allDealt;

    const phaseChanged = on(host, 'phase-changed');
    host.emit('peek-done');
    guest.emit('peek-done');
    const { phase } = await phaseChanged;
    expect(phase).toBe('play');
  });

  test('phase stays "peek" until all players have peeked', async () => {
    const host = connect();
    const guest = connect();

    const created = on(host, 'room-created');
    host.emit('host-game', { playerName: 'Alice' });
    const { roomCode } = await created;

    const joined = on(guest, 'room-joined');
    guest.emit('join-game', { playerName: 'Bob', roomCode });
    await joined;

    const allDealt = Promise.all([on(host, 'cards-dealt'), on(guest, 'cards-dealt')]);
    host.emit('start-game');
    await allDealt;

    // Only host peeks
    host.emit('peek-done');

    // Give server time to process
    await new Promise((r) => setTimeout(r, 100));
    const room = rm.getRoomByCode(roomCode);
    expect(room.gameState.phase).toBe('peek');
  });
});

// ─── Draw Card ────────────────────────────────────────────────────────────────

describe('Draw card (socket)', () => {
  test('draw-card → card-drawn (private) and opponent-drew (broadcast)', async () => {
    const { host, guests, currentTurn } = await setupGame(2);
    const [guest] = guests;
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const [drawn, opponentDrew] = await Promise.all([
      on(active, 'card-drawn'),
      on(idleClient, 'opponent-drew'),
      (async () => active.emit('draw-card'))(),
    ]);

    expect(drawn.card).toHaveProperty('suit');
    expect(drawn.card).toHaveProperty('rank');
    expect(opponentDrew.playerId).toBe(active.id);
  });

  test('wrong player drawing emits nothing (no card-drawn)', async () => {
    const { host, guests, currentTurn } = await setupGame(2);
    const { idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    let received = false;
    idleClient.once('card-drawn', () => { received = true; });
    idleClient.emit('draw-card');

    await new Promise((r) => setTimeout(r, 150));
    expect(received).toBe(false);
  });

  test('drawing twice on the same turn emits nothing the second time', async () => {
    const { host, guests, currentTurn } = await setupGame(2);
    const { active } = splitByTurn(host, guests, currentTurn);

    await new Promise((resolve) => {
      active.once('card-drawn', resolve);
      active.emit('draw-card');
    });

    let received = false;
    active.once('card-drawn', () => { received = true; });
    active.emit('draw-card');

    await new Promise((r) => setTimeout(r, 150));
    expect(received).toBe(false);
  });
});

// ─── Keep & Discard ───────────────────────────────────────────────────────────

describe('Keep drawn card (socket)', () => {
  test('keep-card → hand-updated (private), card-discarded + turn-update (broadcast)', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    // Draw first
    const drawn = await new Promise((resolve) => {
      active.once('card-drawn', resolve);
      active.emit('draw-card');
    });

    const [handUpdate, cardDiscarded, turnUpdate] = await Promise.all([
      on(active, 'hand-updated'),
      on(idleClient, 'card-discarded'),
      on(idleClient, 'turn-update'),
      (async () => active.emit('keep-card', { handIndex: 0 }))(),
    ]);

    expect(handUpdate.myCards).toHaveLength(4);
    expect(cardDiscarded.playerId).toBe(active.id);
    expect(turnUpdate.currentTurn).toBe(idleClient.id);
  });
});

describe('Discard drawn card (socket)', () => {
  test('discard-card with no rule → card-discarded + turn-update (no execute-rule)', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    // Inject a low card (no rule) so we know no rule triggers
    const room = rm.getRoomByCode(roomCode);
    room.gameState.drawnCard = { suit: 'hearts', rank: '2', id: 'h-2-test-discard' };
    room.gameState.drawnBy = active.id;

    const [cardDiscarded, turnUpdate] = await Promise.all([
      on(idleClient, 'card-discarded'),
      on(idleClient, 'turn-update'),
      (async () => active.emit('discard-card'))(),
    ]);

    expect(cardDiscarded.card.rank).toBe('2');
    expect(turnUpdate.currentTurn).toBe(idleClient.id);
  });

  test('discard-card with a rule card → execute-rule emitted to active player', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active } = splitByTurn(host, guests, currentTurn);

    // Inject a rule card (7 = peek-own)
    const room = rm.getRoomByCode(roomCode);
    room.gameState.drawnCard = { suit: 'hearts', rank: '7', id: 'h-7-rule' };
    room.gameState.drawnBy = active.id;

    const [ruleEvent] = await Promise.all([
      on(active, 'execute-rule'),
      (async () => active.emit('discard-card'))(),
    ]);

    expect(ruleEvent.ruleType).toBe('peek-own');
  });
});

// ─── Rule: Skip ───────────────────────────────────────────────────────────────

describe('Skip rule (socket)', () => {
  test('skip-rule → action-log broadcast + turn advances', async () => {
    const { host, guests, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const [log, turnUpdate] = await Promise.all([
      on(idleClient, 'action-log'),
      on(idleClient, 'turn-update'),
      (async () => active.emit('skip-rule'))(),
    ]);

    expect(log.message).toMatch(/skipped/i);
    expect(turnUpdate.currentTurn).toBe(idleClient.id);
  });
});

// ─── Rule: Peek Own (7/8) ─────────────────────────────────────────────────────

describe('Peek own card rule (socket)', () => {
  test('use-peek-own → peek-result sent privately to acting player', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active } = splitByTurn(host, guests, currentTurn);

    const [peekResult] = await Promise.all([
      on(active, 'peek-result'),
      (async () => active.emit('use-peek-own', { handIndex: 0 }))(),
    ]);

    expect(peekResult.card).toHaveProperty('suit');
    expect(peekResult.handIndex).toBe(0);
  });

  test('finish-peek → turn advances', async () => {
    const { host, guests, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const turnUpdate = on(idleClient, 'turn-update');
    active.emit('finish-peek');
    const data = await turnUpdate;
    expect(data.currentTurn).toBe(idleClient.id);
  });
});

// ─── Rule: Peek Other (9/10) ──────────────────────────────────────────────────

describe('Peek other card rule (socket)', () => {
  test('use-peek-other → peek-result with targetPlayerId', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const [peekResult] = await Promise.all([
      on(active, 'peek-result'),
      (async () =>
        active.emit('use-peek-other', { targetPlayerId: idleClient.id, handIndex: 0 }))(),
    ]);

    expect(peekResult.card).toHaveProperty('suit');
    expect(peekResult.targetPlayerId).toBe(idleClient.id);
  });
});

// ─── Rule: Blind Switch (J/Q) ─────────────────────────────────────────────────

describe('Blind switch rule (socket)', () => {
  test('use-blind-switch → hand-updated for both players, cards-highlighted, turn-update', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const [activeHand, idleHand, highlighted, turnUpdate] = await Promise.all([
      on(active, 'hand-updated'),
      on(idleClient, 'hand-updated'),
      on(active, 'cards-highlighted'),
      on(idleClient, 'turn-update'),
      (async () =>
        active.emit('use-blind-switch', {
          playerAId: active.id,
          indexA: 0,
          playerBId: idleClient.id,
          indexB: 0,
        }))(),
    ]);

    expect(activeHand.myCards).toHaveLength(4);
    expect(idleHand.myCards).toHaveLength(4);
    expect(highlighted.type).toBe('switch');
    expect(highlighted.cards).toHaveLength(2);
    expect(turnUpdate.currentTurn).toBe(idleClient.id);
  });

  test('switch actually exchanges the cards in server state', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const room = rm.getRoomByCode(roomCode);
    const cardA = room.gameState.hands[active.id][1];
    const cardB = room.gameState.hands[idleClient.id][1];

    await new Promise((resolve) => {
      idleClient.once('turn-update', resolve);
      active.emit('use-blind-switch', {
        playerAId: active.id,
        indexA: 1,
        playerBId: idleClient.id,
        indexB: 1,
      });
    });

    expect(room.gameState.hands[active.id][1]).toEqual(cardB);
    expect(room.gameState.hands[idleClient.id][1]).toEqual(cardA);
  });
});

// ─── Rule: Black King ─────────────────────────────────────────────────────────

describe('Black King rule (socket)', () => {
  test('use-black-king-peek → black-king-peek-result with both cards', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const [peekResult] = await Promise.all([
      on(active, 'black-king-peek-result'),
      (async () =>
        active.emit('use-black-king-peek', {
          target1PlayerId: active.id,
          index1: 0,
          target2PlayerId: idleClient.id,
          index2: 0,
        }))(),
    ]);

    expect(peekResult.card1).toHaveProperty('suit');
    expect(peekResult.card2).toHaveProperty('suit');
  });

  test('use-black-king-skip → action-log + turn advances', async () => {
    const { host, guests, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const [log, turnUpdate] = await Promise.all([
      on(idleClient, 'action-log'),
      on(idleClient, 'turn-update'),
      (async () => active.emit('use-black-king-skip'))(),
    ]);

    expect(log.message).toMatch(/not to switch/i);
    expect(turnUpdate.currentTurn).toBe(idleClient.id);
  });
});

// ─── Match Own ────────────────────────────────────────────────────────────────

describe('Match own card (socket)', () => {
  async function setupMatchOwn(match) {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;
    const room = rm.getRoomByCode(roomCode);

    const topCard = { suit: 'hearts', rank: '5', id: 'h-5-mo-sock' };
    room.gameState.discardPile.push(topCard);

    if (match) {
      room.gameState.hands[active.id][0] = { suit: 'clubs', rank: '5', id: 'c-5-mo-sock' };
    } else {
      room.gameState.hands[active.id][0] = { suit: 'clubs', rank: '3', id: 'c-3-mo-sock' };
    }

    return { active, idleClient, roomCode };
  }

  test('successful match → match-result success, hand-updated, card-discarded, layouts', async () => {
    const { active, idleClient } = await setupMatchOwn(true);

    const [matchResult, handUpdated, cardDiscarded] = await Promise.all([
      on(idleClient, 'match-result'),
      on(active, 'hand-updated'),
      on(idleClient, 'card-discarded'),
      (async () => active.emit('call-match-own', { handIndex: 0 }))(),
    ]);

    expect(matchResult.success).toBe(true);
    expect(matchResult.type).toBe('own');
    expect(cardDiscarded.action).toMatch(/matched/i);
    // The matched slot in the private hand should now be null
    expect(handUpdated.myCards[0]).toBeNull();
  });

  test('failed match → match-result failure + hand-updated with penalty card', async () => {
    const { active, idleClient } = await setupMatchOwn(false);

    const [matchResult, handUpdated] = await Promise.all([
      on(idleClient, 'match-result'),
      on(active, 'hand-updated'),
      (async () => active.emit('call-match-own', { handIndex: 0 }))(),
    ]);

    expect(matchResult.success).toBe(false);
    const nonNull = handUpdated.myCards.filter((c) => c !== null).length;
    expect(nonNull).toBe(5); // 4 original + 1 penalty
  });
});

// ─── Match Other ──────────────────────────────────────────────────────────────

describe('Match other card (socket)', () => {
  async function setupMatchOther(match) {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;
    const room = rm.getRoomByCode(roomCode);

    room.gameState.discardPile.push({ suit: 'hearts', rank: 'J', id: 'h-J-mos' });

    if (match) {
      room.gameState.hands[idleClient.id][0] = { suit: 'spades', rank: 'J', id: 's-J-mos' };
    } else {
      room.gameState.hands[idleClient.id][0] = { suit: 'spades', rank: '4', id: 's-4-mos' };
    }

    return { active, idleClient, roomCode };
  }

  test('successful match → match-result with success=true and targetIndex', async () => {
    const { active, idleClient } = await setupMatchOther(true);

    const [matchResult] = await Promise.all([
      on(idleClient, 'match-result'),
      (async () =>
        active.emit('call-match-other', { targetPlayerId: idleClient.id, handIndex: 0 }))(),
    ]);

    expect(matchResult.success).toBe(true);
    expect(matchResult.type).toBe('other');
    expect(matchResult).toHaveProperty('targetIndex');
  });

  test('give-card-after-match → both hands updated, card-discarded', async () => {
    const { active, idleClient, roomCode } = await setupMatchOther(true);

    // Trigger the match
    const matchDone = on(idleClient, 'match-result');
    active.emit('call-match-other', { targetPlayerId: idleClient.id, handIndex: 0 });
    const matchResult = await matchDone;

    // Now give a card
    const [callerHand, targetHand, discarded] = await Promise.all([
      on(active, 'hand-updated'),
      on(idleClient, 'hand-updated'),
      on(idleClient, 'card-discarded'),
      (async () =>
        active.emit('give-card-after-match', {
          callerHandIndex: 1,
          targetPlayerId: idleClient.id,
          targetIndex: matchResult.targetIndex,
        }))(),
    ]);

    expect(callerHand.myCards[1]).toBeNull(); // given slot is now empty
    expect(discarded.action).toMatch(/matched/i);
  });

  test('failed match → match-result failure + caller receives penalty', async () => {
    const { active, idleClient } = await setupMatchOther(false);

    const [matchResult, callerHand] = await Promise.all([
      on(idleClient, 'match-result'),
      on(active, 'hand-updated'),
      (async () =>
        active.emit('call-match-other', { targetPlayerId: idleClient.id, handIndex: 0 }))(),
    ]);

    expect(matchResult.success).toBe(false);
    const nonNull = callerHand.myCards.filter((c) => c !== null).length;
    expect(nonNull).toBe(5);
  });
});

// ─── Red King & Redemption ────────────────────────────────────────────────────

describe('Red King and redemption (socket)', () => {
  test('call-red-king → red-king-called + phase-changed to "redemption"', async () => {
    const { host, guests, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    const [rkCalled, phaseChanged] = await Promise.all([
      on(idleClient, 'red-king-called'),
      on(idleClient, 'phase-changed'),
      (async () => active.emit('call-red-king'))(),
    ]);

    expect(rkCalled.callerId).toBe(active.id);
    expect(phaseChanged.phase).toBe('redemption');
    expect(phaseChanged.currentTurn).toBe(idleClient.id);
  });

  test('wrong player calling Red King is silently blocked', async () => {
    const { host, guests, currentTurn } = await setupGame(2);
    const { idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    let received = false;
    idleClient.once('red-king-called', () => { received = true; });
    idleClient.emit('call-red-king');

    await new Promise((r) => setTimeout(r, 150));
    expect(received).toBe(false);
  });

  test('full redemption → game-results emitted with winnerId', async () => {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    // Active player calls Red King
    const phaseChanged = on(idleClient, 'phase-changed');
    active.emit('call-red-king');
    await phaseChanged;

    // Idle player (now in redemption) draws and discards
    const drawn = on(idleClient, 'card-drawn');
    idleClient.emit('draw-card');
    await drawn;

    // Inject a plain card so no rule fires
    const room = rm.getRoomByCode(roomCode);
    room.gameState.drawnCard = { suit: 'clubs', rank: '2', id: 'c-2-redemp' };
    room.gameState.drawnBy = idleClient.id;

    const gameResults = on(host, 'game-results');
    idleClient.emit('discard-card');
    const results = await gameResults;

    expect(results.winnerId).toBeTruthy();
    expect(results.results).toHaveLength(2);
    expect(results.results.every((r) => typeof r.score === 'number')).toBe(true);
  });
});

// ─── Protection (Red King caller cannot be targeted) ──────────────────────────

describe('Caller protection during redemption (socket)', () => {
  async function setupRedemption() {
    const { host, guests, roomCode, currentTurn } = await setupGame(2);
    const { active, idle } = splitByTurn(host, guests, currentTurn);
    const [idleClient] = idle;

    // Active calls Red King
    const phaseChanged = on(idleClient, 'phase-changed');
    active.emit('call-red-king');
    await phaseChanged;

    return { caller: active, redeemer: idleClient, roomCode };
  }

  test('redeemer cannot peek at caller\'s cards (silently blocked)', async () => {
    const { caller, redeemer } = await setupRedemption();

    let received = false;
    redeemer.once('peek-result', () => { received = true; });
    redeemer.emit('use-peek-other', { targetPlayerId: caller.id, handIndex: 0 });

    await new Promise((r) => setTimeout(r, 150));
    expect(received).toBe(false);
  });

  test('redeemer cannot blind-switch caller\'s cards (silently blocked)', async () => {
    const { caller, redeemer, roomCode } = await setupRedemption();
    const room = rm.getRoomByCode(roomCode);
    const callerCardBefore = room.gameState.hands[caller.id][0];

    redeemer.emit('use-blind-switch', {
      playerAId: redeemer.id,
      indexA: 0,
      playerBId: caller.id,
      indexB: 0,
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(room.gameState.hands[caller.id][0]).toEqual(callerCardBefore);
  });

  test('redeemer cannot match caller\'s cards (silently blocked)', async () => {
    const { caller, redeemer, roomCode } = await setupRedemption();
    const room = rm.getRoomByCode(roomCode);

    room.gameState.discardPile.push({ suit: 'hearts', rank: '5', id: 'h-5-prot' });
    room.gameState.hands[caller.id][0] = { suit: 'clubs', rank: '5', id: 'c-5-prot' };

    let received = false;
    redeemer.once('match-result', () => { received = true; });
    redeemer.emit('call-match-other', { targetPlayerId: caller.id, handIndex: 0 });

    await new Promise((r) => setTimeout(r, 150));
    // Caller's card should still be in hand (not removed)
    expect(room.gameState.hands[caller.id][0]).not.toBeNull();
    expect(received).toBe(false);
  });
});

// ─── Disconnect Handling ──────────────────────────────────────────────────────

describe('Player disconnect handling (socket)', () => {
  test('disconnect → player-list-updated emitted to remaining players', async () => {
    const host = connect();
    const guest = connect();

    const created = on(host, 'room-created');
    host.emit('host-game', { playerName: 'Alice' });
    const { roomCode } = await created;

    const joined = on(guest, 'room-joined');
    guest.emit('join-game', { playerName: 'Bob', roomCode });
    await joined;

    // Wait for the join's player-list-updated to arrive and flush at the host
    // before registering a new listener, otherwise we may catch that earlier event.
    await new Promise((r) => setTimeout(r, 150));

    const listUpdated = on(host, 'player-list-updated');
    guest.disconnect();
    const { players } = await listUpdated;
    expect(players).toHaveLength(1);
    expect(players[0].name).toBe('Alice');
  });

  test('host disconnect → new host assigned', async () => {
    const host = connect();
    const guest = connect();

    const created = on(host, 'room-created');
    host.emit('host-game', { playerName: 'Alice' });
    const { roomCode } = await created;

    const joined = on(guest, 'room-joined');
    guest.emit('join-game', { playerName: 'Bob', roomCode });
    await joined;

    const hostChanged = on(guest, 'host-changed');
    host.disconnect();
    const { newHostId } = await hostChanged;
    expect(newHostId).toBe(guest.id);
  });

  test('leave-room event → you-left emitted to leaver', async () => {
    const { host } = await setupGame(2);
    const left = on(host, 'you-left');
    host.emit('leave-room');
    await expect(left).resolves.toBeDefined();
  });
});

