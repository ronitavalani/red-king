import { useSocket } from '../context/SocketContext';
import './PlayerList.css';

export default function PlayerList({ players }) {
  const { playerInfo } = useSocket();

  return (
    <div className="player-list">
      <h3 className="player-list-title">
        Players ({players.length}/8)
      </h3>
      <ul>
        {players.map((player) => (
          <li
            key={player.id}
            className={`player-item ${player.isHost ? 'is-host' : ''} ${
              playerInfo && player.id === playerInfo.id ? 'is-you' : ''
            } ${player.isCpu ? 'is-cpu' : ''}`}
          >
            <span className="player-name">{player.name}</span>
            <span className="player-badges">
              {player.isHost && <span className="badge host-badge">Host</span>}
              {player.isCpu && <span className="badge cpu-badge">CPU</span>}
              {playerInfo && player.id === playerInfo.id && (
                <span className="badge you-badge">You</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
