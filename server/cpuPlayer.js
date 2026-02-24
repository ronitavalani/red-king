'use strict';

const {
  getCurrentTurnPlayer,
  drawCard,
  keepCard,
  discardDrawnCard,
  canUseRule,
  getRuleType,
  peekOwnCard,
  peekOtherCard,
  blindSwitch,
  blackKingPeek,
  advanceTurn,
  advanceRedemptionTurn,
  getTopDiscard,
  getCardPoints,
  getPlayerScore,
  getHandLayouts,
  callRedKing,
  callMatchOwn,
  getGameResults,
  getRoomByCode,
} = require('./roomManager');

// ── BotPlayer (base class) ────────────────────────────────────────────────────
// Holds all infrastructure: memory, turn execution, socket emissions.
// Subclass and override the four strategy methods to create custom bots.

class BotPlayer {
  constructor(botId, difficulty = 'medium') {
    this.botId = botId;
    this.difficulty = difficulty;
    // memory: Map<slotKey, card>
    // slotKey: number (own slot index) | string "opp:playerId:idx" (peeked opponent)
    this.memory = new Map();
  }

  // ── Memory helpers ──────────────────────────────────────────────────────────
  remember(key, card) { this.memory.set(key, card); }
  forget(key)         { this.memory.delete(key); }
  clearMemory()       { this.memory.clear(); }
  known(slotIndex)    { return this.memory.get(slotIndex); }

  // ── Strategy methods — override in subclasses ───────────────────────────────

  /** Return true to call Red King before drawing. */
  // eslint-disable-next-line no-unused-vars
  shouldCallRedKing(room) { return false; }

  /**
   * Decide what to do with the drawn card.
   * @returns {{ action: 'keep'|'discard', slotIndex?: number }}
   */
  // eslint-disable-next-line no-unused-vars
  decideKeepOrDiscard(room, drawnCard) { return { action: 'discard' }; }

  /**
   * Decide how to use a rule card.
   * @returns {{ use: boolean, [key: string]: any }}
   */
  // eslint-disable-next-line no-unused-vars
  decideRuleUsage(room, ruleType) { return { use: false }; }

  /**
   * Return true to opportunistically match own card at slotIndex.
   * Called after every discard that changes the top of the pile.
   */
  // eslint-disable-next-line no-unused-vars
  shouldMatchOwn(room, slotIndex, knownCard, topDiscard) { return false; }

  // ── Infrastructure — not normally overridden ─────────────────────────────────

  /** Auto-complete peek phase: remember indices 2 & 3 and signal done. */
  peekPhase(io, room) {
    const hand = room.gameState.hands[this.botId];
    if (!hand) return;

    // Remember the last two cards (indices 2 and 3) as the game rules allow
    for (const idx of [2, 3]) {
      if (hand[idx] != null) {
        this.remember(idx, hand[idx]);
      }
    }

    room.gameState.peekDone.add(this.botId);
    io.to(room.code).emit('player-peek-done', { playerId: this.botId });
  }

