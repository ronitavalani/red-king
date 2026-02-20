'use strict';

/**
 * Unit tests for roomManager.js
 *
 * All game logic lives in pure functions that operate on the shared `rooms`
 * Map.  Because Jest runs each test file in its own module environment the Map
 * starts empty for every file.  Within this file we keep state isolated by
 * giving every room/player a unique ID via the `uid()` counter helper.
 */

const rm = require('../server/roomManager');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let counter = 0;
function uid(prefix = 'sock') {
  return `${prefix}-${++counter}`;
}

/** Create a room with N players and return { roomCode, players }. */
function makeRoom(numPlayers = 2) {
  const hostId = uid('host');
  const room = rm.createRoom(hostId, 'Alice');
  const roomCode = room.code;
  const players = [{ id: hostId, name: 'Alice' }];

  for (let i = 1; i < numPlayers; i++) {
    const id = uid('player');
    const name = `Player${i + 1}`;
    rm.joinRoom(roomCode, id, name);
    players.push({ id, name });
  }

  return { roomCode, players };
}

/**
 * Create a room, deal cards, and advance to the play phase.
 * Returns { roomCode, players }.
 */
function makeGame(numPlayers = 2) {
  const { roomCode, players } = makeRoom(numPlayers);
  rm.setRoomState(roomCode, 'playing');
  rm.dealCards(roomCode);
  rm.setGamePhase(roomCode, 'play');
  return { roomCode, players };
}

/** Push a card directly onto the discard pile. */
function setTopDiscard(roomCode, card) {
  rm.getRoomByCode(roomCode).gameState.discardPile.push(card);
}

// ─── Deck & Card Setup ────────────────────────────────────────────────────────

describe('Deck & Card Setup', () => {
  test('each player receives exactly 4 cards', () => {
    const { roomCode, players } = makeGame(3);
    const room = rm.getRoomByCode(roomCode);
    for (const p of players) {
      expect(room.gameState.hands[p.id]).toHaveLength(4);
    }
  });

  test('total cards dealt + deck = 54', () => {
    const { roomCode, players } = makeGame(4);
    const room = rm.getRoomByCode(roomCode);
    const dealt = players.reduce(
      (sum, p) => sum + room.gameState.hands[p.id].length,
      0
    );
    expect(dealt + room.gameState.deck.length).toBe(54);
  });

  test('all 54 card IDs are unique across hands and deck', () => {
    const { roomCode, players } = makeGame(4);
    const room = rm.getRoomByCode(roomCode);
    const all = [...room.gameState.deck];
    for (const p of players) all.push(...room.gameState.hands[p.id]);
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(54);
  });

  test('initial phase after dealCards is "peek"', () => {
    const { roomCode } = makeRoom(2);
    rm.setRoomState(roomCode, 'playing');
    rm.dealCards(roomCode);
    expect(rm.getRoomByCode(roomCode).gameState.phase).toBe('peek');
  });

  test('setGamePhase transitions phase', () => {
    const { roomCode } = makeGame(2);
    expect(rm.getRoomByCode(roomCode).gameState.phase).toBe('play');
  });

  test('discard pile is empty after deal', () => {
    const { roomCode } = makeGame(2);
    expect(rm.getRoomByCode(roomCode).gameState.discardPile).toHaveLength(0);
  });

  test('deck has fewer cards after each deal', () => {
    const { roomCode: r2 } = makeGame(2);
    const { roomCode: r4 } = makeGame(4);
    const deck2 = rm.getRoomByCode(r2).gameState.deck.length;
    const deck4 = rm.getRoomByCode(r4).gameState.deck.length;
    expect(deck4).toBeLessThan(deck2);
  });
});

// ─── Card Scoring ─────────────────────────────────────────────────────────────

