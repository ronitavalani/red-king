import { createContext, useContext, useState, useEffect } from 'react';
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
    };
  }, []);

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