  /** Execute a full turn: RK check → draw → keep/discard → rule → advance. */
  executeTurn(io, room) {
    if (!room.gameState) return;
    if (room.gameState.pendingBotTurn) room.gameState.pendingBotTurn = false;

    const phase = room.gameState.phase;
    if (phase !== 'play' && phase !== 'redemption') return;

    const currentId = getCurrentTurnPlayer(room.code);
    if (currentId !== this.botId) return;

    const botName = room.players.find((p) => p.id === this.botId)?.name || 'CPU';

    // 1. Check if bot wants to call Red King (play phase only, before drawing)
    if (phase === 'play' && !room.gameState.drawnCard && this.shouldCallRedKing(room)) {
      const result = callRedKing(room.code, this.botId);
      if (result) {
        io.to(room.code).emit('red-king-called', {
          callerId: this.botId,
          callerName: botName,
        });
        io.to(room.code).emit('phase-changed', {
          phase: 'redemption',
          currentTurn: result.currentTurn,
          topDiscard: getTopDiscard(room.code),
        });
        io.to(room.code).emit('action-log', {
          playerId: this.botId,
          playerName: botName,
          message: `${botName} called RED KING! Redemption round begins.`,
        });
        const layouts = getHandLayouts(room.code);
        io.to(room.code).emit('hand-layouts-updated', { layouts });
        scheduleBotTurn(io, room, 1500);
        return;
      }
    }

    // 2. Draw a card
    const drawnCard = drawCard(room.code, this.botId);
    if (!drawnCard) {
      // Empty deck — advance turn
      botAdvanceAndEmit(io, room);
      return;
    }

    io.to(room.code).emit('opponent-drew', {
      playerId: this.botId,
      playerName: botName,
      deckCount: room.gameState.deck.length,
    });

    // 3. Decide keep or discard
    const decision = this.decideKeepOrDiscard(room, drawnCard);

    if (decision.action === 'keep' && decision.slotIndex != null) {
      const result = keepCard(room.code, this.botId, decision.slotIndex);
      if (result) {
        this.remember(decision.slotIndex, drawnCard);
        io.to(room.code).emit('card-discarded', {
          playerId: this.botId,
          playerName: botName,
          card: result.discarded,
          action: 'kept drawn card',
        });
        io.to(room.code).emit('cards-highlighted', {
          cards: [{ playerId: this.botId, index: decision.slotIndex }],
          type: 'swap',
        });
        io.to(room.code).emit('action-log', {
          playerId: this.botId,
          playerName: botName,
          message: `${botName} kept a card`,
        });
        checkBotMatches(io, room);
        botAdvanceAndEmit(io, room);
        return;
      }
    }

    // Default: discard the drawn card
    const discarded = discardDrawnCard(room.code, this.botId);
    if (!discarded) {
      botAdvanceAndEmit(io, room);
      return;
    }

    const hasRule = canUseRule(discarded);
    const ruleType = getRuleType(discarded);

    if (hasRule && ruleType) {
      io.to(room.code).emit('card-discarded', {
        playerId: this.botId,
        playerName: botName,
        card: discarded,
        action: `using ${ruleType} rule`,
      });

      const ruleDecision = this.decideRuleUsage(room, ruleType);
      this._executeRule(io, room, ruleType, ruleDecision, botName);
    } else {
      io.to(room.code).emit('card-discarded', {
        playerId: this.botId,
        playerName: botName,
        card: discarded,
        action: 'discarded',
      });
      io.to(room.code).emit('action-log', {
        playerId: this.botId,
        playerName: botName,
        message: `${botName} discarded a card`,
      });
      checkBotMatches(io, room);
      botAdvanceAndEmit(io, room);
    }
  }

