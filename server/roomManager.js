const rooms = new Map();
const playerRoomMap = new Map();

function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank, id: `${suit}-${rank}` });
    }
  }
  deck.push({ suit: 'joker', rank: 'Joker', id: 'joker-1' });
  deck.push({ suit: 'joker', rank: 'Joker', id: 'joker-2' });
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(code));
  return code;
}

function getCardPoints(card) {
  if (card.suit === 'joker') return 0;
  if (card.rank === 'A') return 1;
  if (card.rank === 'K' && (card.suit === 'hearts' || card.suit === 'diamonds')) return -1;
  if (card.rank === 'K') return 10;
  if (['J', 'Q'].includes(card.rank)) return 10;
  return parseInt(card.rank);
}

function getPlayerScore(hand) {
  return hand.reduce((sum, card) => {
    if (card === null) return sum; // skip empty slots
    return sum + getCardPoints(card);
  }, 0);
}

function createRoom(hostSocketId, hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId: hostSocketId,
    players: [{ id: hostSocketId, name: hostName, isHost: true }],
    state: 'waiting',
  };
  rooms.set(code, room);
  playerRoomMap.set(hostSocketId, code);
  return room;
}

function joinRoom(code, socketId, playerName) {
  const room = rooms.get(code);
  if (!room) {
    return { success: false, error: 'Room not found' };
  }
  if (room.state === 'playing') {
    return { success: false, error: 'Game is already in progress' };
  }
  if (room.players.length >= 8) {
    return { success: false, error: 'Room is full' };
  }
  if (room.players.some((p) => p.name === playerName)) {
    return { success: false, error: 'Name already taken in this room' };
  }
  if (room.players.some((p) => p.id === socketId)) {
    return { success: false, error: 'You are already in this room' };
  }
  room.players.push({ id: socketId, name: playerName, isHost: false });
  playerRoomMap.set(socketId, code);
  return { success: true, room };
}

function leaveRoom(socketId) {
  const code = playerRoomMap.get(socketId);
  if (!code) return { room: null, wasHost: false, isEmpty: true };

  const room = rooms.get(code);
  if (!room) {
    playerRoomMap.delete(socketId);
    return { room: null, wasHost: false, isEmpty: true };
  }

  const playerIndex = room.players.findIndex((p) => p.id === socketId);
  if (playerIndex === -1) {
    playerRoomMap.delete(socketId);
    return { room, wasHost: false, isEmpty: room.players.length === 0 };
  }

  const wasHost = room.players[playerIndex].isHost;
  room.players.splice(playerIndex, 1);
  playerRoomMap.delete(socketId);

  if (room.players.length === 0) {
    rooms.delete(code);
    return { room: null, wasHost, isEmpty: true };
  }

  if (wasHost) {
    room.players[0].isHost = true;
    room.hostId = room.players[0].id;
  }

  // Clean up game state if mid-game
  if (room.gameState) {
    delete room.gameState.hands[socketId];
    if (room.gameState.peekDone) {
      room.gameState.peekDone.delete(socketId);
    }
    // Fix turn index if needed
    if (room.gameState.turnOrder) {
      room.gameState.turnOrder = room.gameState.turnOrder.filter((id) => id !== socketId);
      if (room.gameState.turnIndex >= room.gameState.turnOrder.length) {
        room.gameState.turnIndex = 0;
      }
    }
  }

  return { room, wasHost, isEmpty: false };
}

function getRoomByCode(code) {
  return rooms.get(code) || null;
}

function getRoomBySocketId(socketId) {
  const code = playerRoomMap.get(socketId);
  if (!code) return null;
  return rooms.get(code) || null;
}

function setRoomState(code, state) {
  const room = rooms.get(code);
  if (room) {
    room.state = state;
  }
  return room;
}

function dealCards(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const deck = shuffleDeck(createDeck());
  const hands = {};

  for (const player of room.players) {
    hands[player.id] = deck.splice(0, 4);
  }

  // Turn order: first player to right of dealer (host is dealer, so index 1 goes first)
  const turnOrder = room.players.map((p) => p.id);
  // Rotate so player after host goes first
  if (turnOrder.length > 1) {
    turnOrder.push(turnOrder.shift());
  }

  room.gameState = {
    deck,
    hands,
    phase: 'peek',
    peekDone: new Set(),
    turnOrder,
    turnIndex: 0,
    discardPile: [],
    drawnCard: null,
    drawnBy: null,
  };

  return room;
}

