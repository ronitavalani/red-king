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
  callMatchOwn,
  callMatchOther,
  giveCardAfterMatch,
  getHandLayouts,
  callRedKing,
  advanceRedemptionTurn,
  getGameResults,
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

// Check if the phase allows normal gameplay actions (draw, keep, discard, rules, match)
function isPlayablePhase(room) {
  return room.gameState.phase === 'play' || room.gameState.phase === 'redemption';
}

// Check if a player's cards are protected (Red King caller during redemption)
function isProtectedPlayer(room, playerId) {
  return room.gameState.phase === 'redemption' && room.gameState.redKingCaller === playerId;
}

// Advance turn and emit state, handling both play and redemption phases
function advanceAndEmit(io, room) {
  if (room.gameState.phase === 'redemption') {
    const result = advanceRedemptionTurn(room.code);
    if (!result) return;
    if (result.phase === 'reveal') {
      // Redemption is over - calculate and emit game results
      const gameResults = getGameResults(room.code);
      io.to(room.code).emit('game-results', gameResults);
      io.to(room.code).emit('phase-changed', { phase: 'reveal' });
    } else {
      emitTurnState(io, room);
    }
  } else {
    advanceTurn(room.code);
    emitTurnState(io, room);
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

  // --- GAMEPLAY EVENTS ---

  // Call Red King: declare you have the lowest score
  socket.on('call-red-king', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.phase !== 'play') return;

    const result = callRedKing(room.code, socket.id);
    if (!result) return;

    const callerName = getPlayerName(room, socket.id);

    io.to(room.code).emit('red-king-called', {
      callerId: socket.id,
      callerName,
    });

    io.to(room.code).emit('phase-changed', {
      phase: 'redemption',
      currentTurn: result.currentTurn,
      topDiscard: getTopDiscard(room.code),
    });

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: callerName,
      message: `${callerName} called RED KING! Redemption round begins.`,
    });

    // Emit hand layouts so everyone sees the caller's cards are protected
    const layouts = getHandLayouts(room.code);
    io.to(room.code).emit('hand-layouts-updated', { layouts });
  });

  socket.on('draw-card', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState || !isPlayablePhase(room)) return;

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

    advanceAndEmit(io, room);
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
      advanceAndEmit(io, room);
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

    advanceAndEmit(io, room);
  });

  // 7 or 8: Peek at own card (turn advances when player finishes peeking)
  socket.on('use-peek-own', ({ handIndex }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    const card = peekOwnCard(room.code, socket.id, handIndex);
    if (!card) return;

    socket.emit('peek-result', { card, handIndex });

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} is peeking at one of their own cards...`,
    });
  });

  // 9 or 10: Peek at someone else's card (turn advances when player finishes peeking)
  socket.on('use-peek-other', ({ targetPlayerId, handIndex }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;
    // Block peeking at protected player's cards
    if (isProtectedPlayer(room, targetPlayerId)) return;

    const card = peekOtherCard(room.code, targetPlayerId, handIndex);
    if (!card) return;

    socket.emit('peek-result', { card, handIndex, targetPlayerId });

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} is peeking at one of ${getPlayerName(room, targetPlayerId)}'s cards...`,
    });
  });

  // Player finished looking at peeked card - now advance the turn
  socket.on('finish-peek', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
      message: `${getPlayerName(room, socket.id)} finished peeking`,
    });

    advanceAndEmit(io, room);
  });

  // J or Q: Blind switch
  socket.on('use-blind-switch', ({ playerAId, indexA, playerBId, indexB }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;
    // Block switching protected player's cards
    if (isProtectedPlayer(room, playerAId) || isProtectedPlayer(room, playerBId)) return;

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

    advanceAndEmit(io, room);
  });

  // Black King: peek at two cards then optionally blind switch
  socket.on('use-black-king-peek', ({ target1PlayerId, index1, target2PlayerId, index2 }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;
    // Block peeking at protected player's cards
    if (isProtectedPlayer(room, target1PlayerId) || isProtectedPlayer(room, target2PlayerId)) return;

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
    // Block switching protected player's cards
    if (isProtectedPlayer(room, playerAId) || isProtectedPlayer(room, playerBId)) return;

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

    advanceAndEmit(io, room);
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

    advanceAndEmit(io, room);
  });

  // --- MATCH CALLING EVENTS ---

  // Helper: broadcast updated hand layouts to all players
  function emitHandLayouts(room) {
    const layouts = getHandLayouts(room.code);
    io.to(room.code).emit('hand-layouts-updated', { layouts });
  }

  // Call match on your own card
  socket.on('call-match-own', ({ handIndex }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState || !isPlayablePhase(room)) return;
    // Block if caller's cards are protected (caller can't modify own hand during redemption)
    if (isProtectedPlayer(room, socket.id)) return;

    const result = callMatchOwn(room.code, socket.id, handIndex);
    if (!result) return;

    const callerName = getPlayerName(room, socket.id);

    if (result.success) {
      // Correct match - card removed
      socket.emit('hand-updated', { myCards: room.gameState.hands[socket.id] });

      io.to(room.code).emit('match-result', {
        callerId: socket.id,
        callerName,
        targetId: socket.id,
        targetName: callerName,
        card: result.card,
        success: true,
        type: 'own',
      });

      io.to(room.code).emit('card-discarded', {
        playerId: socket.id,
        playerName: callerName,
        card: result.card,
        action: 'matched their own card!',
      });

      emitHandLayouts(room);

      // Highlight the now-empty slot
      io.to(room.code).emit('cards-highlighted', {
        cards: [{ playerId: socket.id, index: handIndex }],
        type: 'match',
      });
    } else {
      // Wrong - penalty card added
      socket.emit('hand-updated', { myCards: room.gameState.hands[socket.id] });

      io.to(room.code).emit('match-result', {
        callerId: socket.id,
        callerName,
        targetId: socket.id,
        targetName: callerName,
        card: result.card,
        success: false,
        type: 'own',
      });

      io.to(room.code).emit('action-log', {
        playerId: socket.id,
        playerName: callerName,
        message: `${callerName} called a wrong match and took a penalty card`,
      });

      emitHandLayouts(room);

      // Update deck count for everyone
      io.to(room.code).emit('turn-update', {
        currentTurn: getCurrentTurnPlayer(room.code),
        deckCount: room.gameState.deck.length,
        topDiscard: room.gameState.discardPile.length > 0
          ? room.gameState.discardPile[room.gameState.discardPile.length - 1]
          : null,
      });
    }
  });

  // Call match on another player's card
  socket.on('call-match-other', ({ targetPlayerId, handIndex }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState || !isPlayablePhase(room)) return;
    // Block if targeting protected player or if caller is protected
    if (isProtectedPlayer(room, targetPlayerId)) return;
    if (isProtectedPlayer(room, socket.id)) return;

    const result = callMatchOther(room.code, socket.id, targetPlayerId, handIndex);
    if (!result) return;

    const callerName = getPlayerName(room, socket.id);
    const targetName = getPlayerName(room, targetPlayerId);

    if (result.success) {
      // Correct match - tell caller to pick a card to give
      io.to(room.code).emit('match-result', {
        callerId: socket.id,
        callerName,
        targetId: targetPlayerId,
        targetName,
        card: result.card,
        success: true,
        type: 'other',
        targetIndex: result.targetIndex,
      });
    } else {
      // Wrong - penalty card added to caller
      socket.emit('hand-updated', { myCards: result.callerHand });

      io.to(room.code).emit('match-result', {
        callerId: socket.id,
        callerName,
        targetId: targetPlayerId,
        targetName,
        card: result.card,
        success: false,
        type: 'other',
      });

      io.to(room.code).emit('action-log', {
        playerId: socket.id,
        playerName: callerName,
        message: `${callerName} called a wrong match on ${targetName}'s card and took a penalty card`,
      });

      emitHandLayouts(room);

      io.to(room.code).emit('turn-update', {
        currentTurn: getCurrentTurnPlayer(room.code),
        deckCount: room.gameState.deck.length,
        topDiscard: room.gameState.discardPile.length > 0
          ? room.gameState.discardPile[room.gameState.discardPile.length - 1]
          : null,
      });
    }
  });

  // After successful match-other: caller gives one of their cards to the target
  socket.on('give-card-after-match', ({ callerHandIndex, targetPlayerId, targetIndex }) => {
    const room = getRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;
    // Block giving cards to protected player
    if (isProtectedPlayer(room, targetPlayerId)) return;

    const result = giveCardAfterMatch(room.code, socket.id, callerHandIndex, targetPlayerId, targetIndex);
    if (!result) return;

    const callerName = getPlayerName(room, socket.id);
    const targetName = getPlayerName(room, targetPlayerId);

    // Update both players' hands
    socket.emit('hand-updated', { myCards: result.callerHand });
    io.to(targetPlayerId).emit('hand-updated', { myCards: result.targetHand });

    io.to(room.code).emit('card-discarded', {
      playerId: socket.id,
      playerName: callerName,
      card: result.matchedCard,
      action: `matched ${targetName}'s card and gave them a card`,
    });

    io.to(room.code).emit('action-log', {
      playerId: socket.id,
      playerName: callerName,
      message: `${callerName} gave a card to ${targetName}`,
    });

    emitHandLayouts(room);

    // Highlight: caller's now-empty slot and target's new card slot
    io.to(room.code).emit('cards-highlighted', {
      cards: [
        { playerId: socket.id, index: callerHandIndex },
        { playerId: targetPlayerId, index: result.placedIndex },
      ],
      type: 'match',
    });

    io.to(room.code).emit('turn-update', {
      currentTurn: getCurrentTurnPlayer(room.code),
      deckCount: room.gameState.deck.length,
      topDiscard: room.gameState.discardPile.length > 0
        ? room.gameState.discardPile[room.gameState.discardPile.length - 1]
        : null,
    });
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