describe('Card Scoring — getCardPoints', () => {
  const card = (suit, rank) => ({ suit, rank, id: `${suit}-${rank}` });

  test('Ace = 1', () => expect(rm.getCardPoints(card('hearts', 'A'))).toBe(1));

  test.each([2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'numbered card %d = face value',
    (n) => expect(rm.getCardPoints(card('clubs', String(n)))).toBe(n)
  );

  test('Jack = 10', () =>
    expect(rm.getCardPoints(card('spades', 'J'))).toBe(10));

  test('Queen = 10', () =>
    expect(rm.getCardPoints(card('diamonds', 'Q'))).toBe(10));

  test('Black King (clubs) = 10', () =>
    expect(rm.getCardPoints(card('clubs', 'K'))).toBe(10));

  test('Black King (spades) = 10', () =>
    expect(rm.getCardPoints(card('spades', 'K'))).toBe(10));

  test('Red King (hearts) = -1', () =>
    expect(rm.getCardPoints(card('hearts', 'K'))).toBe(-1));

  test('Red King (diamonds) = -1', () =>
    expect(rm.getCardPoints(card('diamonds', 'K'))).toBe(-1));

  test('Joker = 0', () =>
    expect(rm.getCardPoints({ suit: 'joker', rank: 'Joker', id: 'joker-1' })).toBe(0));
});

describe('Card Scoring — getPlayerScore', () => {
  test('sums a normal 4-card hand', () => {
    const hand = [
      { suit: 'hearts', rank: 'K', id: 'h-K' },   // -1
      { suit: 'joker',  rank: 'Joker', id: 'j1' }, //  0
      { suit: 'hearts', rank: 'A', id: 'h-A' },    //  1
      { suit: 'clubs',  rank: '5', id: 'c-5' },    //  5
    ];
    expect(rm.getPlayerScore(hand)).toBe(5);
  });

  test('ignores null slots', () => {
    const hand = [
      { suit: 'clubs', rank: '7', id: 'c-7' }, // 7
      null,
      { suit: 'spades', rank: '3', id: 's-3' }, // 3
      null,
    ];
    expect(rm.getPlayerScore(hand)).toBe(10);
  });

  test('all-null hand scores 0', () => {
    expect(rm.getPlayerScore([null, null, null, null])).toBe(0);
  });
});

// ─── Room Management ──────────────────────────────────────────────────────────

describe('Room Management', () => {
  test('createRoom makes host a player with isHost=true', () => {
    const hostId = uid();
    const room = rm.createRoom(hostId, 'Alice');
    expect(room.players).toHaveLength(1);
    expect(room.players[0]).toMatchObject({ id: hostId, isHost: true });
  });

  test('joinRoom success adds player to room', () => {
    const { roomCode } = makeRoom(1);
    const result = rm.joinRoom(roomCode, uid(), 'Bob');
    expect(result.success).toBe(true);
    expect(result.room.players).toHaveLength(2);
  });

  test('joinRoom fails — room not found', () => {
    const result = rm.joinRoom('XXXX', uid(), 'Ghost');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  test('joinRoom fails — game already in progress', () => {
    const { roomCode } = makeGame(2);
    rm.setRoomState(roomCode, 'playing');
    const result = rm.joinRoom(roomCode, uid(), 'Late');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/in progress/i);
  });

  test('joinRoom fails — duplicate name', () => {
    const { roomCode } = makeRoom(1);
    const result = rm.joinRoom(roomCode, uid(), 'Alice');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/name already taken/i);
  });

  test('joinRoom fails — already in room', () => {
    const hostId = uid();
    const room = rm.createRoom(hostId, 'Alice');
    const result = rm.joinRoom(room.code, hostId, 'AliasAlice');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already in this room/i);
  });

  test('leaveRoom removes player and transfers host', () => {
    const hostId = uid();
    const room = rm.createRoom(hostId, 'Alice');
    const guestId = uid();
    rm.joinRoom(room.code, guestId, 'Bob');

    rm.leaveRoom(hostId);
    const updated = rm.getRoomByCode(room.code);
    expect(updated.players).toHaveLength(1);
    expect(updated.players[0]).toMatchObject({ id: guestId, isHost: true });
  });

  test('leaveRoom deletes room when last player leaves', () => {
    const hostId = uid();
    const room = rm.createRoom(hostId, 'Solo');
    rm.leaveRoom(hostId);
    expect(rm.getRoomByCode(room.code)).toBeNull();
  });

  test('leaveRoom cleans up gameState when mid-game', () => {
    const { roomCode, players } = makeGame(2);
    rm.leaveRoom(players[1].id);
    const room = rm.getRoomByCode(roomCode);
    expect(room.gameState.hands[players[1].id]).toBeUndefined();
  });
});

// ─── Turn Management ──────────────────────────────────────────────────────────

