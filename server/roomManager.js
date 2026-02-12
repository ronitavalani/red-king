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

  room.gameState = {
    deck,
    hands,
    phase: 'peek',
    peekDone: new Set(),
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
};
