import { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import Card from './Card';
import './DebugPanel.css';

const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
  joker: '★',
};

function cardPoints(card) {
  if (!card) return 0;
  if (card.suit === 'joker') return 0;
  if (card.rank === 'A') return 1;
  if (card.rank === 'K' && (card.suit === 'hearts' || card.suit === 'diamonds')) return -1;
  if (card.rank === 'K') return 10;
  if (card.rank === 'J' || card.rank === 'Q') return 10;
  return parseInt(card.rank);
}

function handScore(hand) {
  return hand.reduce((sum, card) => sum + cardPoints(card), 0);
}

export default function DebugPanel() {
  const { debugState, players, playerInfo } = useSocket();
  const [collapsed, setCollapsed] = useState(false);

  if (!debugState) {
    return (
      <div className="debug-panel debug-panel-waiting">
        <span className="debug-badge">DEBUG</span>
        <span className="debug-waiting">Waiting for game to start…</span>
      </div>
    );
  }

  const { hands, phase, currentTurn, deckCount, topDiscard } = debugState;

  // Determine turn player name
  const turnPlayer = players.find((p) => p.id === currentTurn);
  const turnName = playerInfo && currentTurn === playerInfo.id
    ? 'You'
    : (turnPlayer ? turnPlayer.name : currentTurn);

  return (
    <div className="debug-panel">
      <div className="debug-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="debug-badge">DEBUG</span>
        <span className="debug-meta">
          Phase: <strong>{phase}</strong>
          {currentTurn && <> · Turn: <strong>{turnName}</strong></>}
        </span>
        <span className="debug-meta">
          Deck: <strong>{deckCount}</strong>
          {topDiscard && (
            <> · Discard: <strong>{topDiscard.rank}{SUIT_SYMBOLS[topDiscard.suit]}</strong></>
          )}
        </span>
        <button className="debug-toggle" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '▲' : '▼'}
        </button>
      </div>

      {!collapsed && (
        <div className="debug-body">
          {Object.entries(hands).map(([playerId, { name, isCpu, hand }]) => {
            const score = handScore(hand);
            const isMe = playerInfo && playerId === playerInfo.id;
            const isCurrentTurn = playerId === currentTurn;
            return (
              <div
                key={playerId}
                className={`debug-player ${isMe ? 'debug-me' : ''} ${isCurrentTurn ? 'debug-active' : ''}`}
              >
                <div className="debug-player-header">
                  <span className="debug-player-name">
                    {name}
                    {isMe && <span className="debug-you-badge">you</span>}
                    {isCpu && <span className="debug-cpu-badge">cpu</span>}
                    {isCurrentTurn && <span className="debug-turn-dot" />}
                  </span>
                  <span className="debug-score">{score} pts</span>
                </div>
                <div className="debug-hand">
                  {hand.map((card, i) =>
                    card === null ? (
                      <div key={i} className="debug-empty-slot" title="empty slot" />
                    ) : (
                      <div key={i} className="debug-card-wrap">
                        <Card card={card} faceUp={true} size="small" />
                        <span className="debug-card-pts">{cardPoints(card)}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
