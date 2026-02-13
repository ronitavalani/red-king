const {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoomBySocketId,
  setRoomState,
  dealCards,
  clearGameState,
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
} = require('./roomManager');

function getPlayerName(room, playerId) {
  const p = room.players.find((pl) => pl.id === playerId);
  return p ? p.name : 'Unknown';
}

function checkPeekComplete(io, room) {
  if (
    room.gameState &&
    room.gameState.phase === 'peek' &&
    room.gameState.peekDone.size >= room.players.length
  ) {
    room.gameState.phase = 'play';
    const currentTurn = getCurrentTurnPlayer(room.code);
    io.to(room.code).emit('phase-changed', {
      phase: 'play',
      currentTurn,
      topDiscard: null,
    });
  }
}

function emitTurnState(io, room) {
  const currentTurn = getCurrentTurnPlayer(room.code);
  const topDiscard = getTopDiscard(room.code);
  io.to(room.code).emit('turn-update', {
    currentTurn,
    deckCount: room.gameState.deck.length,
    topDiscard,
  });
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

  // --- GAMEPLAY EVENTS ---

  socket.on('draw-card', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.phase !== 'play') return;

    const card = drawCard(room.code, socket.id);
    if (!card) return;

    const hasRule = canUseRule(card);
    const ruleType = getRuleType(card);

    // Only the drawing player sees the card
    socket.emit('card-drawn', { card, hasRule, ruleType });

    // Everyone else sees that a card was drawn
    socket.to(room.code).emit('opponent-drew', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      deckCount: room.gameState.deck.length,
    });
  });

  socket.on('keep-card', ({ handIndex }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    const result = keepCard(room.code, socket.id, handIndex);
    if (!result) return;

    // Send the updated hand privately
    socket.emit('hand-updated', {
      myCards: room.gameState.hands[socket.id],
    });

    // Notify everyone about the discard and turn advance
    io.to(room.code).emit('card-discarded', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      card: result.discarded,
      action: 'kept drawn card',
    });

    // Highlight the swapped card position for all players
    io.to(room.code).emit('cards-highlighted', {
      cards: [{ playerId: socket.id, index: handIndex }],
      type: 'swap',
    });

    advanceTurn(room.code);
    emitTurnState(io, room);
  });

  socket.on('discard-card', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    const drawnCard = room.gameState.drawnCard;
    if (!drawnCard) return;

    const hasRule = canUseRule(drawnCard);
    const ruleType = getRuleType(drawnCard);

    const card = discardDrawnCard(room.code, socket.id);
    if (!card) return;

    // If the card has a rule, notify the player they can now execute it
    if (hasRule && ruleType) {
      socket.emit('execute-rule', { ruleType, card });
      // Tell everyone the player is using a rule
      io.to(room.code).emit('card-discarded', {
        playerId: socket.id,
        playerName: getPlayerName(room, socket.id),
        card,
        action: `using ${ruleType} rule`,
      });
    } else {
      // No rule, just discard and advance turn
      io.to(room.code).emit('card-discarded', {
        playerId: socket.id,
        playerName: getPlayerName(room, socket.id),
        card,
        action: 'discarded',
      });
      const nextTurn = advanceTurn(room.code);
      emitTurnState(io, room);
    }
  });

  // Skip using a rule - just end turn
  socket.on('skip-rule', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} skipped using the card rule`,
    });

    advanceTurn(room.code);
    emitTurnState(io, room);
  });

  // 7 or 8: Peek at own card
  socket.on('use-peek-own', ({ handIndex }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    const card = peekOwnCard(room.code, socket.id, handIndex);
    if (!card) return;

    socket.emit('peek-result', { card, handIndex });

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} peeked at one of their own cards`,
    });

    advanceTurn(room.code);
    emitTurnState(io, room);
  });

  // 9 or 10: Peek at someone else's card
  socket.on('use-peek-other', ({ targetPlayerId, handIndex }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    const card = peekOtherCard(room.code, targetPlayerId, handIndex);
    if (!card) return;

    socket.emit('peek-result', { card, handIndex, targetPlayerId });

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} peeked at one of ${getPlayerName(room, targetPlayerId)}'s cards`,
    });

    advanceTurn(room.code);
    emitTurnState(io, room);
  });

  // J or Q: Blind switch
  socket.on('use-blind-switch', ({ playerAId, indexA, playerBId, indexB }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    const result = blindSwitch(room.code, playerAId, indexA, playerBId, indexB);
    if (!result) return;

    // Send updated hands to affected players
    if (room.gameState.hands[playerAId]) {
      io.to(playerAId).emit('hand-updated', {
        myCards: room.gameState.hands[playerAId],
      });
    }
    if (room.gameState.hands[playerBId]) {
      io.to(playerBId).emit('hand-updated', {
        myCards: room.gameState.hands[playerBId],
      });
    }

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} blind switched a card between ${getPlayerName(room, playerAId)} and ${getPlayerName(room, playerBId)}`,
    });

    // Highlight both switched card positions for all players
    io.to(room.code).emit('cards-highlighted', {
      cards: [
        { playerId: playerAId, index: indexA },
        { playerId: playerBId, index: indexB },
      ],
      type: 'switch',
    });

    advanceTurn(room.code);
    emitTurnState(io, room);
  });

  // Black King: peek at two cards then optionally blind switch
  socket.on('use-black-king-peek', ({ target1PlayerId, index1, target2PlayerId, index2 }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    const result = blackKingPeek(room.code, target1PlayerId, index1, target2PlayerId, index2);
    if (!result) return;

    socket.emit('black-king-peek-result', {
      card1: result.card1,
      target1PlayerId,
      index1,
      card2: result.card2,
      target2PlayerId,
      index2,
    });

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} is looking at two cards on the table...`,
    });
  });

  // Black King: after peeking, optionally do a blind switch
  socket.on('use-black-king-switch', ({ playerAId, indexA, playerBId, indexB }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    const result = blindSwitch(room.code, playerAId, indexA, playerBId, indexB);
    if (!result) return;

    if (room.gameState.hands[playerAId]) {
      io.to(playerAId).emit('hand-updated', {
        myCards: room.gameState.hands[playerAId],
      });
    }
    if (room.gameState.hands[playerBId]) {
      io.to(playerBId).emit('hand-updated', {
        myCards: room.gameState.hands[playerBId],
      });
    }

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} switched cards between ${getPlayerName(room, playerAId)} and ${getPlayerName(room, playerBId)}`,
    });

    // Highlight both switched card positions for all players
    io.to(room.code).emit('cards-highlighted', {
      cards: [
        { playerId: playerAId, index: indexA },
        { playerId: playerBId, index: indexB },
      ],
      type: 'switch',
    });

    advanceTurn(room.code);
    emitTurnState(io, room);
  });

  // Black King: skip the switch after peeking
  socket.on('use-black-king-skip', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} chose not to switch any cards`,
    });

    advanceTurn(room.code);
    emitTurnState(io, room);
  });

  // --- END GAMEPLAY EVENTS ---

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