describe('Turn Management', () => {
  test('first turn is player after host (turn order rotated)', () => {
    const { roomCode, players } = makeGame(2);
    // Host is players[0], so players[1] goes first
    expect(rm.getCurrentTurnPlayer(roomCode)).toBe(players[1].id);
  });

  test('advanceTurn cycles to next player', () => {
    const { roomCode } = makeGame(2);
    const first = rm.getCurrentTurnPlayer(roomCode);
    rm.advanceTurn(roomCode);
    expect(rm.getCurrentTurnPlayer(roomCode)).not.toBe(first);
  });

  test('advanceTurn wraps back around to first player', () => {
    const { roomCode } = makeGame(2);
    const first = rm.getCurrentTurnPlayer(roomCode);
    rm.advanceTurn(roomCode);
    rm.advanceTurn(roomCode);
    expect(rm.getCurrentTurnPlayer(roomCode)).toBe(first);
  });

  test('advanceTurn works correctly with 4 players', () => {
    const { roomCode, players } = makeGame(4);
    const visitedIds = [];
    for (let i = 0; i < 4; i++) {
      visitedIds.push(rm.getCurrentTurnPlayer(roomCode));
      rm.advanceTurn(roomCode);
    }
    // All 4 players should have had a turn, and the cycle repeats
    expect(new Set(visitedIds).size).toBe(4);
    expect(rm.getCurrentTurnPlayer(roomCode)).toBe(visitedIds[0]);
  });

  test('drawCard fails when it is not your turn', () => {
    const { roomCode, players } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const other = players.find((p) => p.id !== current);
    expect(rm.drawCard(roomCode, other.id)).toBeNull();
  });

  test('drawCard succeeds on your turn and shrinks the deck', () => {
    const { roomCode } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const room = rm.getRoomByCode(roomCode);
    const before = room.gameState.deck.length;
    const card = rm.drawCard(roomCode, current);
    expect(card).not.toBeNull();
    expect(card).toHaveProperty('suit');
    expect(room.gameState.deck.length).toBe(before - 1);
  });

  test('drawCard fails if player already drew this turn', () => {
    const { roomCode } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    rm.drawCard(roomCode, current);
    expect(rm.drawCard(roomCode, current)).toBeNull();
  });
});

// ─── Keep & Discard Drawn Card ────────────────────────────────────────────────

describe('Keep & Discard', () => {
  function injectDrawn(roomCode, playerId, card) {
    const room = rm.getRoomByCode(roomCode);
    room.gameState.drawnCard = card;
    room.gameState.drawnBy = playerId;
  }

  test('keepCard swaps drawn card into hand, puts old card on discard', () => {
    const { roomCode } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const room = rm.getRoomByCode(roomCode);
    const drawn = { suit: 'hearts', rank: '5', id: 'h-5-keep' };
    const original = room.gameState.hands[current][0];
    injectDrawn(roomCode, current, drawn);

    const result = rm.keepCard(roomCode, current, 0);

    expect(result.discarded).toEqual(original);
    expect(room.gameState.hands[current][0]).toEqual(drawn);
    expect(rm.getTopDiscard(roomCode)).toEqual(original);
    expect(room.gameState.drawnCard).toBeNull();
  });

  test('keepCard fails on an empty slot', () => {
    const { roomCode } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const room = rm.getRoomByCode(roomCode);
    room.gameState.hands[current][0] = null;
    injectDrawn(roomCode, current, { suit: 'clubs', rank: '3', id: 'c-3-k' });

    expect(rm.keepCard(roomCode, current, 0)).toBeNull();
  });

  test('keepCard fails if another player tries to keep', () => {
    const { roomCode, players } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const other = players.find((p) => p.id !== current);
    injectDrawn(roomCode, current, { suit: 'clubs', rank: '4', id: 'c-4-k' });

    expect(rm.keepCard(roomCode, other.id, 0)).toBeNull();
  });

  test('discardDrawnCard adds card to pile and clears drawn state', () => {
    const { roomCode } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const drawn = { suit: 'diamonds', rank: '9', id: 'd-9-disc' };
    injectDrawn(roomCode, current, drawn);

    const result = rm.discardDrawnCard(roomCode, current);

    expect(result).toEqual(drawn);
    expect(rm.getTopDiscard(roomCode)).toEqual(drawn);
    expect(rm.getRoomByCode(roomCode).gameState.drawnCard).toBeNull();
  });

  test('discardDrawnCard fails if the card belongs to someone else', () => {
    const { roomCode, players } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const other = players.find((p) => p.id !== current);
    injectDrawn(roomCode, current, { suit: 'clubs', rank: '6', id: 'c-6-d' });

    expect(rm.discardDrawnCard(roomCode, other.id)).toBeNull();
  });
});

// ─── Peek Rules ───────────────────────────────────────────────────────────────

