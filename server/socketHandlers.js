const {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoomBySocketId,
  setRoomState,
  dealCards,
  clearGameState,
} = require('./roomManager');

function checkPeekComplete(io, room) {
  if (
    room.gameState &&
    room.gameState.phase === 'peek' &&
    room.gameState.peekDone.size >= room.players.length
  ) {
    room.gameState.phase = 'play';
    io.to(room.code).emit('phase-changed', { phase: 'play' });
  }
}

function registerSocketHandlers(io, socket) {
  socket.on('host-game', ({ playerName }) => {
    const room = createRoom(socket.id, playerName);
    socket.join(room.code);
    socket.emit('room-created', {
      roomCode: room.code,
      players: room.players,
      you: room.players[0],
    });
  });

  socket.on('join-game', ({ playerName, roomCode }) => {
    const result = joinRoom(roomCode.toUpperCase(), socket.id, playerName);
    if (!result.success) {
      socket.emit('join-error', { message: result.error });
      return;
    }
    socket.join(result.room.code);
    const you = result.room.players.find((p) => p.id === socket.id);
    socket.emit('room-joined', {
      roomCode: result.room.code,
      players: result.room.players,
      you,
      roomState: result.room.state,
    });
    socket.to(result.room.code).emit('player-list-updated', {
      players: result.room.players,
    });
  });

  socket.on('start-game', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || room.hostId !== socket.id) return;

    setRoomState(room.code, 'playing');
    const updatedRoom = dealCards(room.code);
    if (!updatedRoom) return;

    // Send each player ONLY their own cards (private)
    for (const player of updatedRoom.players) {
      io.to(player.id).emit('cards-dealt', {
        myCards: updatedRoom.gameState.hands[player.id],
        phase: updatedRoom.gameState.phase,
        deckCount: updatedRoom.gameState.deck.length,
        opponents: updatedRoom.players
          .filter((p) => p.id !== player.id)
          .map((p) => ({ id: p.id, name: p.name, cardCount: 4 })),
      });
    }

    io.to(updatedRoom.code).emit('game-started', {
      phase: updatedRoom.gameState.phase,
    });
  });

  socket.on('end-game', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;
    clearGameState(room.code);
    setRoomState(room.code, 'waiting');
    io.to(room.code).emit('game-ended', { players: room.players });
  });

  socket.on('peek-done', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.phase !== 'peek') return;

    room.gameState.peekDone.add(socket.id);
    io.to(room.code).emit('player-peek-done', { playerId: socket.id });

    checkPeekComplete(io, room);
  });

  socket.on('leave-room', () => {
    const { room, wasHost, isEmpty } = leaveRoom(socket.id);
    if (!isEmpty && room) {
      socket.leave(room.code);
      io.to(room.code).emit('player-list-updated', { players: room.players });
      if (wasHost) {
        io.to(room.code).emit('host-changed', { newHostId: room.hostId });
      }
      // Check if remaining players have all peeked
      checkPeekComplete(io, room);
    }
    socket.emit('you-left', {});
  });

  socket.on('disconnect', () => {
    const { room, wasHost, isEmpty } = leaveRoom(socket.id);
    if (room && !isEmpty) {
      io.to(room.code).emit('player-list-updated', { players: room.players });
      if (wasHost) {
        io.to(room.code).emit('host-changed', { newHostId: room.hostId });
      }
      // Check if remaining players have all peeked
      checkPeekComplete(io, room);
    }
  });
}

module.exports = { registerSocketHandlers };
