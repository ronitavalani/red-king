// client/src/utils/BotStrategies.js
// Pure utility — no React, no socket.
// Client-side mirror of the server's BotPlayer hierarchy.

export function getCardPoints(card) {
  if (!card) return 0;
  if (card.suit === 'joker') return 0;
  if (card.rank === 'A') return 1;
  if (card.rank === 'K') {
    return card.suit === 'hearts' || card.suit === 'diamonds' ? -1 : 10;
  }
  if (card.rank === 'Q' || card.rank === 'J') return 10;
  return parseInt(card.rank, 10) || 0;
}

// ── ClientBotBase ─────────────────────────────────────────────────────────────
// Base class with memory helpers and no-op strategy methods.
// Override strategy methods in subclasses.

export class ClientBotBase {
  constructor() {
    this.memory = new Map();
  }

  remember(key, card) { this.memory.set(key, card); }
  forget(key)         { this.memory.delete(key); }
  known(key)          { return this.memory.get(key); }
  clearMemory()       { this.memory.clear(); }

  // Override in subclasses:
  // knownOwnCards: { [slotIndex]: card }
  // myCards: the actual myCards array (may have nulls for matched slots)
  shouldCallRedKing(knownOwnCards, myCards)                                           { return false; }
  decideKeepOrDiscard(drawnCard, knownOwnCards, myCards)                              { return { action: 'discard' }; }
  decideRuleUsage(ruleType, knownOwnCards, knownOpponentCards, myCards, opponents)    { return { use: false }; }
  getMatchSuggestion(knownOwnCards, myCards, topDiscard)                              { return null; }
}

// ── HardBotClient ─────────────────────────────────────────────────────────────
// Client-side mirror of HardBot. Operates only on known card data
// rather than full server-side hands.

export class HardBotClient extends ClientBotBase {
  shouldCallRedKing(knownOwnCards, myCards) {
    if (!myCards) return false;
    // All non-null slots must be known
    for (let i = 0; i < myCards.length; i++) {
      if (myCards[i] !== null && !knownOwnCards[i]) return false;
    }
    // Total known score must be <= 5
    let score = 0;
    for (let i = 0; i < myCards.length; i++) {
      if (myCards[i] !== null && knownOwnCards[i]) {
        score += getCardPoints(knownOwnCards[i]);
      }
    }
    return score <= 5;
  }

  decideKeepOrDiscard(drawnCard, knownOwnCards, myCards) {
    if (!myCards || !drawnCard) return { action: 'discard' };
    const drawnPts = getCardPoints(drawnCard);

    // Find worst known slot (highest pts)
    let worstIdx = -1;
    let worstPts = -Infinity;
    for (let i = 0; i < myCards.length; i++) {
      if (myCards[i] === null) continue;
      const known = knownOwnCards[i];
      if (known) {
        const pts = getCardPoints(known);
        if (pts > worstPts) { worstPts = pts; worstIdx = i; }
      }
    }

    if (worstIdx !== -1 && drawnPts < worstPts) {
      return { action: 'keep', slotIndex: worstIdx };
    }
    return { action: 'discard' };
  }

  decideRuleUsage(ruleType, knownOwnCards, knownOpponentCards, myCards, opponents) {
    if (ruleType === 'peek-own') {
      if (!myCards) return { use: false };
      // Peek first unknown slot
      for (let i = 0; i < myCards.length; i++) {
        if (myCards[i] !== null && !knownOwnCards[i]) {
          return { use: true, handIndex: i };
        }
      }
      return { use: false };
    }

    if (ruleType === 'peek-other') {
      if (!opponents || opponents.length === 0) return { use: false };
      // Pick first opponent with an unknown slot
      for (const opp of opponents) {
        const oppKnown = knownOpponentCards[opp.id] || {};
        for (let i = 0; i < 4; i++) {
          if (!oppKnown[i]) {
            return { use: true, targetPlayerId: opp.id, handIndex: i };
          }
        }
      }
      // Fallback: first opponent, first slot
      return { use: true, targetPlayerId: opponents[0].id, handIndex: 0 };
    }

    if (ruleType === 'blind-switch') {
      if (!myCards) return { use: false };
      // Give own worst known card
      let worstIdx = -1;
      let worstPts = -Infinity;
      for (let i = 0; i < myCards.length; i++) {
        if (myCards[i] === null) continue;
        const known = knownOwnCards[i];
        if (known) {
          const pts = getCardPoints(known);
          if (pts > worstPts) { worstPts = pts; worstIdx = i; }
        }
      }
      if (worstIdx === -1 || !opponents || opponents.length === 0) return { use: false };

      // Find opponent's best known card (lowest pts)
      let bestOppId = null;
      let bestOppIdx = -1;
      let bestPts = Infinity;
      for (const opp of opponents) {
        const oppKnown = knownOpponentCards[opp.id] || {};
        for (const [idxStr, card] of Object.entries(oppKnown)) {
          const pts = getCardPoints(card);
          if (pts < bestPts) { bestPts = pts; bestOppId = opp.id; bestOppIdx = parseInt(idxStr, 10); }
        }
      }
      if (bestOppId === null) return { use: false };
      if (bestPts >= worstPts) return { use: false };

      return {
        use: true,
        confirmable: false, // multi-step UI — show hint only
        slotIndex: worstIdx,
        targetPlayerId: bestOppId,
        targetIndex: bestOppIdx,
      };
    }

    if (ruleType === 'black-king') {
      return {
        use: true,
        confirmable: false, // multi-step UI — show hint only
      };
    }

    return { use: false };
  }