describe('Peek Rules', () => {
  test('peekOwnCard returns the correct card', () => {
    const { roomCode } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const room = rm.getRoomByCode(roomCode);
    const known = { suit: 'hearts', rank: '7', id: 'h-7-peek' };
    room.gameState.hands[current][2] = known;

    expect(rm.peekOwnCard(roomCode, current, 2)).toEqual(known);
  });

  test('peekOwnCard returns null for empty slot', () => {
    const { roomCode } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    rm.getRoomByCode(roomCode).gameState.hands[current][1] = null;

    expect(rm.peekOwnCard(roomCode, current, 1)).toBeNull();
  });

  test('peekOtherCard returns the opponent card', () => {
    const { roomCode, players } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const other = players.find((p) => p.id !== current);
    const known = { suit: 'spades', rank: '9', id: 's-9-peek' };
    rm.getRoomByCode(roomCode).gameState.hands[other.id][0] = known;

    expect(rm.peekOtherCard(roomCode, other.id, 0)).toEqual(known);
  });

  test('peekOtherCard returns null for empty slot', () => {
    const { roomCode, players } = makeGame(2);
    const current = rm.getCurrentTurnPlayer(roomCode);
    const other = players.find((p) => p.id !== current);
    rm.getRoomByCode(roomCode).gameState.hands[other.id][3] = null;

    expect(rm.peekOtherCard(roomCode, other.id, 3)).toBeNull();
  });
});

// ─── Blind Switch (J/Q) ───────────────────────────────────────────────────────

describe('Blind Switch', () => {
  test('swaps cards between two different players', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const room = rm.getRoomByCode(roomCode);
    const c1 = { suit: 'hearts', rank: '3', id: 'h-3-bs' };
    const c2 = { suit: 'clubs', rank: 'Q', id: 'c-Q-bs' };
    room.gameState.hands[p1.id][0] = c1;
    room.gameState.hands[p2.id][0] = c2;

    expect(rm.blindSwitch(roomCode, p1.id, 0, p2.id, 0)).toBe(true);
    expect(room.gameState.hands[p1.id][0]).toEqual(c2);
    expect(room.gameState.hands[p2.id][0]).toEqual(c1);
  });

  test('fails when source slot is empty', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    rm.getRoomByCode(roomCode).gameState.hands[p1.id][0] = null;

    expect(rm.blindSwitch(roomCode, p1.id, 0, p2.id, 0)).toBeNull();
  });

  test('fails when target slot is empty', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    rm.getRoomByCode(roomCode).gameState.hands[p2.id][0] = null;

    expect(rm.blindSwitch(roomCode, p1.id, 0, p2.id, 0)).toBeNull();
  });

  test('swaps within the same player\'s hand', () => {
    const { roomCode, players } = makeGame(2);
    const [p1] = players;
    const room = rm.getRoomByCode(roomCode);
    const c1 = { suit: 'hearts', rank: '2', id: 'h-2-self' };
    const c2 = { suit: 'spades', rank: '4', id: 's-4-self' };
    room.gameState.hands[p1.id][0] = c1;
    room.gameState.hands[p1.id][1] = c2;

    rm.blindSwitch(roomCode, p1.id, 0, p1.id, 1);
    expect(room.gameState.hands[p1.id][0]).toEqual(c2);
    expect(room.gameState.hands[p1.id][1]).toEqual(c1);
  });
});

// ─── Black King Peek ──────────────────────────────────────────────────────────

describe('Black King Peek', () => {
  test('returns both peeked cards', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const room = rm.getRoomByCode(roomCode);
    const c1 = { suit: 'hearts', rank: '6', id: 'h-6-bk' };
    const c2 = { suit: 'spades', rank: 'J', id: 's-J-bk' };
    room.gameState.hands[p1.id][0] = c1;
    room.gameState.hands[p2.id][1] = c2;

    expect(rm.blackKingPeek(roomCode, p1.id, 0, p2.id, 1)).toEqual({ card1: c1, card2: c2 });
  });

  test('returns null when first slot is empty', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    rm.getRoomByCode(roomCode).gameState.hands[p1.id][0] = null;

    expect(rm.blackKingPeek(roomCode, p1.id, 0, p2.id, 0)).toBeNull();
  });

  test('can peek two cards in the same player\'s hand', () => {
    const { roomCode, players } = makeGame(2);
    const [p1] = players;
    const room = rm.getRoomByCode(roomCode);
    const c1 = { suit: 'clubs', rank: '8', id: 'c-8-bk' };
    const c2 = { suit: 'diamonds', rank: 'A', id: 'd-A-bk' };
    room.gameState.hands[p1.id][0] = c1;
    room.gameState.hands[p1.id][3] = c2;

    const result = rm.blackKingPeek(roomCode, p1.id, 0, p1.id, 3);
    expect(result).toEqual({ card1: c1, card2: c2 });
  });
});

// ─── Match Own ────────────────────────────────────────────────────────────────

