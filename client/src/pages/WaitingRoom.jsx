import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSocket } from '../context/SocketContext';
import { socket } from '../socket';
import RoomCode from '../components/RoomCode';
import PlayerList from '../components/PlayerList';
import './WaitingRoom.css';

export default function WaitingRoom() {
  const navigate = useNavigate();
  const { roomCode, players, playerInfo, roomState } = useSocket();
  const [cpuDifficulty, setCpuDifficulty] = useState('medium');
  const DIFFS = ['easy', 'medium', 'hard'];

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

  function handleAddCpu() {
    socket.emit('add-cpu-player', { difficulty: cpuDifficulty });
  }

  function handleCycleDiff() {
    setCpuDifficulty(DIFFS[(DIFFS.indexOf(cpuDifficulty) + 1) % 3]);
  }

  const cpuCount = players.filter((p) => p.isCpu).length;

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
            <>
              <button
                className="btn btn-primary"
                onClick={handleStartGame}
                disabled={players.length < 1}
              >
                Start Game
              </button>
              <div className="cpu-controls">
                <div className="cpu-controls-row">
                  <button className="btn btn-secondary btn-sm" onClick={handleCycleDiff}>
                    {cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1)}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={handleAddCpu}
                    disabled={players.length >= 8}
                  >
                    + Add CPU
                  </button>
                </div>
                {cpuCount > 0 && (
                  <p className="cpu-count-hint">
                    {cpuCount} CPU player{cpuCount !== 1 ? 's' : ''} added
                  </p>
                )}
              </div>
            </>
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
