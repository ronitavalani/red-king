import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useSocket } from '../context/SocketContext';
import { socket } from '../socket';
import PlayerList from '../components/PlayerList';
import CardGrid from '../components/CardGrid';
import DrawPile from '../components/DrawPile';
import Card from '../components/Card';
import './GameRoom.css';

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
  } = useSocket();

  const [isPeeking, setIsPeeking] = useState(false);
  const [hasPeeked, setHasPeeked] = useState(false);

  useEffect(() => {
    if (roomState === 'waiting') navigate('/waiting-room');
    if (!roomCode) navigate('/');
  }, [roomState, roomCode, navigate]);

  // Reset peek state when a new game starts
  useEffect(() => {
    if (gamePhase === 'peek') {
      setIsPeeking(false);
      setHasPeeked(false);
    }
  }, [gamePhase]);

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

  if (!roomCode) return null;

  return (
    <div className="game-room-page">
      <div className="game-room-header">
        <h1 className="game-room-title">RED KING</h1>
        <span className="game-room-code">Room: {roomCode}</span>
      </div>

      <div className="game-room-content">
        <div className="game-area">
          <div className="table-center">
            <div className="opponents-area">
              {opponents.map((opp) => (
                <div key={opp.id} className="opponent-hand">
                  <span className="opponent-name">{opp.name}</span>
                  <div className="opponent-cards">
                    {/* Show opponents' cards as a 2x2 grid of backs */}
                    <CardGrid cards={Array.from({ length: 4 }).map(() => null)} isPeeking={false} />
                  </div>
                  {gamePhase === 'peek' && peekDonePlayers.has(opp.id) && (
                    <span className="peek-done-badge">Ready</span>
                  )}
                </div>
              ))}
            </div>
            <DrawPile count={deckCount} />
          </div>

          <div className="my-hand-area">
            <span className="my-hand-label">Your Cards</span>
            {myCards && <CardGrid cards={myCards} isPeeking={isPeeking} />}
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

          {gamePhase === 'play' && (
            <p className="phase-label">Game in progress...</p>
          )}

          <button className="btn btn-danger" onClick={handleEndGame}>
            End Game
          </button>
        </div>
      </div>
    </div>
  );
}
