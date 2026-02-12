import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useSocket } from '../context/SocketContext';
import { socket } from '../socket';
import './HomePage.css';

export default function HomePage() {
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState(null);
  const navigate = useNavigate();
  const { roomState, error, setError } = useSocket();

  useEffect(() => {
    if (roomState === 'waiting') navigate('/waiting-room');
    if (roomState === 'playing') navigate('/game-room');
  }, [roomState, navigate]);

  function handleHost() {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    setError(null);
    if (!socket.connected) socket.connect();
    socket.emit('host-game', { playerName: playerName.trim() });
  }

  function handleJoin() {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!joinCode.trim()) {
      setError('Please enter a room code');
      return;
    }
    setError(null);
    if (!socket.connected) socket.connect();
    socket.emit('join-game', {
      playerName: playerName.trim(),
      roomCode: joinCode.trim().toUpperCase(),
    });
  }

  return (
    <div className="home-page">
      <div className="home-container">
        <h1 className="game-title">RED KING</h1>
        <p className="game-subtitle">A Multiplayer Card Game</p>

        <div className="name-input-group">
          <label htmlFor="playerName">Your Name</label>
          <input
            id="playerName"
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={20}
          />
        </div>

        {error && <div className="error-message">{error}</div>}

        {!mode && (
          <div className="action-buttons">
            <button className="btn btn-primary" onClick={() => setMode('host')}>
              Host Game
            </button>
            <button className="btn btn-secondary" onClick={() => setMode('join')}>
              Join Game
            </button>
          </div>
        )}

        {mode === 'host' && (
          <div className="action-panel">
            <p>Create a new room and invite others to join.</p>
            <div className="panel-buttons">
              <button className="btn btn-primary" onClick={handleHost}>
                Create Room
              </button>
              <button className="btn btn-back" onClick={() => { setMode(null); setError(null); }}>
                Back
              </button>
            </div>
          </div>
        )}

        {mode === 'join' && (
          <div className="action-panel">
            <div className="code-input-group">
              <label htmlFor="roomCode">Room Code</label>
              <input
                id="roomCode"
                type="text"
                placeholder="e.g. A7K2"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={4}
              />
            </div>
            <div className="panel-buttons">
              <button className="btn btn-primary" onClick={handleJoin}>
                Join Room
              </button>
              <button className="btn btn-back" onClick={() => { setMode(null); setError(null); }}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