describe('Match Own Card', () => {
  test('success: matched card removed (null slot), added to discard', () => {
    const { roomCode, players } = makeGame(2);
    const [p1] = players;
    const room = rm.getRoomByCode(roomCode);
    const match = { suit: 'clubs', rank: '5', id: 'c-5-mo' };
    const top = { suit: 'hearts', rank: '5', id: 'h-5-mo' };
    room.gameState.hands[p1.id][0] = match;
    setTopDiscard(roomCode, top);

    const result = rm.callMatchOwn(roomCode, p1.id, 0);

    expect(result.success).toBe(true);
    expect(result.card).toEqual(match);
    expect(room.gameState.hands[p1.id][0]).toBeNull();
    expect(rm.getTopDiscard(roomCode)).toEqual(match);
  });

  test('failure: card stays in hand, penalty card added', () => {
    const { roomCode, players } = makeGame(2);
    const [p1] = players;
    const room = rm.getRoomByCode(roomCode);
    const handCard = { suit: 'clubs', rank: '3', id: 'c-3-mof' };
    const top = { suit: 'hearts', rank: '7', id: 'h-7-mof' };
    room.gameState.hands[p1.id][0] = handCard;
    setTopDiscard(roomCode, top);

    const result = rm.callMatchOwn(roomCode, p1.id, 0);

    expect(result.success).toBe(false);
    expect(result.penaltyCard).not.toBeNull();
    // Original card stays, penalty appended — 5 non-null cards total
    const nonNull = room.gameState.hands[p1.id].filter((c) => c !== null).length;
    expect(nonNull).toBe(5);
  });

  test('penalty card fills an empty slot rather than appending', () => {
    const { roomCode, players } = makeGame(2);
    const [p1] = players;
    const room = rm.getRoomByCode(roomCode);
    const handCard = { suit: 'clubs', rank: '3', id: 'c-3-fill' };
    const top = { suit: 'hearts', rank: '7', id: 'h-7-fill' };
    room.gameState.hands[p1.id][0] = handCard;
    room.gameState.hands[p1.id][2] = null; // empty slot
    setTopDiscard(roomCode, top);

    rm.callMatchOwn(roomCode, p1.id, 0);

    // Penalty should have gone into slot 2 (first null), not appended
    expect(room.gameState.hands[p1.id][2]).not.toBeNull();
    expect(room.gameState.hands[p1.id]).toHaveLength(4); // no new appended entry
  });

  test('returns null when discard pile is empty', () => {
    const { roomCode, players } = makeGame(2);
    expect(rm.callMatchOwn(roomCode, players[0].id, 0)).toBeNull();
  });

  test('returns null when targeting an empty slot', () => {
    const { roomCode, players } = makeGame(2);
    const [p1] = players;
    const room = rm.getRoomByCode(roomCode);
    room.gameState.hands[p1.id][0] = null;
    setTopDiscard(roomCode, { suit: 'hearts', rank: '5', id: 'h-5-empty' });

    expect(rm.callMatchOwn(roomCode, p1.id, 0)).toBeNull();
  });
});

// ─── Match Other ──────────────────────────────────────────────────────────────

describe('Match Other Card', () => {
  test('success: returns matched card and target index', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const room = rm.getRoomByCode(roomCode);
    const targetCard = { suit: 'spades', rank: 'Q', id: 's-Q-moth' };
    const top = { suit: 'hearts', rank: 'Q', id: 'h-Q-moth' };
    room.gameState.hands[p2.id][0] = targetCard;
    setTopDiscard(roomCode, top);

    const result = rm.callMatchOther(roomCode, p1.id, p2.id, 0);

    expect(result.success).toBe(true);
    expect(result.card).toEqual(targetCard);
    expect(result.targetIndex).toBe(0);
  });

  test('failure: penalty card added to caller', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const room = rm.getRoomByCode(roomCode);
    const targetCard = { suit: 'spades', rank: '3', id: 's-3-mothf' };
    const top = { suit: 'hearts', rank: '7', id: 'h-7-mothf' };
    room.gameState.hands[p2.id][0] = targetCard;
    setTopDiscard(roomCode, top);

    const result = rm.callMatchOther(roomCode, p1.id, p2.id, 0);

    expect(result.success).toBe(false);
    expect(result.penaltyCard).not.toBeNull();
    const callerNonNull = room.gameState.hands[p1.id].filter((c) => c !== null).length;
    expect(callerNonNull).toBe(5);
  });

  test('giveCardAfterMatch: card transferred, slots updated, matched card on discard', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const room = rm.getRoomByCode(roomCode);
    const targetCard = { suit: 'spades', rank: 'J', id: 's-J-give' };
    const givenCard = { suit: 'clubs', rank: '2', id: 'c-2-give' };
    const top = { suit: 'hearts', rank: 'J', id: 'h-J-give' };
    room.gameState.hands[p2.id][0] = targetCard;
    room.gameState.hands[p1.id][0] = givenCard;
    setTopDiscard(roomCode, top);

    const result = rm.giveCardAfterMatch(roomCode, p1.id, 0, p2.id, 0);

    expect(result).not.toBeNull();
    expect(result.matchedCard).toEqual(targetCard);
    expect(result.givenCard).toEqual(givenCard);
    // Caller's slot is now null
    expect(room.gameState.hands[p1.id][0]).toBeNull();
    // addCardToHand fills the first null slot — the matched card's slot (0) was
    // just cleared, so the given card lands back at index 0.
    expect(room.gameState.hands[p2.id][0]).toEqual(givenCard);
    expect(result.targetHand).toContainEqual(givenCard);
    // Matched card is on the discard pile
    expect(rm.getTopDiscard(roomCode)).toEqual(targetCard);
  });

  test('giveCardAfterMatch fails when caller tries to give an empty slot', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const room = rm.getRoomByCode(roomCode);
    room.gameState.hands[p1.id][0] = null;

    expect(rm.giveCardAfterMatch(roomCode, p1.id, 0, p2.id, 0)).toBeNull();
  });
});

