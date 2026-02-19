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
    highlightedCards,
    matchResult,
    setMatchResult,
    matchMode,
    setMatchMode,
    pendingMatchOther,
    setPendingMatchOther,
    handLayouts,
    redKingCaller,
    gameResults,
    setGameResults,
  } = useSocket();

  // Build per-player highlight maps: { [playerId]: { [index]: type } }
  const highlightMap = {};
  for (const h of highlightedCards) {
    if (!highlightMap[h.playerId]) highlightMap[h.playerId] = {};
    highlightMap[h.playerId][h.index] = h.type;
  }

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
  const isPlayable = gamePhase === 'play' || gamePhase === 'redemption';
  const isCallerProtected = redKingCaller && redKingCaller.callerId === playerInfo?.id && gamePhase === 'redemption';
  const canCallMatch = isPlayable && topDiscard && !matchMode && !activeRule && !isCallerProtected;

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

  // When a successful match-other result comes in for us, enter give-card mode
  useEffect(() => {
    if (
      matchResult &&
      matchResult.success &&
      matchResult.type === 'other' &&
      matchResult.callerId === playerInfo?.id
    ) {
      setMatchMode('give-card');
      setPendingMatchOther({
        targetPlayerId: matchResult.targetId,
        targetIndex: matchResult.targetIndex,
      });
    }
  }, [matchResult, playerInfo, setMatchMode, setPendingMatchOther]);

  // --- Match calling handlers ---
  function handleDiscardTap() {
    if (!canCallMatch) return;
    setMatchMode('select-target');
  }

  function handleCancelMatch() {
    setMatchMode(null);
    setPendingMatchOther(null);
  }

  function handleMatchCardSelect(targetPlayerId, handIndex) {
    if (matchMode === 'select-target') {
      if (targetPlayerId === playerInfo.id) {
        socket.emit('call-match-own', { handIndex });
      } else {
        socket.emit('call-match-other', { targetPlayerId, handIndex });
      }
      setMatchMode(null);
    } else if (matchMode === 'give-card' && pendingMatchOther) {
      // Give one of our own cards to the target
      socket.emit('give-card-after-match', {
        callerHandIndex: handIndex,
        targetPlayerId: pendingMatchOther.targetPlayerId,
        targetIndex: pendingMatchOther.targetIndex,
      });
      setMatchMode(null);
      setPendingMatchOther(null);
      setMatchResult(null);
    }
  }

  function dismissMatchResult() {
    setMatchResult(null);
  }

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

  function handleReturnToLobby() {
    setGameResults(null);
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

  function handleCallRedKing() {
    socket.emit('call-red-king');
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
    socket.emit('finish-peek');
  }

  // Helper to get non-null indices for own hand
  function myNonNullIndices() {
    if (!myCards) return [];
    return myCards.map((c, i) => c !== null ? i : -1).filter((i) => i !== -1);
  }

  // Helper to get non-null indices from an opponent's layout
  function oppNonNullIndices(oppId) {
    const layout = handLayouts[oppId];
    if (!layout) return [0, 1, 2, 3]; // default 4 cards
    return layout.map((hasCard, i) => hasCard ? i : -1).filter((i) => i !== -1);
  }

  // Check if an opponent is protected (Red King caller during redemption)
  function isOppProtected(oppId) {
    return gamePhase === 'redemption' && redKingCaller && redKingCaller.callerId === oppId;
  }

  // Determine what click handler to use for cards based on current state
  function getMyCardClickHandler() {
    if (!isPlayable) return undefined;

    // Caller's hand is locked during redemption
    if (isCallerProtected) return undefined;

    // Match mode: selecting a card to match or give
    if (matchMode === 'select-target') {
      return (index) => handleMatchCardSelect(playerInfo.id, index);
    }
    if (matchMode === 'give-card') {
      return (index) => handleMatchCardSelect(playerInfo.id, index);
    }

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
    if (!isPlayable) return undefined;

    // Protected opponent's cards can't be interacted with
    if (isOppProtected(oppId)) return undefined;

    // Match mode: selecting opponent card to match
    if (matchMode === 'select-target') {
      return (index) => handleMatchCardSelect(oppId, index);
    }

    if (!isMyTurn) return undefined;

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
    if (!isPlayable) return undefined;
    if (isCallerProtected) return undefined;
    const indices = myNonNullIndices();
    if (matchMode === 'select-target' || matchMode === 'give-card') return indices;
    if (isMyTurn && hasDrawn && !activeRule) return indices;
    if (isMyTurn && activeRule === 'peek-own') return indices;
    if (isMyTurn && activeRule === 'blind-switch') return indices;
    if (isMyTurn && activeRule === 'black-king' && (blackKingPhase === 'peek-select' || blackKingPhase === 'switch-select')) return indices;
    return undefined;
  }

  function getOpponentSelectableIndices(oppId) {
    if (!isPlayable) return undefined;
    if (isOppProtected(oppId)) return undefined;
    const indices = oppNonNullIndices(oppId);
    if (matchMode === 'select-target') return indices;
    if (!isMyTurn) return undefined;
    if (activeRule === 'peek-other') return indices;
    if (activeRule === 'blind-switch') return indices;
    if (activeRule === 'black-king' && (blackKingPhase === 'peek-select' || blackKingPhase === 'switch-select')) return indices;
    return undefined;
  }

  // Build opponent cards array from layout: true → face-down placeholder, false → null (empty slot)
  function getOpponentCards(oppId) {
    const layout = handLayouts[oppId];
    if (!layout) return Array(4).fill(false); // default: 4 face-down cards
    return layout.map((hasCard) => (hasCard ? false : null));
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

    if (gamePhase === 'reveal') {
      return 'Cards revealed!';
    }

    if (isPlayable) {
      // Match mode instructions (can happen any time, not just your turn)
      if (matchMode === 'select-target') return 'Pick a card to match against the discard pile';
      if (matchMode === 'give-card') return 'Pick one of YOUR cards to give to the other player';

      // Redemption-specific instructions
      if (gamePhase === 'redemption' && isCallerProtected) {
        return 'Your cards are locked. Waiting for redemption round...';
      }

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

  // Determine the phase indicator for the banner
  function getBannerIndicator() {
    if (gamePhase === 'redemption') return 'REDEMPTION';
    if (matchMode) return 'MATCH';
    if (isMyTurn && isPlayable) return 'YOUR TURN';
    return null;
  }

  function getBannerClass() {
    const classes = ['instruction-banner'];
    if (isMyTurn && isPlayable) classes.push('your-turn');
    if (matchMode) classes.push('match-mode');
    if (gamePhase === 'redemption') classes.push('redemption-mode');
    return classes.join(' ');
  }

  // Can the player call Red King right now?
  const canCallRedKing = gamePhase === 'play' && isMyTurn && !hasDrawn && !activeRule && !matchMode;

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
          {gamePhase && gamePhase !== 'reveal' && (
            <div className={getBannerClass()}>
              {getBannerIndicator() && (
                <span className={`turn-indicator ${getBannerIndicator() === 'MATCH' ? 'match-indicator' : ''} ${getBannerIndicator() === 'REDEMPTION' ? 'redemption-indicator' : ''}`}>
                  {getBannerIndicator()}
                </span>
              )}
              <span className="instruction-text">{getInstructionText()}</span>
            </div>
          )}

          <div className="table-center">
            <div className="opponents-area">
              {opponents.map((opp) => (
                <div key={opp.id} className={`opponent-hand ${currentTurn === opp.id ? 'active-turn' : ''} ${isOppProtected(opp.id) ? 'protected' : ''}`}>
                  <span className="opponent-name">
                    {opp.name}
                    {currentTurn === opp.id && <span className="turn-dot" />}
                    {isOppProtected(opp.id) && <span className="protected-badge">locked</span>}
                  </span>
                  <div className="opponent-cards">
                    <CardGrid
                      cards={getOpponentCards(opp.id)}
                      isPeeking={false}
                      size="small"
                      onCardClick={getOpponentCardClickHandler(opp.id)}
                      selectableIndices={getOpponentSelectableIndices(opp.id)}
                      highlightedIndices={highlightMap[opp.id]}
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
                canDraw={isMyTurn && !hasDrawn && isPlayable && !activeRule && !isCallerProtected}
              />
              <DiscardPile
                topCard={topDiscard}
                onClick={handleDiscardTap}
                canMatch={canCallMatch}
              />
            </div>

            {/* Call Red King button */}
            {canCallRedKing && (
              <div className="call-red-king-area">
                <button className="btn btn-red-king" onClick={handleCallRedKing}>
                  Call Red King
                </button>
                <span className="red-king-hint">Declare you have the lowest total</span>
              </div>
            )}

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

            {/* Match mode cancel button */}
            {matchMode === 'select-target' && (
              <div className="rule-execution-area match-execution-area">
                <span className="rule-label">Calling a Match...</span>
                <button className="btn btn-danger btn-sm" onClick={handleCancelMatch}>
                  Cancel
                </button>
              </div>
            )}

            {matchMode === 'give-card' && (
              <div className="rule-execution-area match-execution-area">
                <span className="rule-label">Pick a card to give away</span>
              </div>
            )}
          </div>

          {/* Peek result overlay */}
          {peekResult && (
            <div className="peek-result-overlay">
              <div className="peek-result-content">
                <span className="peek-result-label">
                  {peekResult.targetPlayerId
                    ? `${(players.find((p) => p.id === peekResult.targetPlayerId) || opponents.find((o) => o.id === peekResult.targetPlayerId))?.name}'s card #${peekResult.handIndex + 1}`
                    : `Your card #${peekResult.handIndex + 1}`
                  }
                </span>
                <Card card={peekResult.card} faceUp={true} />
                <button className="btn btn-primary btn-sm" onClick={dismissPeekResult}>
                  Finish Peeking
                </button>
              </div>
            </div>
          )}

          {/* Match result overlay */}
          {matchResult && matchMode !== 'give-card' && (
            <div className="peek-result-overlay" onClick={dismissMatchResult}>
              <div className={`peek-result-content match-result-content ${matchResult.success ? 'match-success' : 'match-fail'}`} onClick={(e) => e.stopPropagation()}>
                <span className="match-result-title">
                  {matchResult.success ? 'Match!' : 'Wrong!'}
                </span>
                <span className="peek-result-label">
                  {matchResult.callerName}
                  {matchResult.type === 'own'
                    ? ' matched their own card'
                    : matchResult.success
                      ? ` matched ${matchResult.targetName}'s card`
                      : ` tried to match ${matchResult.targetName}'s card`
                  }
                </span>
                <Card card={matchResult.card} faceUp={true} />
                <span className="match-result-detail">
                  {matchResult.success
                    ? 'Card removed from hand!'
                    : 'Penalty card drawn from deck'
                  }
                </span>
                <button className="btn btn-primary btn-sm" onClick={dismissMatchResult}>
                  OK
                </button>
              </div>
            </div>
          )}

          {/* Game Results overlay */}
          {gameResults && (
            <div className="game-results-overlay">
              <div className="game-results-content">
                <h2 className="game-results-title">Game Over</h2>
                <p className="game-results-subtitle">
                  {gameResults.callerName} called Red King!
                </p>

                <div className="results-players">
                  {gameResults.results.map((r) => (
                    <div
                      key={r.id}
                      className={`result-player ${r.id === gameResults.winnerId ? 'winner' : ''} ${r.isCaller ? 'caller' : ''}`}
                    >
                      <div className="result-header">
                        <span className="result-name">
                          {r.name}
                          {r.isCaller && <span className="result-caller-badge">Caller</span>}
                          {r.id === gameResults.winnerId && <span className="result-winner-badge">Winner</span>}
                        </span>
                        <span className="result-score">{r.score} pts</span>
                      </div>
                      <div className="result-cards">
                        {r.hand.map((card, i) => (
                          <Card key={i} card={card} faceUp={true} size="small" />
                        ))}
                        {r.hand.length === 0 && <span className="result-no-cards">No cards</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="result-winner-text">
                  {gameResults.winnerName} wins!
                  {gameResults.winnerId !== gameResults.callerId &&
                    gameResults.results.find((r) => r.id === gameResults.callerId)?.score ===
                    gameResults.results.find((r) => r.id === gameResults.winnerId)?.score &&
                    ' (Caller loses ties)'
                  }
                </div>

                <button className="btn btn-primary" onClick={handleReturnToLobby}>
                  Return to Lobby
                </button>
              </div>
            </div>
          )}

          <div className="my-hand-area">
            <span className="my-hand-label">
              Your Cards
              {isCallerProtected && <span className="protected-badge">locked</span>}
            </span>
            {myCards && (
              <CardGrid
                cards={myCards}
                isPeeking={isPeeking}
                onCardClick={getMyCardClickHandler()}
                selectableIndices={getMySelectableIndices()}
                highlightedIndices={playerInfo ? highlightMap[playerInfo.id] : undefined}
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
          {isPlayable && actionLog.length > 0 && (
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

          {!gameResults && (
            <button className="btn btn-danger" onClick={handleEndGame}>
              End Game
            </button>
          )}
        </div>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