function clearGameState(roomCode) {
  const room = rooms.get(roomCode);
  if (room) {
    room.gameState = null;
  }
  return room;
}

function setGamePhase(roomCode, phase) {
  const room = rooms.get(roomCode);
  if (room && room.gameState) {
    room.gameState.phase = phase;
  }
  return room;
}

function getCurrentTurnPlayer(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  if (room.gameState.phase === 'redemption' && room.gameState.redemptionOrder) {
    return room.gameState.redemptionOrder[room.gameState.redemptionIndex];
  }

  if (!room.gameState.turnOrder) return null;
  return room.gameState.turnOrder[room.gameState.turnIndex];
}

function drawCard(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;
  if (getCurrentTurnPlayer(roomCode) !== playerId) return null;
  if (room.gameState.drawnCard) return null; // already drew

  if (room.gameState.deck.length === 0) return null;

  const card = room.gameState.deck.pop();
  room.gameState.drawnCard = card;
  room.gameState.drawnBy = playerId;
  return card;
}

function canUseRule(card) {
  if (!card) return false;
  const rank = parseInt(card.rank);
  if (rank >= 7 && rank <= 10) return true;
  if (['J', 'Q', 'K'].includes(card.rank)) return true;
  return false;
}

function getRuleType(card) {
  if (!card) return null;
  if (card.rank === '7' || card.rank === '8') return 'peek-own';
  if (card.rank === '9' || card.rank === '10') return 'peek-other';
  if (card.rank === 'J' || card.rank === 'Q') return 'blind-switch';
  if (card.rank === 'K' && (card.suit === 'clubs' || card.suit === 'spades')) return 'black-king';
  return null;
}

// Player keeps drawn card, swaps it with one of their own cards
function keepCard(roomCode, playerId, handIndex) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;
  if (room.gameState.drawnBy !== playerId) return null;
  if (!room.gameState.drawnCard) return null;

  const hand = room.gameState.hands[playerId];
  if (!hand || handIndex < 0 || handIndex >= hand.length) return null;
  if (hand[handIndex] === null) return null; // can't swap with empty slot

  const discarded = hand[handIndex];
  hand[handIndex] = room.gameState.drawnCard;
  room.gameState.discardPile.push(discarded);

  room.gameState.drawnCard = null;
  room.gameState.drawnBy = null;

  return { discarded, newHand: hand };
}

// Player discards drawn card (to use its rule or just toss it)
function discardDrawnCard(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;
  if (room.gameState.drawnBy !== playerId) return null;
  if (!room.gameState.drawnCard) return null;

  const card = room.gameState.drawnCard;
  room.gameState.discardPile.push(card);
  room.gameState.drawnCard = null;
  room.gameState.drawnBy = null;

  return card;
}

// Peek at one of your own cards (7 or 8 rule)
function peekOwnCard(roomCode, playerId, handIndex) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  const hand = room.gameState.hands[playerId];
  if (!hand || handIndex < 0 || handIndex >= hand.length) return null;
  if (hand[handIndex] === null) return null; // empty slot

  return hand[handIndex];
}

// Peek at someone else's card (9 or 10 rule)
function peekOtherCard(roomCode, targetPlayerId, handIndex) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  const hand = room.gameState.hands[targetPlayerId];
  if (!hand || handIndex < 0 || handIndex >= hand.length) return null;
  if (hand[handIndex] === null) return null; // empty slot

  return hand[handIndex];
}

// Blind switch: swap a card between any two players (J/Q rule)
function blindSwitch(roomCode, playerAId, indexA, playerBId, indexB) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  const handA = room.gameState.hands[playerAId];
  const handB = room.gameState.hands[playerBId];
  if (!handA || !handB) return null;
  if (indexA < 0 || indexA >= handA.length) return null;
  if (indexB < 0 || indexB >= handB.length) return null;
  if (handA[indexA] === null || handB[indexB] === null) return null; // can't switch empty slots

  const temp = handA[indexA];
  handA[indexA] = handB[indexB];
  handB[indexB] = temp;

  return true;
}