// ─── Rule Types ───────────────────────────────────────────────────────────────

describe('Rule Types', () => {
  const c = (suit, rank) => ({ suit, rank, id: `${suit}-${rank}` });

  const cases = [
    [c('hearts', '7'),   'peek-own'],
    [c('clubs',  '8'),   'peek-own'],
    [c('hearts', '9'),   'peek-other'],
    [c('clubs',  '10'),  'peek-other'],
    [c('hearts', 'J'),   'blind-switch'],
    [c('clubs',  'Q'),   'blind-switch'],
    [c('clubs',  'K'),   'black-king'],
    [c('spades', 'K'),   'black-king'],
    [c('hearts', 'K'),   null],   // Red King — no rule
    [c('diamonds', 'K'), null],
  ];

  test.each(cases)('getRuleType(%o) → %s', (card, expected) => {
    expect(rm.getRuleType(card)).toBe(expected);
  });

  test('canUseRule is false for A and 2-6', () => {
    const lowRanks = ['A', '2', '3', '4', '5', '6'];
    for (const rank of lowRanks) {
      expect(rm.canUseRule(c('hearts', rank))).toBe(false);
    }
  });

  test('canUseRule is true for 7-K', () => {
    const highRanks = ['7', '8', '9', '10', 'J', 'Q', 'K'];
    for (const rank of highRanks) {
      expect(rm.canUseRule(c('hearts', rank))).toBe(true);
    }
  });
});

// ─── Top Discard ──────────────────────────────────────────────────────────────

describe('Top Discard', () => {
  test('returns null when pile is empty', () => {
    const { roomCode } = makeGame(2);
    expect(rm.getTopDiscard(roomCode)).toBeNull();
  });

  test('returns the most recently discarded card', () => {
    const { roomCode } = makeGame(2);
    const c1 = { suit: 'hearts', rank: '3', id: 'h-3-td' };
    const c2 = { suit: 'clubs',  rank: '8', id: 'c-8-td' };
    setTopDiscard(roomCode, c1);
    setTopDiscard(roomCode, c2);
    expect(rm.getTopDiscard(roomCode)).toEqual(c2);
  });
});

// ─── Hand Layouts ─────────────────────────────────────────────────────────────

describe('Hand Layouts', () => {
  test('true for present cards, false for null slots', () => {
    const { roomCode, players } = makeGame(2);
    const [p1] = players;
    const room = rm.getRoomByCode(roomCode);
    room.gameState.hands[p1.id][1] = null;
    room.gameState.hands[p1.id][3] = null;

    const layouts = rm.getHandLayouts(roomCode);
    expect(layouts[p1.id][0]).toBe(true);
    expect(layouts[p1.id][1]).toBe(false);
    expect(layouts[p1.id][2]).toBe(true);
    expect(layouts[p1.id][3]).toBe(false);
  });

  test('includes all players', () => {
    const { roomCode, players } = makeGame(3);
    const layouts = rm.getHandLayouts(roomCode);
    for (const p of players) {
      expect(layouts[p.id]).toBeDefined();
      expect(layouts[p.id]).toHaveLength(4);
    }
  });
});

// ─── Red King & Redemption ────────────────────────────────────────────────────