  /** Execute a rule card action based on the decision returned by decideRuleUsage. */
  _executeRule(io, room, ruleType, decision, botName) {
    if (!decision.use) {
      io.to(room.code).emit('action-log', {
        playerId: this.botId,
        playerName: botName,
        message: `${botName} skipped using the card rule`,
      });
      checkBotMatches(io, room);
      botAdvanceAndEmit(io, room);
      return;
    }

    if (ruleType === 'peek-own') {
      const idx = decision.handIndex;
      const card = peekOwnCard(room.code, this.botId, idx);
      if (card) {
        this.remember(idx, card);
        io.to(room.code).emit('action-log', {
          playerId: this.botId,
          playerName: botName,
          message: `${botName} peeked at one of their own cards`,
        });
      }
      checkBotMatches(io, room);
      botAdvanceAndEmit(io, room);

    } else if (ruleType === 'peek-other') {
      const { targetPlayerId, handIndex } = decision;
      const card = peekOtherCard(room.code, targetPlayerId, handIndex);
      if (card) {
        this.remember(`opp:${targetPlayerId}:${handIndex}`, card);
        const targetName = room.players.find((p) => p.id === targetPlayerId)?.name || 'opponent';
        io.to(room.code).emit('action-log', {
          playerId: this.botId,
          playerName: botName,
          message: `${botName} peeked at one of ${targetName}'s cards`,
        });
      }
      checkBotMatches(io, room);
      botAdvanceAndEmit(io, room);

    } else if (ruleType === 'blind-switch') {
      const { playerAId, indexA, playerBId, indexB } = decision;
      const result = blindSwitch(room.code, playerAId, indexA, playerBId, indexB);
      if (result) {
        // Invalidate memory for swapped slots
        invalidateBotMemoryIfNeeded(playerAId, indexA, room);
        invalidateBotMemoryIfNeeded(playerBId, indexB, room);
        const nameA = room.players.find((p) => p.id === playerAId)?.name || 'player';
        const nameB = room.players.find((p) => p.id === playerBId)?.name || 'player';
        io.to(room.code).emit('action-log', {
          playerId: this.botId,
          playerName: botName,
          message: `${botName} blind switched a card between ${nameA} and ${nameB}`,
        });
        io.to(room.code).emit('cards-highlighted', {
          cards: [
            { playerId: playerAId, index: indexA },
            { playerId: playerBId, index: indexB },
          ],
          type: 'switch',
        });
        // Notify affected human players of their updated hand
        if (!room.players.find((p) => p.id === playerAId)?.isCpu) {
          io.to(playerAId).emit('hand-updated', { myCards: room.gameState.hands[playerAId] });
        }
        if (!room.players.find((p) => p.id === playerBId)?.isCpu) {
          io.to(playerBId).emit('hand-updated', { myCards: room.gameState.hands[playerBId] });
        }
      }
      checkBotMatches(io, room);
      botAdvanceAndEmit(io, room);

    } else if (ruleType === 'black-king') {
      const { target1PlayerId, index1, target2PlayerId, index2 } = decision;
      const peekResult = blackKingPeek(room.code, target1PlayerId, index1, target2PlayerId, index2);
      if (peekResult) {
        this.remember(`opp:${target1PlayerId}:${index1}`, peekResult.card1);
        this.remember(`opp:${target2PlayerId}:${index2}`, peekResult.card2);

        io.to(room.code).emit('action-log', {
          playerId: this.botId,
          playerName: botName,
          message: `${botName} looked at two cards on the table`,
        });

        // Optionally switch after peeking (HardBot override)
        if (decision.doSwitch) {
          const switchResult = blindSwitch(
            room.code, target1PlayerId, index1, target2PlayerId, index2
          );
          if (switchResult) {
            invalidateBotMemoryIfNeeded(target1PlayerId, index1, room);
            invalidateBotMemoryIfNeeded(target2PlayerId, index2, room);
            const n1 = room.players.find((p) => p.id === target1PlayerId)?.name || 'player';
            const n2 = room.players.find((p) => p.id === target2PlayerId)?.name || 'player';
            io.to(room.code).emit('action-log', {
              playerId: this.botId,
              playerName: botName,
              message: `${botName} switched cards between ${n1} and ${n2}`,
            });
            io.to(room.code).emit('cards-highlighted', {
              cards: [
                { playerId: target1PlayerId, index: index1 },
                { playerId: target2PlayerId, index: index2 },
              ],
              type: 'switch',
            });
            if (!room.players.find((p) => p.id === target1PlayerId)?.isCpu) {
              io.to(target1PlayerId).emit('hand-updated', { myCards: room.gameState.hands[target1PlayerId] });
            }
            if (!room.players.find((p) => p.id === target2PlayerId)?.isCpu) {
              io.to(target2PlayerId).emit('hand-updated', { myCards: room.gameState.hands[target2PlayerId] });
            }
          }
        }
      }
      checkBotMatches(io, room);
      botAdvanceAndEmit(io, room);

    } else {
      // Unknown rule — skip
      checkBotMatches(io, room);
      botAdvanceAndEmit(io, room);
    }
  }