// Black king: peek at any two cards on the table, then optionally blind switch
function blackKingPeek(roomCode, targetPlayerId1, index1, targetPlayerId2, index2) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  const hand1 = room.gameState.hands[targetPlayerId1];
  const hand2 = room.gameState.hands[targetPlayerId2];
  if (!hand1 || !hand2) return null;
  if (index1 < 0 || index1 >= hand1.length) return null;
  if (index2 < 0 || index2 >= hand2.length) return null;
  if (hand1[index1] === null || hand2[index2] === null) return null; // can't peek empty slots

  return {
    card1: hand1[index1],
    card2: hand2[index2],
  };
}

// Place a card into a hand, preferring empty slots over appending
function addCardToHand(hand, card) {
  const emptyIndex = hand.indexOf(null);
  if (emptyIndex !== -1) {
    hand[emptyIndex] = card;
    return emptyIndex;
  }
  hand.push(card);
  return hand.length - 1;
}

function advanceTurn(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState || !room.gameState.turnOrder) return null;

  room.gameState.turnIndex =
    (room.gameState.turnIndex + 1) % room.gameState.turnOrder.length;

  // Clean up drawn card state
  room.gameState.drawnCard = null;
  room.gameState.drawnBy = null;

  return room.gameState.turnOrder[room.gameState.turnIndex];
}

function getTopDiscard(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;
  const pile = room.gameState.discardPile;
  return pile.length > 0 ? pile[pile.length - 1] : null;
}

// Check if two cards match by rank
function cardsMatchByRank(cardA, cardB) {
  if (!cardA || !cardB) return false;
  return cardA.rank === cardB.rank;
}

// Call match on your own card: reveal it, check against top discard
function callMatchOwn(roomCode, callerId, handIndex) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  const topDiscard = getTopDiscard(roomCode);
  if (!topDiscard) return null;

  const hand = room.gameState.hands[callerId];
  if (!hand || handIndex < 0 || handIndex >= hand.length) return null;
  if (hand[handIndex] === null) return null; // can't match empty slot

  const revealedCard = hand[handIndex];
  const isMatch = cardsMatchByRank(revealedCard, topDiscard);

  if (isMatch) {
    // Set slot to null (gap) instead of splice, add to discard pile
    hand[handIndex] = null;
    room.gameState.discardPile.push(revealedCard);
    return { success: true, card: revealedCard, newHand: hand };
  } else {
    // Penalty: draw a card from deck and append to hand
    if (room.gameState.deck.length > 0) {
      const penaltyCard = room.gameState.deck.pop();
      addCardToHand(hand, penaltyCard);
      return { success: false, card: revealedCard, penaltyCard, newHand: hand };
    }
    return { success: false, card: revealedCard, penaltyCard: null, newHand: hand };
  }
}

// Call match on another player's card: reveal it, check against top discard
function callMatchOther(roomCode, callerId, targetPlayerId, targetIndex) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  const topDiscard = getTopDiscard(roomCode);
  if (!topDiscard) return null;

  const targetHand = room.gameState.hands[targetPlayerId];
  if (!targetHand || targetIndex < 0 || targetIndex >= targetHand.length) return null;
  if (targetHand[targetIndex] === null) return null; // can't match empty slot

  const revealedCard = targetHand[targetIndex];
  const isMatch = cardsMatchByRank(revealedCard, topDiscard);

  if (isMatch) {
    // Card matched - don't remove yet, wait for caller to give a card
    return { success: true, card: revealedCard, targetIndex };
  } else {
    // Penalty: caller draws a card from deck
    const callerHand = room.gameState.hands[callerId];
    if (!callerHand) return null;
    if (room.gameState.deck.length > 0) {
      const penaltyCard = room.gameState.deck.pop();
      addCardToHand(callerHand, penaltyCard);
      return { success: false, card: revealedCard, penaltyCard, callerHand };
    }
    return { success: false, card: revealedCard, penaltyCard: null, callerHand };
  }
}

// After a successful match-other: caller gives one of their cards to target,
// and target's matched card is discarded
function giveCardAfterMatch(roomCode, callerId, callerHandIndex, targetPlayerId, targetIndex) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  const callerHand = room.gameState.hands[callerId];
  const targetHand = room.gameState.hands[targetPlayerId];
  if (!callerHand || !targetHand) return null;
  if (callerHandIndex < 0 || callerHandIndex >= callerHand.length) return null;
  if (callerHand[callerHandIndex] === null) return null; // can't give empty slot
  if (targetIndex < 0 || targetIndex >= targetHand.length) return null;

  // Set matched card slot to null (gap) and discard it
  const matchedCard = targetHand[targetIndex];
  targetHand[targetIndex] = null;
  room.gameState.discardPile.push(matchedCard);

  // Set given card slot to null (gap) and place in target's hand (prefer empty slot)
  const givenCard = callerHand[callerHandIndex];
  callerHand[callerHandIndex] = null;
  const placedIndex = addCardToHand(targetHand, givenCard);

  return {
    matchedCard,
    givenCard,
    callerHand,
    targetHand,
    placedIndex,
  };
}