describe('Red King & Redemption', () => {
  test('callRedKing transitions phase to "redemption"', () => {
    const { roomCode } = makeGame(2);
    const caller = rm.getCurrentTurnPlayer(roomCode);
    rm.callRedKing(roomCode, caller);
    expect(rm.getRoomByCode(roomCode).gameState.phase).toBe('redemption');
  });

  test('callRedKing sets redKingCaller and builds redemptionOrder without caller', () => {
    const { roomCode, players } = makeGame(3);
    const caller = rm.getCurrentTurnPlayer(roomCode);
    const result = rm.callRedKing(roomCode, caller);

    expect(result.redKingCaller).toBe(caller);
    expect(result.redemptionOrder).toHaveLength(players.length - 1);
    expect(result.redemptionOrder).not.toContain(caller);
  });

  test('redemptionOrder starts with the player immediately after caller', () => {
    const { roomCode } = makeGame(3);
    const room = rm.getRoomByCode(roomCode);
    const caller = rm.getCurrentTurnPlayer(roomCode);
    const turnOrder = room.gameState.turnOrder;
    const callerIdx = turnOrder.indexOf(caller);
    const expectedFirst = turnOrder[(callerIdx + 1) % turnOrder.length];

    const result = rm.callRedKing(roomCode, caller);
    expect(result.redemptionOrder[0]).toBe(expectedFirst);
  });

  test('callRedKing fails if it is not your turn', () => {
    const { roomCode, players } = makeGame(2);
    const caller = rm.getCurrentTurnPlayer(roomCode);
    const other = players.find((p) => p.id !== caller);
    expect(rm.callRedKing(roomCode, other.id)).toBeNull();
  });

  test('callRedKing fails if a card has already been drawn this turn', () => {
    const { roomCode } = makeGame(2);
    const caller = rm.getCurrentTurnPlayer(roomCode);
    rm.drawCard(roomCode, caller);
    expect(rm.callRedKing(roomCode, caller)).toBeNull();
  });

  test('getCurrentTurnPlayer returns the correct redemption player', () => {
    const { roomCode } = makeGame(3);
    const caller = rm.getCurrentTurnPlayer(roomCode);
    const result = rm.callRedKing(roomCode, caller);
    expect(rm.getCurrentTurnPlayer(roomCode)).toBe(result.redemptionOrder[0]);
    expect(rm.getCurrentTurnPlayer(roomCode)).not.toBe(caller);
  });

  test('advanceRedemptionTurn progresses through all non-callers then reveals', () => {
    const { roomCode } = makeGame(3);
    const caller = rm.getCurrentTurnPlayer(roomCode);
    rm.callRedKing(roomCode, caller);

    // 3 players → 2 redemption turns
    const r1 = rm.advanceRedemptionTurn(roomCode);
    expect(r1.phase).toBe('redemption');

    const r2 = rm.advanceRedemptionTurn(roomCode);
    expect(r2.phase).toBe('reveal');
    expect(rm.getRoomByCode(roomCode).gameState.phase).toBe('reveal');
  });

  test('2-player game: one redemption turn then reveal', () => {
    const { roomCode } = makeGame(2);
    const caller = rm.getCurrentTurnPlayer(roomCode);
    rm.callRedKing(roomCode, caller);
    const result = rm.advanceRedemptionTurn(roomCode);
    expect(result.phase).toBe('reveal');
  });
});

// ─── Game Results & Winner ────────────────────────────────────────────────────

describe('Game Results', () => {
  function assignHand(roomCode, playerId, cards) {
    rm.getRoomByCode(roomCode).gameState.hands[playerId] = cards;
  }

  function c(suit, rank) {
    return { suit, rank, id: `${suit}-${rank}-${Math.random().toString(36).slice(2, 6)}` };
  }

  test('player with lowest score wins', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const room = rm.getRoomByCode(roomCode);

    // p1: -1 + 0 + 1 + 2 = 2
    assignHand(roomCode, p1.id, [c('hearts','K'), c('joker','Joker'), c('hearts','A'), c('clubs','2')]);
    // p2: 10 + 10 + 9 + 8 = 37
    assignHand(roomCode, p2.id, [c('clubs','K'), c('spades','Q'), c('clubs','9'), c('spades','8')]);

    room.gameState.phase = 'reveal';
    room.gameState.redKingCaller = p2.id;

    const results = rm.getGameResults(roomCode);
    expect(results.winnerId).toBe(p1.id);
  });

  test('tie-breaker: caller loses to non-caller with equal score', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const room = rm.getRoomByCode(roomCode);

    // Both score 10: A+2+3+4
    const tiedHand = () => [c('hearts','A'), c('clubs','2'), c('spades','3'), c('diamonds','4')];
    assignHand(roomCode, p1.id, tiedHand());
    assignHand(roomCode, p2.id, tiedHand());

    room.gameState.phase = 'reveal';
    room.gameState.redKingCaller = p1.id; // p1 is the caller

    const results = rm.getGameResults(roomCode);
    expect(results.winnerId).toBe(p2.id); // non-caller wins the tie
  });

  test('results include all players with score, name, and hand', () => {
    const { roomCode, players } = makeGame(3);
    const room = rm.getRoomByCode(roomCode);
    room.gameState.phase = 'reveal';
    room.gameState.redKingCaller = players[0].id;

    const results = rm.getGameResults(roomCode);
    expect(results.results).toHaveLength(3);
    for (const r of results.results) {
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('hand');
      expect(r).toHaveProperty('name');
    }
  });

  test('results are sorted ascending by score', () => {
    const { roomCode, players } = makeGame(4);
    const room = rm.getRoomByCode(roomCode);
    room.gameState.phase = 'reveal';
    room.gameState.redKingCaller = players[0].id;

    const { results } = rm.getGameResults(roomCode);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i - 1].score);
    }
  });
});