  /** Scan memory for matches against top discard; call match if shouldMatchOwn returns true. */
  checkMatches(io, room) {
    if (!room.gameState) return;
    const topDiscard = getTopDiscard(room.code);
    if (!topDiscard) return;

    const hand = room.gameState.hands[this.botId];
    if (!hand) return;

    const botName = room.players.find((p) => p.id === this.botId)?.name || 'CPU';

    for (const [key, knownCard] of this.memory.entries()) {
      // Only check own slots (numeric keys)
      if (typeof key !== 'number') continue;
      const slotIndex = key;
      if (slotIndex < 0 || slotIndex >= hand.length) continue;
      if (hand[slotIndex] === null) {
        this.forget(slotIndex);
        continue;
      }
      // Verify the card in memory still matches what's actually there
      if (hand[slotIndex].id !== knownCard.id) {
        this.forget(slotIndex);
        continue;
      }

      if (this.shouldMatchOwn(room, slotIndex, knownCard, topDiscard)) {
        const result = callMatchOwn(room.code, this.botId, slotIndex);
        if (result && result.success) {
          this.forget(slotIndex);
          io.to(room.code).emit('match-result', {
            callerId: this.botId,
            callerName: botName,
            targetId: this.botId,
            targetName: botName,
            card: result.card,
            success: true,
            type: 'own',
          });
          io.to(room.code).emit('card-discarded', {
            playerId: this.botId,
            playerName: botName,
            card: result.card,
            action: 'matched their own card!',
          });
          const layouts = getHandLayouts(room.code);
          io.to(room.code).emit('hand-layouts-updated', { layouts });
          io.to(room.code).emit('cards-highlighted', {
            cards: [{ playerId: this.botId, index: slotIndex }],
            type: 'match',
          });
        }
        // Only attempt one match per discard event
        break;
      }
    }
  }
}

// ── Built-in subclasses ────────────────────────────────────────────────────────

class EasyBot extends BotPlayer {
  shouldCallRedKing(room) {
    const hand = room.gameState.hands[this.botId];
    if (!hand) return false;
    // Estimate score: known cards use actual value, unknowns = 7pts
    let estimated = 0;
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] === null) continue;
      const known = this.known(i);
      estimated += known ? getCardPoints(known) : 7;
    }
    if (estimated >= 10) return false;
    // 50% random gate
    return Math.random() < 0.5;
  }

  decideKeepOrDiscard(room, drawnCard) {
    const hand = room.gameState.hands[this.botId];
    if (!hand) return { action: 'discard' };
    // 40% chance to keep a random non-null slot
    if (Math.random() < 0.4) {
      const validSlots = hand
        .map((c, i) => (c !== null ? i : -1))
        .filter((i) => i !== -1);
      if (validSlots.length > 0) {
        const slotIndex = validSlots[Math.floor(Math.random() * validSlots.length)];
        return { action: 'keep', slotIndex };
      }
    }
    return { action: 'discard' };
  }

  decideRuleUsage(room, ruleType) {
    if (Math.random() < 0.5) return { use: false };

    const hand = room.gameState.hands[this.botId];
    const opponents = room.players.filter((p) => p.id !== this.botId && room.gameState.hands[p.id]);

    if (ruleType === 'peek-own') {
      const validSlots = hand ? hand.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (validSlots.length === 0) return { use: false };
      return { use: true, handIndex: validSlots[Math.floor(Math.random() * validSlots.length)] };
    }

    if (ruleType === 'peek-other') {
      if (opponents.length === 0) return { use: false };
      const opp = opponents[Math.floor(Math.random() * opponents.length)];
      const oppHand = room.gameState.hands[opp.id];
      const validSlots = oppHand ? oppHand.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (validSlots.length === 0) return { use: false };
      return {
        use: true,
        targetPlayerId: opp.id,
        handIndex: validSlots[Math.floor(Math.random() * validSlots.length)],
      };
    }

    if (ruleType === 'blind-switch') {
      const allPlayers = room.players.filter((p) => room.gameState.hands[p.id]);
      if (allPlayers.length < 2) return { use: false };
      const pA = allPlayers[Math.floor(Math.random() * allPlayers.length)];
      const handA = room.gameState.hands[pA.id];
      const slotsA = handA ? handA.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (slotsA.length === 0) return { use: false };

      let pB = allPlayers[Math.floor(Math.random() * allPlayers.length)];
      const handB = room.gameState.hands[pB.id];
      const slotsB = handB ? handB.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (slotsB.length === 0) return { use: false };

      return {
        use: true,
        playerAId: pA.id,
        indexA: slotsA[Math.floor(Math.random() * slotsA.length)],
        playerBId: pB.id,
        indexB: slotsB[Math.floor(Math.random() * slotsB.length)],
      };
    }

    if (ruleType === 'black-king') {
      const allPlayers = room.players.filter((p) => room.gameState.hands[p.id]);
      if (allPlayers.length < 1) return { use: false };
      const p1 = allPlayers[Math.floor(Math.random() * allPlayers.length)];
      const hand1 = room.gameState.hands[p1.id];
      const slots1 = hand1 ? hand1.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (slots1.length === 0) return { use: false };

      const p2 = allPlayers[Math.floor(Math.random() * allPlayers.length)];
      const hand2 = room.gameState.hands[p2.id];
      const slots2 = hand2 ? hand2.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (slots2.length === 0) return { use: false };

      return {
        use: true,
        target1PlayerId: p1.id,
        index1: slots1[Math.floor(Math.random() * slots1.length)],
        target2PlayerId: p2.id,
        index2: slots2[Math.floor(Math.random() * slots2.length)],
        doSwitch: false,
      };
    }

    return { use: false };
  }

  // Easy never matches opportunistically
  // eslint-disable-next-line no-unused-vars
  shouldMatchOwn(room, slotIndex, knownCard, topDiscard) {
    return false;
  }
}

