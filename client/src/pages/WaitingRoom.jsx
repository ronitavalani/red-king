import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useSocket } from '../context/SocketContext';
import { socket } from '../socket';
import RoomCode from '../components/RoomCode';
import PlayerList from '../components/PlayerList';
import './WaitingRoom.css';

export default function WaitingRoom() {
  const navigate = useNavigate();
  const { roomCode, players, playerInfo, roomState } = useSocket();

  useEffect(() => {
    if (roomState === 'playing') navigate('/game-room');
    if (!roomCode) navigate('/');
  }, [roomState, roomCode, navigate]);

  function handleStartGame() {
    socket.emit('start-game', { roomCode });
  }

  function handleLeaveRoom() {
    socket.emit('leave-room');
    socket.disconnect();
  }

  if (!roomCode) return null;

  return (
    <div className="waiting-room-page">
      <div className="waiting-container">
        <h1 className="waiting-title">RED KING</h1>
        <h2 className="waiting-subtitle">Waiting Room</h2>

        <RoomCode code={roomCode} />

        <p className="share-hint">Share this code with other players to join</p>

        <PlayerList players={players} />

        <div className="waiting-actions">
          {playerInfo?.isHost && (
            <button
              className="btn btn-primary"
              onClick={handleStartGame}
              disabled={players.length < 1}
            >
              Start Game
            </button>
          )}
          {!playerInfo?.isHost && (
            <p className="waiting-hint">Waiting for host to start the game...</p>
          )}
          <button className="btn btn-danger" onClick={handleLeaveRoom}>
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}