  getMatchSuggestion(knownOwnCards, myCards, topDiscard) {
    if (!topDiscard || !myCards) return null;
    for (let i = 0; i < myCards.length; i++) {
      if (myCards[i] === null) continue;
      const known = knownOwnCards[i];
      if (known && known.rank === topDiscard.rank) {
        return { slotIndex: i, card: known };
      }
    }
    return null;
  }
}

// ── Custom bots: each player edits their own class ───────────────────────────

export class AruniaBot extends HardBotClient {
  // Strategy: Always know all your cards — peek unknowns and switch to reveal them

  decideKeepOrDiscard(drawnCard, knownOwnCards, myCards, opponentKnowledge) {
    if (!myCards || !drawnCard) return { action: 'discard' };

    // First priority: fill unknown slots, even with bad cards
    // This lets us learn what we have via peeking or switching
    for (let i = 0; i < myCards.length; i++) {
      if (myCards[i] !== null && !knownOwnCards[i]) {
        // Prefer to keep at unknown slots to gather info
        return { action: 'keep', slotIndex: i };
      }
    }

    // If all slots are known, use parent strategy (replace worst known)
    return super.decideKeepOrDiscard(drawnCard, knownOwnCards, myCards);
  }

  decideRuleUsage(ruleType, knownOwnCards, knownOpponentCards, myCards, opponents, opponentKnowledge) {
    // Peek-own: always use it to learn unknowns (same as parent)
    if (ruleType === 'peek-own') {
      return super.decideRuleUsage(ruleType, knownOwnCards, knownOpponentCards, myCards, opponents);
    }

    // Blind-switch: prioritize revealing unknowns in your own hand
    if (ruleType === 'blind-switch') {
      if (!myCards || !opponents || opponents.length === 0) return { use: false };

      // Find first unknown slot in your own hand
      let unknownIdx = -1;
      for (let i = 0; i < myCards.length; i++) {
        if (myCards[i] !== null && !knownOwnCards[i]) {
          unknownIdx = i;
          break;
        }
      }

      // If you have unknowns, switch them out to force learning
      if (unknownIdx !== -1) {
        // Just switch with any opponent's slot (prefer known cards to learn opponents too)
        for (const opp of opponents) {
          const oppKnown = knownOpponentCards[opp.id] || {};
          // Prefer to switch with a known opponent card
          for (const [idxStr, card] of Object.entries(oppKnown)) {
            return {
              use: true,
              confirmable: false,
              slotIndex: unknownIdx,
              targetPlayerId: opp.id,
              targetIndex: parseInt(idxStr, 10),
            };
          }
          // Fallback: switch with any opponent slot to learn
          return {
            use: true,
            confirmable: false,
            slotIndex: unknownIdx,
            targetPlayerId: opp.id,
            targetIndex: 0,
          };
        }
      }

      // All own cards known: use parent strategy (replace worst)
      return super.decideRuleUsage(ruleType, knownOwnCards, knownOpponentCards, myCards, opponents);
    }

    // For other rules, use parent strategy
    return super.decideRuleUsage(ruleType, knownOwnCards, knownOpponentCards, myCards, opponents);
  }
}

export class RontBot extends HardBotClient {
  // TODO: ront's custom overrides!!!!!:))))))) love u ronu<3333 happy coding!!!!
}

export function getCustomBot(playerName) {
  if (playerName === 'arunia') return new AruniaBot();
  if (playerName === 'ront')   return new RontBot();
  return null;
}

// ── computeSuggestion ─────────────────────────────────────────────────────────
// Top-level function that calls bot strategy methods and returns a suggestion.
//
// Returns:
//   {
//     action: string,
//     label: string,
//     reasoning: string,
//     confirmable: boolean,
//     slotIndex?: number,
//     targetPlayerId?: string,
//     targetIndex?: number,
//   }
//   or null if no suggestion applies.