class MediumBot extends BotPlayer {
  shouldCallRedKing(room) {
    const hand = room.gameState.hands[this.botId];
    if (!hand) return false;

    let knownCount = 0;
    let knownPoints = 0;
    let estimated = 0;

    for (let i = 0; i < hand.length; i++) {
      if (hand[i] === null) continue;
      const known = this.known(i);
      if (known) {
        knownCount++;
        knownPoints += getCardPoints(known);
        estimated += getCardPoints(known);
      } else {
        estimated += 6; // conservative unknown estimate
      }
    }

    return knownCount >= 2 && knownPoints <= 5 && estimated <= 8;
  }

  decideKeepOrDiscard(room, drawnCard) {
    const hand = room.gameState.hands[this.botId];
    if (!hand) return { action: 'discard' };

    const drawnPts = getCardPoints(drawnCard);

    // Find worst known slot
    let worstIdx = -1;
    let worstPts = -Infinity;
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] === null) continue;
      const known = this.known(i);
      if (known) {
        const pts = getCardPoints(known);
        if (pts > worstPts) {
          worstPts = pts;
          worstIdx = i;
        }
      }
    }

    // Keep if drawn is better than worst known
    if (worstIdx !== -1 && drawnPts < worstPts) {
      return { action: 'keep', slotIndex: worstIdx };
    }

    // Also keep low-value cards if there are unknown slots
    const hasUnknown = hand.some((c, i) => c !== null && !this.known(i));
    if (drawnPts <= 1 && hasUnknown) {
      // Place in first unknown slot
      for (let i = 0; i < hand.length; i++) {
        if (hand[i] !== null && !this.known(i)) {
          return { action: 'keep', slotIndex: i };
        }
      }
    }

    return { action: 'discard' };
  }

  decideRuleUsage(room, ruleType) {
    const hand = room.gameState.hands[this.botId];
    const opponents = room.players.filter((p) => p.id !== this.botId && room.gameState.hands[p.id]);

    if (ruleType === 'peek-own') {
      // Peek first unknown slot
      if (!hand) return { use: false };
      for (let i = 0; i < hand.length; i++) {
        if (hand[i] !== null && !this.known(i)) {
          return { use: true, handIndex: i };
        }
      }
      return { use: false };
    }

    if (ruleType === 'peek-other') {
      if (opponents.length === 0) return { use: false };
      const opp = opponents[Math.floor(Math.random() * opponents.length)];
      const oppHand = room.gameState.hands[opp.id];
      const validSlots = oppHand ? oppHand.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (validSlots.length === 0) return { use: false };
      return {
        use: true,
        targetPlayerId: opp.id,
        handIndex: validSlots[Math.floor(Math.random() * validSlots.length)],
      };
    }

    if (ruleType === 'blind-switch') {
      if (!hand) return { use: false };
      // Give worst known card, take random opponent card
      let worstIdx = -1;
      let worstPts = -Infinity;
      for (let i = 0; i < hand.length; i++) {
        if (hand[i] === null) continue;
        const known = this.known(i);
        if (known) {
          const pts = getCardPoints(known);
          if (pts > worstPts) { worstPts = pts; worstIdx = i; }
        }
      }
      if (worstIdx === -1 || opponents.length === 0) return { use: false };

      const opp = opponents[Math.floor(Math.random() * opponents.length)];
      const oppHand = room.gameState.hands[opp.id];
      const oppSlots = oppHand ? oppHand.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (oppSlots.length === 0) return { use: false };

      return {
        use: true,
        playerAId: this.botId,
        indexA: worstIdx,
        playerBId: opp.id,
        indexB: oppSlots[Math.floor(Math.random() * oppSlots.length)],
      };
    }

    if (ruleType === 'black-king') {
      // Peek two cards from opponents; no switch
      if (opponents.length === 0) return { use: false };
      const opp1 = opponents[0];
      const hand1 = room.gameState.hands[opp1.id];
      const slots1 = hand1 ? hand1.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (slots1.length === 0) return { use: false };

      const opp2 = opponents.length > 1 ? opponents[1] : opponents[0];
      const hand2 = room.gameState.hands[opp2.id];
      const slots2 = hand2 ? hand2.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (slots2.length === 0) return { use: false };

      // Avoid same player+slot
      let idx2 = slots2[0];
      if (opp1.id === opp2.id && slots1[0] === idx2 && slots2.length > 1) {
        idx2 = slots2[1];
      }

      return {
        use: true,
        target1PlayerId: opp1.id,
        index1: slots1[0],
        target2PlayerId: opp2.id,
        index2: idx2,
        doSwitch: false,
      };
    }

    return { use: false };
  }

  shouldMatchOwn(room, slotIndex, knownCard, topDiscard) {
    void room; void slotIndex;
    return knownCard.rank === topDiscard.rank;
  }
}