// Get hand layouts: for each player, an array of booleans (true = card, false = empty slot)
function getHandLayouts(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return {};
  const layouts = {};
  for (const [playerId, hand] of Object.entries(room.gameState.hands)) {
    layouts[playerId] = hand.map((card) => card !== null);
  }
  return layouts;
}

// Call Red King: declare you have the lowest score, triggering redemption round
function callRedKing(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState || room.gameState.phase !== 'play') return null;
  if (getCurrentTurnPlayer(roomCode) !== playerId) return null;
  if (room.gameState.drawnCard) return null; // can't call after drawing

  room.gameState.redKingCaller = playerId;
  room.gameState.phase = 'redemption';

  // Build redemption turn order: everyone except the caller, starting from next player
  const turnOrder = room.gameState.turnOrder;
  const callerIdx = turnOrder.indexOf(playerId);
  const redemptionOrder = [];
  for (let i = 1; i < turnOrder.length; i++) {
    const idx = (callerIdx + i) % turnOrder.length;
    redemptionOrder.push(turnOrder[idx]);
  }

  room.gameState.redemptionOrder = redemptionOrder;
  room.gameState.redemptionIndex = 0;

  // Clean up any drawn card state
  room.gameState.drawnCard = null;
  room.gameState.drawnBy = null;

  return {
    redKingCaller: playerId,
    redemptionOrder,
    currentTurn: redemptionOrder[0],
  };
}

// Advance to the next player's redemption turn, or end redemption
function advanceRedemptionTurn(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState || room.gameState.phase !== 'redemption') return null;

  room.gameState.redemptionIndex++;
  room.gameState.drawnCard = null;
  room.gameState.drawnBy = null;

  if (room.gameState.redemptionIndex >= room.gameState.redemptionOrder.length) {
    room.gameState.phase = 'reveal';
    return { phase: 'reveal' };
  }

  return {
    phase: 'redemption',
    currentTurn: room.gameState.redemptionOrder[room.gameState.redemptionIndex],
  };
}

// Calculate final scores and determine the winner
function getGameResults(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState) return null;

  const callerId = room.gameState.redKingCaller;
  const results = [];

  for (const player of room.players) {
    const hand = room.gameState.hands[player.id];
    if (!hand) continue;
    const score = getPlayerScore(hand);
    results.push({
      id: player.id,
      name: player.name,
      hand: hand.filter((c) => c !== null),
      score,
      isCaller: player.id === callerId,
    });
  }

  // Sort by score ascending (lowest is best)
  results.sort((a, b) => a.score - b.score);

  const lowestScore = results[0].score;
  const playersWithLowest = results.filter((r) => r.score === lowestScore);

  let winnerId;
  if (playersWithLowest.length === 1) {
    winnerId = playersWithLowest[0].id;
  } else {
    // Tie: non-caller wins over caller
    const nonCallerTied = playersWithLowest.filter((r) => r.id !== callerId);
    winnerId = nonCallerTied.length > 0 ? nonCallerTied[0].id : playersWithLowest[0].id;
  }

  const winner = results.find((r) => r.id === winnerId);
  const caller = results.find((r) => r.id === callerId);

  return {
    results,
    winnerId,
    winnerName: winner ? winner.name : 'Unknown',
    callerId,
    callerName: caller ? caller.name : 'Unknown',
  };
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoomByCode,
  getRoomBySocketId,
  setRoomState,
  dealCards,
  clearGameState,
  setGamePhase,
  getCurrentTurnPlayer,
  drawCard,
  canUseRule,
  getRuleType,
  keepCard,
  discardDrawnCard,
  peekOwnCard,
  peekOtherCard,
  blindSwitch,
  blackKingPeek,
  advanceTurn,
  getTopDiscard,
  getCardPoints,
  getPlayerScore,
  callMatchOwn,
  callMatchOther,
  giveCardAfterMatch,
  getHandLayouts,
  callRedKing,
  advanceRedemptionTurn,
  getGameResults,
};