// ─── Fairness: Full Game Simulations ──────────────────────────────────────────

describe('Fairness — Full Game Simulations', () => {
  test('host never goes first (turn rotated past dealer)', () => {
    const { roomCode, players } = makeGame(4);
    expect(rm.getCurrentTurnPlayer(roomCode)).not.toBe(players[0].id);
  });

  test('each player draws exactly once per round across two full rounds', () => {
    const { roomCode, players } = makeGame(3);
    const order = [];

    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < players.length; i++) {
        const current = rm.getCurrentTurnPlayer(roomCode);
        order.push(current);

        // Wrong player cannot draw
        const wrong = players.find((p) => p.id !== current);
        expect(rm.drawCard(roomCode, wrong.id)).toBeNull();

        // Correct player draws and discards
        expect(rm.drawCard(roomCode, current)).not.toBeNull();
        rm.discardDrawnCard(roomCode, current);
        rm.advanceTurn(roomCode);
      }
    }

    // Round 1 order should equal Round 2 order
    expect(order.slice(0, 3)).toEqual(order.slice(3, 6));
  });

  test('complete 2-player game plays through without errors', () => {
    const { roomCode, players } = makeGame(2);
    const [p1, p2] = players;
    const first = rm.getCurrentTurnPlayer(roomCode);
    const second = players.find((p) => p.id !== first);

    // Turn 1: first draws and discards
    expect(rm.drawCard(roomCode, first)).not.toBeNull();
    expect(rm.discardDrawnCard(roomCode, first)).not.toBeNull();
    rm.advanceTurn(roomCode);

    // Turn 2: second draws and keeps
    expect(rm.getCurrentTurnPlayer(roomCode)).toBe(second.id);
    rm.drawCard(roomCode, second.id);
    expect(rm.keepCard(roomCode, second.id, 0)).not.toBeNull();
    rm.advanceTurn(roomCode);

    // Turn 3: first calls Red King
    expect(rm.getCurrentTurnPlayer(roomCode)).toBe(first);
    const rk = rm.callRedKing(roomCode, first);
    expect(rk).not.toBeNull();

    // Redemption: second draws and discards
    expect(rm.getCurrentTurnPlayer(roomCode)).toBe(second.id);
    rm.drawCard(roomCode, second.id);
    rm.discardDrawnCard(roomCode, second.id);
    const end = rm.advanceRedemptionTurn(roomCode);
    expect(end.phase).toBe('reveal');

    // Score the game
    const room = rm.getRoomByCode(roomCode);
    room.gameState.redKingCaller = first;
    const results = rm.getGameResults(roomCode);
    expect(results.winnerId).toBeTruthy();
    expect(results.results).toHaveLength(2);
  });

  test('6-player game deals valid hands and plays one full round', () => {
    const { roomCode, players } = makeGame(6);

    // Verify all hands
    const room = rm.getRoomByCode(roomCode);
    for (const p of players) {
      expect(room.gameState.hands[p.id]).toHaveLength(4);
    }

    // One full round of draw + discard
    for (let i = 0; i < players.length; i++) {
      const current = rm.getCurrentTurnPlayer(roomCode);
      rm.drawCard(roomCode, current);
      rm.discardDrawnCard(roomCode, current);
      rm.advanceTurn(roomCode);
    }

    // Turn should be back to the first player
    expect(rm.getCurrentTurnPlayer(roomCode)).toBe(
      room.gameState.turnOrder[0]
    );
  });
});