export function computeSuggestion(bot, {
  isMyTurn,
  gamePhase,
  hasDrawn,
  drawnCard,
  drawnCardHasRule,
  drawnCardRuleType,
  myCards,
  knownOwnCards,
  knownOpponentCards,
  opponentKnowledge,
  topDiscard,
  opponents,
  activeRule,
  matchMode,
  isCallerProtected,
}) {
  if (!isMyTurn) return null;
  if (!gamePhase || (gamePhase !== 'play' && gamePhase !== 'redemption')) return null;
  if (isCallerProtected) return null;
  if (matchMode) return null;

  // Match opportunity: check before drawing or using rules
  if (!hasDrawn && !activeRule && topDiscard) {
    const matchSugg = bot.getMatchSuggestion(knownOwnCards, myCards, topDiscard);
    if (matchSugg) {
      return {
        action: 'match-own',
        label: `Match — slot ${matchSugg.slotIndex + 1}`,
        reasoning: `Your card (${matchSugg.card.rank}) matches the discard pile top card`,
        confirmable: true,
        slotIndex: matchSugg.slotIndex,
      };
    }
  }

  // Pre-draw phase: no drawn card, no active rule
  if (!hasDrawn && !activeRule) {
    if (gamePhase === 'play' && bot.shouldCallRedKing(knownOwnCards, myCards)) {
      return {
        action: 'call-red-king',
        label: 'Call Red King',
        reasoning: 'All your cards are known and your total score is low — call it!',
        confirmable: true,
      };
    }
    return {
      action: 'draw',
      label: 'Draw a card',
      reasoning: 'Draw from the deck to continue your turn',
      confirmable: true,
    };
  }

  // Post-draw, no active rule: decide keep or discard
  if (hasDrawn && drawnCard && !activeRule) {
    const decision = bot.decideKeepOrDiscard(drawnCard, knownOwnCards, myCards, opponentKnowledge);

    if (decision.action === 'keep' && decision.slotIndex != null) {
      const replaced = knownOwnCards[decision.slotIndex];
      const drawnPts = getCardPoints(drawnCard);
      const reasoning = replaced
        ? `Replace your ${getCardPoints(replaced)}-pt card with this ${drawnPts}-pt card`
        : `Keep at slot ${decision.slotIndex + 1} (replaces unknown card)`;
      return {
        action: 'keep',
        label: `Keep — put at slot ${decision.slotIndex + 1}`,
        reasoning,
        confirmable: true,
        slotIndex: decision.slotIndex,
      };
    }

    // Discard (possibly with rule)
    if (drawnCardHasRule) {
      return {
        action: 'discard-use-rule',
        label: `Discard & use ${drawnCardRuleType} rule`,
        reasoning: 'This card has a rule — discard it to activate the rule',
        confirmable: true,
      };
    }
    const drawnPts = getCardPoints(drawnCard);
    return {
      action: 'discard',
      label: 'Discard the drawn card',
      reasoning: `This ${drawnPts}-pt card is not worth keeping`,
      confirmable: true,
    };
  }

  // Rule execution phase
  if (activeRule) {
    const decision = bot.decideRuleUsage(
      activeRule, knownOwnCards, knownOpponentCards, myCards, opponents, opponentKnowledge
    );

    if (!decision.use) {
      return {
        action: 'skip-rule',
        label: 'Skip the rule',
        reasoning: `No beneficial use for ${activeRule} right now`,
        confirmable: true,
      };
    }

    if (activeRule === 'peek-own') {
      return {
        action: 'peek-own',
        label: `Peek own — slot ${(decision.handIndex ?? 0) + 1}`,
        reasoning: `Slot ${(decision.handIndex ?? 0) + 1} is unknown — peek to learn it`,
        confirmable: true,
        slotIndex: decision.handIndex,
      };
    }

    if (activeRule === 'peek-other') {
      const oppName = opponents?.find(o => o.id === decision.targetPlayerId)?.name || 'opponent';
      return {
        action: 'peek-other',
        label: `Peek ${oppName}'s slot ${(decision.handIndex ?? 0) + 1}`,
        reasoning: `Gain info by peeking at ${oppName}'s unknown card`,
        confirmable: true,
        targetPlayerId: decision.targetPlayerId,
        targetIndex: decision.handIndex,
      };
    }

    if (activeRule === 'blind-switch') {
      if (decision.targetPlayerId != null) {
        const oppName = opponents?.find(o => o.id === decision.targetPlayerId)?.name || 'opponent';
        return {
          action: 'blind-switch',
          label: `Switch slot ${(decision.slotIndex ?? 0) + 1} ↔ ${oppName} slot ${(decision.targetIndex ?? 0) + 1}`,
          reasoning: `Blind switch with ${oppName} to improve your hand`,
          confirmable: false, // multi-step: user must click the cards manually
        };
      }
      return {
        action: 'skip-rule',
        label: 'Skip blind-switch',
        reasoning: 'No beneficial switch available with known cards',
        confirmable: true,
      };
    }

    if (activeRule === 'black-king') {
      return {
        action: 'black-king-peek',
        label: 'Peek two cards (Black King)',
        reasoning: 'Use the Black King rule to gain information about two cards',
        confirmable: false, // multi-step: user must select the two cards
      };
    }

    return {
      action: 'skip-rule',
      label: 'Skip the rule',
      reasoning: 'No strategy for this rule right now',
      confirmable: true,
    };
  }

  return null;
}