class HardBot extends BotPlayer {
  shouldCallRedKing(room) {
    const hand = room.gameState.hands[this.botId];
    if (!hand) return false;
    // All slots must be known
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] !== null && !this.known(i)) return false;
    }
    const score = getPlayerScore(hand);
    return score <= 5;
  }

  decideKeepOrDiscard(room, drawnCard) {
    const hand = room.gameState.hands[this.botId];
    if (!hand) return { action: 'discard' };

    const drawnPts = getCardPoints(drawnCard);

    // Full-info: use actual card values
    let worstIdx = -1;
    let worstPts = -Infinity;
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] === null) continue;
      const pts = getCardPoints(hand[i]);
      if (pts > worstPts) { worstPts = pts; worstIdx = i; }
    }

    if (worstIdx !== -1 && drawnPts < worstPts) {
      // Update memory for the slot we're replacing
      this.remember(worstIdx, drawnCard);
      return { action: 'keep', slotIndex: worstIdx };
    }

    return { action: 'discard' };
  }

  decideRuleUsage(room, ruleType) {
    const hand = room.gameState.hands[this.botId];
    const opponents = room.players.filter((p) => p.id !== this.botId && room.gameState.hands[p.id]);

    if (ruleType === 'peek-own') {
      // Already has full info (HardBot sees all), peek first unknown for memory
      if (!hand) return { use: false };
      for (let i = 0; i < hand.length; i++) {
        if (hand[i] !== null && !this.known(i)) {
          return { use: true, handIndex: i };
        }
      }
      return { use: false };
    }

    if (ruleType === 'peek-other') {
      // Peek opponent with most cards
      if (opponents.length === 0) return { use: false };
      let bestOpp = opponents[0];
      let maxCards = 0;
      for (const opp of opponents) {
        const h = room.gameState.hands[opp.id];
        const count = h ? h.filter((c) => c !== null).length : 0;
        if (count > maxCards) { maxCards = count; bestOpp = opp; }
      }
      const oppHand = room.gameState.hands[bestOpp.id];
      const validSlots = oppHand ? oppHand.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (validSlots.length === 0) return { use: false };
      return { use: true, targetPlayerId: bestOpp.id, handIndex: validSlots[0] };
    }

    if (ruleType === 'blind-switch') {
      if (!hand) return { use: false };
      // Give own worst card, take opponent's best (lowest pts) card
      let worstIdx = -1;
      let worstPts = -Infinity;
      for (let i = 0; i < hand.length; i++) {
        if (hand[i] === null) continue;
        const pts = getCardPoints(hand[i]);
        if (pts > worstPts) { worstPts = pts; worstIdx = i; }
      }
      if (worstIdx === -1 || opponents.length === 0) return { use: false };

      // Find opponent with best (lowest) card
      let bestOppId = null;
      let bestOppIdx = -1;
      let bestPts = Infinity;
      for (const opp of opponents) {
        const h = room.gameState.hands[opp.id];
        if (!h) continue;
        for (let i = 0; i < h.length; i++) {
          if (h[i] === null) continue;
          const pts = getCardPoints(h[i]);
          if (pts < bestPts) { bestPts = pts; bestOppId = opp.id; bestOppIdx = i; }
        }
      }
      if (bestOppId === null) return { use: false };

      // Only switch if it's beneficial
      if (bestPts >= worstPts) return { use: false };

      return {
        use: true,
        playerAId: this.botId,
        indexA: worstIdx,
        playerBId: bestOppId,
        indexB: bestOppIdx,
      };
    }

    if (ruleType === 'black-king') {
      // Peek two and switch if net improvement
      if (opponents.length === 0) return { use: false };
      const allPlayers = room.players.filter((p) => room.gameState.hands[p.id]);
      if (allPlayers.length < 2) return { use: false };

      // Find the two cards with highest combined improvement potential
      const p1 = allPlayers[0];
      const hand1 = room.gameState.hands[p1.id];
      const slots1 = hand1 ? hand1.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (slots1.length === 0) return { use: false };

      const p2 = allPlayers.length > 1 ? allPlayers[1] : allPlayers[0];
      const hand2 = room.gameState.hands[p2.id];
      const slots2 = hand2 ? hand2.map((c, i) => (c !== null ? i : -1)).filter((i) => i !== -1) : [];
      if (slots2.length === 0) return { use: false };

      let idx2 = slots2[0];
      if (p1.id === p2.id && slots1[0] === idx2 && slots2.length > 1) {
        idx2 = slots2[1];
      }

      // Peek then decide on switch: HardBot uses full server info to decide
      const card1 = hand1[slots1[0]];
      const card2 = hand2[idx2];
      // Determine if switching benefits this bot (if this bot is p1 or p2)
      let doSwitch = false;
      if (p1.id === this.botId) {
        // Switching gives us card2, gives p2 card1
        doSwitch = getCardPoints(card2) < getCardPoints(card1);
      } else if (p2.id === this.botId) {
        doSwitch = getCardPoints(card1) < getCardPoints(card2);
      }

      return {
        use: true,
        target1PlayerId: p1.id,
        index1: slots1[0],
        target2PlayerId: p2.id,
        index2: idx2,
        doSwitch,
      };
    }

    return { use: false };
  }

  shouldMatchOwn(room, slotIndex, knownCard, topDiscard) {
    void room; void slotIndex;
    return knownCard.rank === topDiscard.rank;
  }
}

