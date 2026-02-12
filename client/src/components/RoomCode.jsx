import { useState } from 'react';
import './RoomCode.css';

export default function RoomCode({ code }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="room-code-container">
      <span className="room-code-label">Room Code</span>
      <div className="room-code-display">
        <span className="room-code-text">{code}</span>
        <button className="copy-btn" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
