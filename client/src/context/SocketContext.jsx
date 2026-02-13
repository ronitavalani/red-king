import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { socket } from '../socket';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [roomCode, setRoomCode] = useState(null);
  const [players, setPlayers] = useState([]);
  const [playerInfo, setPlayerInfo] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [error, setError] = useState(null);
  const [myCards, setMyCards] = useState(null);
  const [gamePhase, setGamePhase] = useState(null);
  const [deckCount, setDeckCount] = useState(0);
  const [opponents, setOpponents] = useState([]);
  const [peekDonePlayers, setPeekDonePlayers] = useState(new Set());

  // Gameplay state
  const [currentTurn, setCurrentTurn] = useState(null);
  const [drawnCard, setDrawnCard] = useState(null);
  const [drawnCardHasRule, setDrawnCardHasRule] = useState(false);
  const [drawnCardRuleType, setDrawnCardRuleType] = useState(null);
  const [topDiscard, setTopDiscard] = useState(null);
  const [actionLog, setActionLog] = useState([]);
  const [activeRule, setActiveRule] = useState(null); // rule currently being executed
  const [peekResult, setPeekResult] = useState(null); // result of a peek action
  const [blackKingPeekResult, setBlackKingPeekResult] = useState(null);
  // highlightedCards: array of {playerId, index, type} that auto-clears after timeout
  const [highlightedCards, setHighlightedCards] = useState([]);
  const highlightTimerRef = useRef(null);

  const addLog = useCallback((entry) => {
    setActionLog((prev) => [...prev.slice(-19), entry]);
  }, []);

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
      resetState();
    }

    function onRoomCreated(data) {
      setRoomCode(data.roomCode);
      setPlayers(data.players);
      setPlayerInfo(data.you);
      setRoomState('waiting');
      setError(null);
    }

    function onRoomJoined(data) {
      setRoomCode(data.roomCode);
      setPlayers(data.players);
      setPlayerInfo(data.you);
      setRoomState(data.roomState);
      setError(null);
    }

    function onJoinError(data) {
      setError(data.message);
    }

    function onPlayerListUpdated(data) {
      setPlayers(data.players);
    }

    function onHostChanged(data) {
      setPlayerInfo((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          isHost: prev.id === data.newHostId,
        };
      });
      setPlayers((prev) =>
        prev.map((p) => ({
          ...p,
          isHost: p.id === data.newHostId,
        }))
      );
    }

    function onGameStarted(data) {
      setRoomState('playing');
      if (data && data.phase) setGamePhase(data.phase);
    }

    function onGameEnded(data) {
      setRoomState('waiting');
      setPlayers(data.players);
      setMyCards(null);
      setGamePhase(null);
      setDeckCount(0);
      setOpponents([]);
      setPeekDonePlayers(new Set());
      setCurrentTurn(null);
      setDrawnCard(null);
      setDrawnCardHasRule(false);
      setDrawnCardRuleType(null);
      setTopDiscard(null);
      setActionLog([]);
      setActiveRule(null);
      setPeekResult(null);
      setBlackKingPeekResult(null);
    }

    function onYouLeft() {
      resetState();
    }

    function onCardsDealt(data) {
      setMyCards(data.myCards);
      setGamePhase(data.phase);
      setDeckCount(data.deckCount);
      setOpponents(data.opponents);
      setPeekDonePlayers(new Set());
    }

    function onPlayerPeekDone(data) {
      setPeekDonePlayers((prev) => new Set([...prev, data.playerId]));
    }

    function onPhaseChanged(data) {
      setGamePhase(data.phase);
      if (data.currentTurn) setCurrentTurn(data.currentTurn);
      if (data.topDiscard !== undefined) setTopDiscard(data.topDiscard);
    }

    function onCardDrawn(data) {
      setDrawnCard(data.card);
      setDrawnCardHasRule(data.hasRule);
      setDrawnCardRuleType(data.ruleType);
    }

    function onOpponentDrew(data) {
      setDeckCount(data.deckCount);
      addLog({
        message: `${data.playerName} drew a card from the deck`,
        playerId: data.playerId,
      });
    }

    function onHandUpdated(data) {
      setMyCards(data.myCards);
    }

    function onCardDiscarded(data) {
      setTopDiscard(data.card);
      addLog({
        message: `${data.playerName} ${data.action}`,
        playerId: data.playerId,
        card: data.card,
      });
    }

    function onTurnUpdate(data) {
      setCurrentTurn(data.currentTurn);
      setDeckCount(data.deckCount);
      setTopDiscard(data.topDiscard);
      // Clear drawn card state when turn changes
      setDrawnCard(null);
      setDrawnCardHasRule(false);
      setDrawnCardRuleType(null);
      setActiveRule(null);
      setPeekResult(null);
      setBlackKingPeekResult(null);
    }

    function onExecuteRule(data) {
      setActiveRule(data.ruleType);
    }

    function onPeekResult(data) {
      setPeekResult(data);
    }

    function onBlackKingPeekResult(data) {
      setBlackKingPeekResult(data);
    }

    function onActionLog(data) {
      addLog({ message: data.message, playerId: data.playerId });
    }

    function onCardsHighlighted(data) {
      const entries = data.cards.map((c) => ({ ...c, type: data.type }));
      setHighlightedCards(entries);
      // Clear any existing timer
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      // Auto-clear after 2.5 seconds
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedCards([]);
        highlightTimerRef.current = null;
      }, 2500);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room-created', onRoomCreated);
    socket.on('room-joined', onRoomJoined);
    socket.on('join-error', onJoinError);
    socket.on('player-list-updated', onPlayerListUpdated);
    socket.on('host-changed', onHostChanged);
    socket.on('game-started', onGameStarted);
    socket.on('game-ended', onGameEnded);
    socket.on('you-left', onYouLeft);
    socket.on('cards-dealt', onCardsDealt);
    socket.on('player-peek-done', onPlayerPeekDone);
    socket.on('phase-changed', onPhaseChanged);
    socket.on('card-drawn', onCardDrawn);
    socket.on('opponent-drew', onOpponentDrew);
    socket.on('hand-updated', onHandUpdated);
    socket.on('card-discarded', onCardDiscarded);
    socket.on('turn-update', onTurnUpdate);
    socket.on('execute-rule', onExecuteRule);
    socket.on('peek-result', onPeekResult);
    socket.on('black-king-peek-result', onBlackKingPeekResult);
    socket.on('action-log', onActionLog);
    socket.on('cards-highlighted', onCardsHighlighted);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room-created', onRoomCreated);
      socket.off('room-joined', onRoomJoined);
      socket.off('join-error', onJoinError);
      socket.off('player-list-updated', onPlayerListUpdated);
      socket.off('host-changed', onHostChanged);
      socket.off('game-started', onGameStarted);
      socket.off('game-ended', onGameEnded);
      socket.off('you-left', onYouLeft);
      socket.off('cards-dealt', onCardsDealt);
      socket.off('player-peek-done', onPlayerPeekDone);
      socket.off('phase-changed', onPhaseChanged);
      socket.off('card-drawn', onCardDrawn);
      socket.off('opponent-drew', onOpponentDrew);
      socket.off('hand-updated', onHandUpdated);
      socket.off('card-discarded', onCardDiscarded);
      socket.off('turn-update', onTurnUpdate);
      socket.off('execute-rule', onExecuteRule);
      socket.off('peek-result', onPeekResult);
      socket.off('black-king-peek-result', onBlackKingPeekResult);
      socket.off('action-log', onActionLog);
      socket.off('cards-highlighted', onCardsHighlighted);
    };
  }, [addLog]);

  function resetState() {
    setRoomCode(null);
    setPlayers([]);
    setPlayerInfo(null);
    setRoomState(null);
    setError(null);
    setMyCards(null);
    setGamePhase(null);
    setDeckCount(0);
    setOpponents([]);
    setPeekDonePlayers(new Set());
    setCurrentTurn(null);
    setDrawnCard(null);
    setDrawnCardHasRule(false);
    setDrawnCardRuleType(null);
    setTopDiscard(null);
    setActionLog([]);
    setActiveRule(null);
    setPeekResult(null);
    setBlackKingPeekResult(null);
    setHighlightedCards([]);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }

  const value = {
    socket,
    isConnected,
    roomCode,
    players,
    playerInfo,
    roomState,
    error,
    setError,
    resetState,
    myCards,
    gamePhase,
    deckCount,
    opponents,
    peekDonePlayers,
    currentTurn,
    drawnCard,
    drawnCardHasRule,
    drawnCardRuleType,
    topDiscard,
    actionLog,
    activeRule,
    setActiveRule,
    peekResult,
    setPeekResult,
    blackKingPeekResult,
    setBlackKingPeekResult,
    highlightedCards,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used within SocketProvider');
  return context;
}