// ── Registry: maps difficulty string → constructor ────────────────────────────
const BotRegistry = { easy: EasyBot, medium: MediumBot, hard: HardBot };

function createBot(botId, difficulty = 'medium') {
  const Cls = BotRegistry[difficulty] || MediumBot;
  return new Cls(botId, difficulty);
}

// ── Live instances: Map<botId, BotPlayer> ────────────────────────────────────
const activeBots = new Map();

function getBot(botId, difficulty) {
  if (!activeBots.has(botId)) activeBots.set(botId, createBot(botId, difficulty));
  return activeBots.get(botId);
}

function removeBot(botId) {
  activeBots.get(botId)?.clearMemory();
  activeBots.delete(botId);
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/** Auto-complete the peek phase for a bot: remember indices 2&3, signal done. */
function executeBotPeekPhase(io, room, botId) {
  const bot = room.players.find((p) => p.id === botId);
  getBot(botId, bot?.difficulty).peekPhase(io, room);
}

/**
 * Advance turn and emit state — mirrors advanceAndEmit in socketHandlers
 * but callable from within cpuPlayer without circular deps.
 */
function botAdvanceAndEmit(io, room) {
  const { advanceRedemptionTurn: advRedeem, advanceTurn: advTurn, getGameResults: getResults, getCurrentTurnPlayer: getCurrent, getTopDiscard: getTop } = require('./roomManager');

  if (room.gameState.phase === 'redemption') {
    const result = advRedeem(room.code);
    if (!result) return;
    if (result.phase === 'reveal') {
      const gameResults = getResults(room.code);
      io.to(room.code).emit('game-results', gameResults);
      io.to(room.code).emit('phase-changed', { phase: 'reveal' });
    } else {
      const currentTurn = getCurrent(room.code);
      const topDiscard = getTop(room.code);
      io.to(room.code).emit('turn-update', {
        currentTurn,
        deckCount: room.gameState.deck.length,
        topDiscard,
      });
      scheduleBotTurn(io, room);
    }
  } else {
    advTurn(room.code);
    const currentTurn = getCurrent(room.code);
    const topDiscard = getTop(room.code);
    io.to(room.code).emit('turn-update', {
      currentTurn,
      deckCount: room.gameState.deck.length,
      topDiscard,
    });
    scheduleBotTurn(io, room);
  }
}

/**
 * Schedule the bot's turn after a delay, preventing double-scheduling.
 */
function scheduleBotTurn(io, room, delay = 1500) {
  if (!room.gameState) return;
  if (!['play', 'redemption'].includes(room.gameState.phase)) return;
  if (room.gameState.pendingBotTurn) return;

  const currentId = getCurrentTurnPlayer(room.code);
  if (!currentId || !currentId.startsWith('bot-')) return;

  room.gameState.pendingBotTurn = true;

  setTimeout(() => {
    const fresh = getRoomByCode(room.code);
    if (!fresh?.gameState) return;

    const freshCurrentId = getCurrentTurnPlayer(fresh.code);
    if (freshCurrentId !== currentId) {
      fresh.gameState.pendingBotTurn = false;
      return;
    }

    const botPlayer = fresh.players.find((p) => p.id === currentId);
    getBot(currentId, botPlayer?.difficulty).executeTurn(io, fresh);
  }, delay);
}

/**
 * Check all bots in the room for opportunistic matches after a discard event.
 */
function checkBotMatches(io, room) {
  if (!room.gameState) return;
  for (const player of room.players) {
    if (!player.isCpu) continue;
    // Don't let protected Red King caller match their own cards
    if (
      room.gameState.phase === 'redemption' &&
      room.gameState.redKingCaller === player.id
    ) continue;
    getBot(player.id, player.difficulty).checkMatches(io, room);
  }
}

/**
 * Invalidate a bot's memory for a slot if the player is a bot.
 * Called when another player blind-switches the bot's card.
 */
function invalidateBotMemoryIfNeeded(playerId, slotIndex, room) {
  const player = room.players.find((p) => p.id === playerId);
  if (player?.isCpu) {
    getBot(playerId, player.difficulty).forget(slotIndex);
  }
}

module.exports = {
  // For custom extension
  BotPlayer,
  EasyBot,
  MediumBot,
  HardBot,
  BotRegistry,
  // Lifecycle
  createBot,
  getBot,
  removeBot,
  // Hooks for socketHandlers
  executeBotPeekPhase,
  scheduleBotTurn,
  checkBotMatches,
  invalidateBotMemoryIfNeeded,
  // Internal (exported for testing)
  botAdvanceAndEmit,
};
