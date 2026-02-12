import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useSocket } from '../context/SocketContext';
import { socket } from '../socket';
import PlayerList from '../components/PlayerList';
import CardGrid from '../components/CardGrid';
import DrawPile from '../components/DrawPile';
import DiscardPile from '../components/DiscardPile';
import Card from '../components/Card';
import RulesModal from '../components/RulesModal';
import './GameRoom.css';

const RULE_DESCRIPTIONS = {
  'peek-own': 'Pick one of your cards to peek at',
  'peek-other': "Pick an opponent's card to peek at",
  'blind-switch': 'Pick two cards to blind switch (from any two players)',
  'black-king': 'Pick any 2 cards on the table to peek at',
};

export default function GameRoom() {
  const navigate = useNavigate();
  const {
    roomCode,
    players,
    roomState,
    myCards,
    gamePhase,
    deckCount,
    opponents,
    peekDonePlayers,
    playerInfo,
    currentTurn,
    drawnCard,
    drawnCardHasRule,
    drawnCardRuleType,
    topDiscard,
    actionLog,
    activeRule,
    peekResult,
    setPeekResult,
    blackKingPeekResult,
    setBlackKingPeekResult,
  } = useSocket();

  const [isPeeking, setIsPeeking] = useState(false);
  const [hasPeeked, setHasPeeked] = useState(false);
  const [showRules, setShowRules] = useState(false);

  // Rule execution state
  const [ruleStep, setRuleStep] = useState(null);
  // For blind-switch: track first selection {playerId, index}
  const [switchSelectionA, setSwitchSelectionA] = useState(null);
  // For black-king: after peeking, optionally switch
  const [blackKingPhase, setBlackKingPhase] = useState(null); // 'peek-select' | 'peek-result' | 'switch-select'
  const [bkPeekSelectionA, setBkPeekSelectionA] = useState(null);
  const [bkSwitchSelectionA, setBkSwitchSelectionA] = useState(null);

  const isMyTurn = playerInfo && currentTurn === playerInfo.id;
  const hasDrawn = drawnCard !== null;

  useEffect(() => {
    if (roomState === 'waiting') navigate('/waiting-room');
    if (!roomCode) navigate('/');
  }, [roomState, roomCode, navigate]);

  useEffect(() => {
    if (gamePhase === 'peek') {
      setIsPeeking(false);
      setHasPeeked(false);
    }
  }, [gamePhase]);

  // When activeRule changes, set up rule execution flow
  useEffect(() => {
    if (activeRule) {
      if (activeRule === 'black-king') {
        setBlackKingPhase('peek-select');
        setBkPeekSelectionA(null);
        setBkSwitchSelectionA(null);
      } else if (activeRule === 'blind-switch') {
        setSwitchSelectionA(null);
      }
      setRuleStep('executing');
    } else {
      setRuleStep(null);
      setSwitchSelectionA(null);
      setBlackKingPhase(null);
      setBkPeekSelectionA(null);
      setBkSwitchSelectionA(null);
    }
  }, [activeRule]);

  // When black king peek result comes in, show it
  useEffect(() => {
    if (blackKingPeekResult) {
      setBlackKingPhase('peek-result');
    }
  }, [blackKingPeekResult]);

  function handlePeek() {
    setIsPeeking(true);
  }

  function handleDonePeeking() {
    setIsPeeking(false);
    setHasPeeked(true);
    socket.emit('peek-done');
  }

  function handleEndGame() {
    socket.emit('end-game', { roomCode });
  }

  function handleDrawCard() {
    if (!isMyTurn || hasDrawn) return;
    socket.emit('draw-card');
  }

  function handleKeepCard(handIndex) {
    socket.emit('keep-card', { handIndex });
  }

  function handleDiscardCard() {
    socket.emit('discard-card');
  }

  function handleSkipRule() {
    socket.emit('skip-rule');
  }

  // Rule: peek own (7/8)
  function handlePeekOwnSelect(handIndex) {
    socket.emit('use-peek-own', { handIndex });
  }

  // Rule: peek other (9/10)
  function handlePeekOtherSelect(targetPlayerId, handIndex) {
    socket.emit('use-peek-other', { targetPlayerId, handIndex });
  }

  // Rule: blind switch (J/Q) - two-step selection
  function handleBlindSwitchSelect(playerId, cardIndex) {
    if (!switchSelectionA) {
      setSwitchSelectionA({ playerId, index: cardIndex });
    } else {
      socket.emit('use-blind-switch', {
        playerAId: switchSelectionA.playerId,
        indexA: switchSelectionA.index,
        playerBId: playerId,
        indexB: cardIndex,
      });
      setSwitchSelectionA(null);
    }
  }

  // Rule: black king peek - two-step card selection
  function handleBlackKingPeekSelect(playerId, cardIndex) {
    if (!bkPeekSelectionA) {
      setBkPeekSelectionA({ playerId, index: cardIndex });
    } else {
      socket.emit('use-black-king-peek', {
        target1PlayerId: bkPeekSelectionA.playerId,
        index1: bkPeekSelectionA.index,
        target2PlayerId: playerId,
        index2: cardIndex,
      });
      setBkPeekSelectionA(null);
    }
  }

  // Black king: after viewing, switch
  function handleBlackKingSwitchSelect(playerId, cardIndex) {
    if (!bkSwitchSelectionA) {
      setBkSwitchSelectionA({ playerId, index: cardIndex });
    } else {
      socket.emit('use-black-king-switch', {
        playerAId: bkSwitchSelectionA.playerId,
        indexA: bkSwitchSelectionA.index,
        playerBId: playerId,
        indexB: cardIndex,
      });
      setBkSwitchSelectionA(null);
      setBlackKingPeekResult(null);
    }
  }

  function handleBlackKingSkipSwitch() {
    socket.emit('use-black-king-skip');
    setBlackKingPeekResult(null);
  }

  function handleBlackKingGoToSwitch() {
    setBlackKingPhase('switch-select');
  }

  function dismissPeekResult() {
    setPeekResult(null);
  }

  // Determine what click handler to use for cards based on current state
  function getMyCardClickHandler() {
    if (gamePhase !== 'play') return undefined;

    // Keeping drawn card - select which card to replace
    if (isMyTurn && hasDrawn && !activeRule) {
      return (index) => handleKeepCard(index);
    }

    // Peek own rule
    if (isMyTurn && activeRule === 'peek-own' && ruleStep === 'executing') {
      return (index) => handlePeekOwnSelect(index);
    }

    // Blind switch - can select own cards
    if (isMyTurn && activeRule === 'blind-switch' && ruleStep === 'executing') {
      return (index) => handleBlindSwitchSelect(playerInfo.id, index);
    }

    // Black king peek select
    if (isMyTurn && activeRule === 'black-king' && blackKingPhase === 'peek-select') {
      return (index) => handleBlackKingPeekSelect(playerInfo.id, index);
    }

    // Black king switch select
    if (isMyTurn && activeRule === 'black-king' && blackKingPhase === 'switch-select') {
      return (index) => handleBlackKingSwitchSelect(playerInfo.id, index);
    }

    return undefined;
  }

  function getOpponentCardClickHandler(oppId) {
    if (gamePhase !== 'play' || !isMyTurn) return undefined;

    // Peek other rule
    if (activeRule === 'peek-other' && ruleStep === 'executing') {
      return (index) => handlePeekOtherSelect(oppId, index);
    }

    // Blind switch
    if (activeRule === 'blind-switch' && ruleStep === 'executing') {
      return (index) => handleBlindSwitchSelect(oppId, index);
    }

    // Black king peek select
    if (activeRule === 'black-king' && blackKingPhase === 'peek-select') {
      return (index) => handleBlackKingPeekSelect(oppId, index);
    }

    // Black king switch select
    if (activeRule === 'black-king' && blackKingPhase === 'switch-select') {
      return (index) => handleBlackKingSwitchSelect(oppId, index);
    }

    return undefined;
  }

  function getMySelectableIndices() {
    if (gamePhase !== 'play') return undefined;
    if (isMyTurn && hasDrawn && !activeRule) return [0, 1, 2, 3];
    if (isMyTurn && activeRule === 'peek-own') return [0, 1, 2, 3];
    if (isMyTurn && activeRule === 'blind-switch') return [0, 1, 2, 3];
    if (isMyTurn && activeRule === 'black-king' && (blackKingPhase === 'peek-select' || blackKingPhase === 'switch-select')) return [0, 1, 2, 3];
    return undefined;
  }

  function getOpponentSelectableIndices(oppId) {
    if (gamePhase !== 'play' || !isMyTurn) return undefined;
    if (activeRule === 'peek-other') return [0, 1, 2, 3];
    if (activeRule === 'blind-switch') return [0, 1, 2, 3];
    if (activeRule === 'black-king' && (blackKingPhase === 'peek-select' || blackKingPhase === 'switch-select')) return [0, 1, 2, 3];
    return undefined;
  }

  // Get the turn player's name
  function getTurnPlayerName() {
    if (!currentTurn) return '';
    if (playerInfo && currentTurn === playerInfo.id) return 'Your';
    const p = players.find((pl) => pl.id === currentTurn) || opponents.find((o) => o.id === currentTurn);
    return p ? `${p.name}'s` : '';
  }

  // Get instruction text
  function getInstructionText() {
    if (gamePhase === 'peek') {
      if (hasPeeked) return 'Waiting for others to peek...';
      if (isPeeking) return 'Memorize your bottom 2 cards!';
      return 'Peek at your bottom cards before play begins';
    }

    if (gamePhase === 'play') {
      if (!isMyTurn) return `${getTurnPlayerName()} turn`;

      if (activeRule) {
        if (activeRule === 'black-king') {
          if (blackKingPhase === 'peek-select') {
            if (bkPeekSelectionA) return 'Pick the second card to peek at';
            return 'Pick any 2 cards on the table to peek at';
          }
          if (blackKingPhase === 'peek-result') return 'You peeked at 2 cards. Switch or skip?';
          if (blackKingPhase === 'switch-select') {
            if (bkSwitchSelectionA) return 'Pick the second card to switch with';
            return 'Pick any 2 cards to blind switch';
          }
        }
        if (activeRule === 'blind-switch') {
          if (switchSelectionA) return 'Pick the second card to switch with';
          return RULE_DESCRIPTIONS[activeRule];
        }
        return RULE_DESCRIPTIONS[activeRule] || 'Use the card rule';
      }

      if (hasDrawn) return 'Keep the card or discard it';
      return 'Draw a card from the deck';
    }

    return '';
  }

  if (!roomCode) return null;

  return (
    <div className="game-room-page">
      <div className="game-room-header">
        <h1 className="game-room-title">RED KING</h1>
        <div className="game-room-header-right">
          <button className="btn btn-rules" onClick={() => setShowRules(true)}>
            Rules
          </button>
          <span className="game-room-code">Room: {roomCode}</span>
        </div>
      </div>

      <div className="game-room-content">
        <div className="game-area">
          {/* Instruction banner */}
          {gamePhase && (
            <div className={`instruction-banner ${isMyTurn ? 'your-turn' : ''}`}>
              {isMyTurn && gamePhase === 'play' && <span className="turn-indicator">YOUR TURN</span>}
              <span className="instruction-text">{getInstructionText()}</span>
            </div>
          )}

          <div className="table-center">
            <div className="opponents-area">
              {opponents.map((opp) => (
                <div key={opp.id} className={`opponent-hand ${currentTurn === opp.id ? 'active-turn' : ''}`}>
                  <span className="opponent-name">
                    {opp.name}
                    {currentTurn === opp.id && <span className="turn-dot" />}
                  </span>
                  <div className="opponent-cards">
                    <CardGrid
                      cards={Array.from({ length: 4 }).map(() => null)}
                      isPeeking={false}
                      size="small"
                      onCardClick={getOpponentCardClickHandler(opp.id)}
                      selectableIndices={getOpponentSelectableIndices(opp.id)}
                    />
                  </div>
                  {gamePhase === 'peek' && peekDonePlayers.has(opp.id) && (
                    <span className="peek-done-badge">Ready</span>
                  )}
                </div>
              ))}
            </div>

            <div className="table-piles">
              <DrawPile
                count={deckCount}
                onClick={handleDrawCard}
                canDraw={isMyTurn && !hasDrawn && gamePhase === 'play' && !activeRule}
              />
              <DiscardPile topCard={topDiscard} />
            </div>

            {/* Drawn card display */}
            {isMyTurn && hasDrawn && !activeRule && (
              <div className="drawn-card-area">
                <span className="drawn-card-label">You drew:</span>
                <Card card={drawnCard} faceUp={true} />
                <div className="drawn-card-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => {}}>
                    Keep
                  </button>
                  {drawnCardHasRule ? (
                    <button className="btn btn-secondary btn-sm" onClick={handleDiscardCard}>
                      Use Rule ({drawnCardRuleType})
                    </button>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={handleDiscardCard}>
                      Discard
                    </button>
                  )}
                </div>
                {/* Show "select a card" hint when keeping */}
                <span className="drawn-card-hint">Select a card from your hand to swap</span>
              </div>
            )}

            {/* Active rule execution UI */}
            {isMyTurn && activeRule && ruleStep === 'executing' && activeRule !== 'black-king' && (
              <div className="rule-execution-area">
                <span className="rule-label">Using: {activeRule}</span>
                <button className="btn btn-danger btn-sm" onClick={handleSkipRule}>
                  Skip Rule
                </button>
              </div>
            )}

            {/* Black King flow */}
            {isMyTurn && activeRule === 'black-king' && blackKingPhase === 'peek-result' && blackKingPeekResult && (
              <div className="black-king-result">
                <span className="rule-label">You peeked at:</span>
                <div className="bk-peeked-cards">
                  <div className="bk-peeked-item">
                    <Card card={blackKingPeekResult.card1} faceUp={true} size="normal" />
                    <span className="bk-peeked-owner">
                      {blackKingPeekResult.target1PlayerId === playerInfo.id
                        ? 'You'
                        : (players.find((p) => p.id === blackKingPeekResult.target1PlayerId) || opponents.find((o) => o.id === blackKingPeekResult.target1PlayerId))?.name
                      } #{blackKingPeekResult.index1 + 1}
                    </span>
                  </div>
                  <div className="bk-peeked-item">
                    <Card card={blackKingPeekResult.card2} faceUp={true} size="normal" />
                    <span className="bk-peeked-owner">
                      {blackKingPeekResult.target2PlayerId === playerInfo.id
                        ? 'You'
                        : (players.find((p) => p.id === blackKingPeekResult.target2PlayerId) || opponents.find((o) => o.id === blackKingPeekResult.target2PlayerId))?.name
                      } #{blackKingPeekResult.index2 + 1}
                    </span>
                  </div>
                </div>
                <div className="bk-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleBlackKingGoToSwitch}>
                    Switch Cards
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleBlackKingSkipSwitch}>
                    Skip Switch
                  </button>
                </div>
              </div>
            )}

            {isMyTurn && activeRule === 'black-king' && blackKingPhase === 'switch-select' && (
              <div className="rule-execution-area">
                <span className="rule-label">Blind Switch (Black King)</span>
                <button className="btn btn-danger btn-sm" onClick={handleBlackKingSkipSwitch}>
                  Skip Switch
                </button>
              </div>
            )}
          </div>

          {/* Peek result overlay */}
          {peekResult && (
            <div className="peek-result-overlay" onClick={dismissPeekResult}>
              <div className="peek-result-content" onClick={(e) => e.stopPropagation()}>
                <span className="peek-result-label">
                  {peekResult.targetPlayerId
                    ? `${(players.find((p) => p.id === peekResult.targetPlayerId) || opponents.find((o) => o.id === peekResult.targetPlayerId))?.name}'s card #${peekResult.handIndex + 1}`
                    : `Your card #${peekResult.handIndex + 1}`
                  }
                </span>
                <Card card={peekResult.card} faceUp={true} />
                <button className="btn btn-primary btn-sm" onClick={dismissPeekResult}>
                  Got it
                </button>
              </div>
            </div>
          )}

          <div className="my-hand-area">
            <span className="my-hand-label">Your Cards</span>
            {myCards && (
              <CardGrid
                cards={myCards}
                isPeeking={isPeeking}
                onCardClick={getMyCardClickHandler()}
                selectableIndices={getMySelectableIndices()}
              />
            )}
          </div>
        </div>

        <div className="game-sidebar">
          <PlayerList players={players} />

          {gamePhase === 'peek' && (
            <div className="peek-controls">
              {!hasPeeked && !isPeeking && (
                <button className="btn btn-primary" onClick={handlePeek}>
                  Peek at Bottom Cards
                </button>
              )}
              {isPeeking && (
                <button className="btn btn-secondary" onClick={handleDonePeeking}>
                  Done Peeking
                </button>
              )}
              {hasPeeked && (
                <p className="peek-status">Waiting for others...</p>
              )}
            </div>
          )}

          {/* Action log */}
          {gamePhase === 'play' && actionLog.length > 0 && (
            <div className="action-log">
              <h4 className="action-log-title">Activity</h4>
              <div className="action-log-entries">
                {actionLog.slice().reverse().map((entry, i) => (
                  <div key={i} className="action-log-entry">
                    {entry.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-danger" onClick={handleEndGame}>
            End Game
          </button>
        </div>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
