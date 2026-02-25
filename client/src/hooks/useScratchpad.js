// client/src/hooks/useScratchpad.js
// Manages what the custom-bot player has "seen" throughout the game.
// Adds its own socket listeners (safe alongside SocketContext's listeners).

import { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from '../socket';

export function useScratchpad(playerInfo, opponents, isCustomBot) {
  const [knownOwnCards, setKnownOwnCards] = useState({});
  const [knownOpponentCards, setKnownOpponentCards] = useState({});
  const [discardHistory, setDiscardHistory] = useState([]);
  const [opponentKnowledge, setOpponentKnowledge] = useState({});

  // Keep refs to read latest state synchronously in event handlers
  const ownRef = useRef(knownOwnCards);
  const oppRef = useRef(knownOpponentCards);

  useEffect(() => { ownRef.current = knownOwnCards; }, [knownOwnCards]);
  useEffect(() => { oppRef.current = knownOpponentCards; }, [knownOpponentCards]);

  const myId = playerInfo?.id;
  const isArunia = playerInfo?.name === 'arunia';

  // Called from GameRoom when player clicks "Done Peeking"
  const initPeekCards = useCallback((myCards) => {
    if (!myCards) return;
    setKnownOwnCards(prev => {
      const next = { ...prev };
      for (const idx of [2, 3]) {
        if (myCards[idx] != null) next[idx] = myCards[idx];
      }
      return next;
    });
  }, []);

  // Called when we accept a "keep" suggestion so we know what's now at that slot
  const recordKeep = useCallback((slotIndex, card) => {
    setKnownOwnCards(prev => ({ ...prev, [slotIndex]: card }));
  }, []);

  useEffect(() => {
    if (!isCustomBot || !myId) return;

    function onPeekResult({ card, handIndex, targetPlayerId }) {
      if (!targetPlayerId || targetPlayerId === myId) {
        // Own card peeked
        setKnownOwnCards(prev => ({ ...prev, [handIndex]: card }));
      } else {
        // Opponent card peeked
        setKnownOpponentCards(prev => ({
          ...prev,
          [targetPlayerId]: { ...(prev[targetPlayerId] || {}), [handIndex]: card },
        }));
        if (isArunia) {
          setOpponentKnowledge(prev => ({
            ...prev,
            [targetPlayerId]: { ...(prev[targetPlayerId] || {}), [handIndex]: card },
          }));
        }
      }
    }

    function onBlackKingPeekResult({ card1, target1PlayerId, index1, card2, target2PlayerId, index2 }) {
      setKnownOwnCards(prev => {
        const next = { ...prev };
        if (target1PlayerId === myId) next[index1] = card1;
        if (target2PlayerId === myId) next[index2] = card2;
        return next;
      });
      setKnownOpponentCards(prev => {
        const next = { ...prev };
        if (target1PlayerId !== myId) {
          next[target1PlayerId] = { ...(next[target1PlayerId] || {}), [index1]: card1 };
        }
        if (target2PlayerId !== myId) {
          next[target2PlayerId] = { ...(next[target2PlayerId] || {}), [index2]: card2 };
        }
        return next;
      });
      if (isArunia) {
        setOpponentKnowledge(prev => {
          const next = { ...prev };
          if (target1PlayerId !== myId) {
            next[target1PlayerId] = { ...(next[target1PlayerId] || {}), [index1]: card1 };
          }
          if (target2PlayerId !== myId) {
            next[target2PlayerId] = { ...(next[target2PlayerId] || {}), [index2]: card2 };
          }
          return next;
        });
      }
    }

    function onCardDiscarded({ card }) {
      if (card) setDiscardHistory(prev => [card, ...prev]);
    }

    function onCardsHighlighted({ cards, type }) {
      if (!cards || cards.length < 2) return;

      // Read current state synchronously from refs
      const currentOwn = ownRef.current;
      const currentOpp = oppRef.current;

      const nextOwn = { ...currentOwn };
      const nextOpp = { ...currentOpp };

      const setAt = (pid, idx, card) => {
        if (pid === myId) {
          if (card !== undefined) nextOwn[idx] = card;
          else delete nextOwn[idx];
        } else {
          const map = { ...(nextOpp[pid] || {}) };
          if (card !== undefined) map[idx] = card;
          else delete map[idx];
          nextOpp[pid] = map;
        }
      };

      if (type === 'switch') {
        const [A, B] = cards;

        const getKnown = (pid, idx) => {
          if (pid === myId) return currentOwn[idx];
          return (currentOpp[pid] || {})[idx];
        };

        const knownA = getKnown(A.playerId, A.index);
        const knownB = getKnown(B.playerId, B.index);

        // After the switch: position A now holds what was at B, and vice versa
        setAt(A.playerId, A.index, knownB);
        setAt(B.playerId, B.index, knownA);
      } else if (type === 'match') {
        const [callerCard, targetCard] = cards;

        // Caller's slot becomes empty (card removed)
        setAt(callerCard.playerId, callerCard.index, undefined);

        // Target's slot now has an unknown card (clear any known card there)
        setAt(targetCard.playerId, targetCard.index, undefined);
      } else if (type === 'swap') {
        // A card was kept: the player at cards[0] replaced their card at cards[0].index
        const [swappedCard] = cards;

        // The player now has an unknown card at this slot (any known card there is obsolete)
        setAt(swappedCard.playerId, swappedCard.index, undefined);
      }

      setKnownOwnCards(nextOwn);
      setKnownOpponentCards(nextOpp);
    }

    function onMatchResult({ callerId, success, type, card }) {
      // When we successfully match one of our own cards, remove it from known
      if (success && type === 'own' && callerId === myId && card) {
        setKnownOwnCards(prev => {
          const next = { ...prev };
          for (const idxStr of Object.keys(next)) {
            if (next[idxStr]?.id === card.id) {
              delete next[idxStr];
              break;
            }
          }
          return next;
        });
      }
    }

    function onReset() {
      setKnownOwnCards({});
      setKnownOpponentCards({});
      setDiscardHistory([]);
      setOpponentKnowledge({});
    }

    socket.on('peek-result', onPeekResult);
    socket.on('black-king-peek-result', onBlackKingPeekResult);
    socket.on('card-discarded', onCardDiscarded);
    socket.on('cards-highlighted', onCardsHighlighted);
    socket.on('match-result', onMatchResult);
    socket.on('game-ended', onReset);
    socket.on('you-left', onReset);

    return () => {
      socket.off('peek-result', onPeekResult);
      socket.off('black-king-peek-result', onBlackKingPeekResult);
      socket.off('card-discarded', onCardDiscarded);
      socket.off('cards-highlighted', onCardsHighlighted);
      socket.off('match-result', onMatchResult);
      socket.off('game-ended', onReset);
      socket.off('you-left', onReset);
    };
  }, [isCustomBot, myId]);

  return { knownOwnCards, knownOpponentCards, discardHistory, opponentKnowledge, initPeekCards, recordKeep };
}
