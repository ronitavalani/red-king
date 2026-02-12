import './RulesModal.css';

export default function RulesModal({ onClose }) {
  return (
    <div className="rules-overlay" onClick={onClose}>
      <div className="rules-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rules-header">
          <h2>Game Rules</h2>
          <button className="rules-close" onClick={onClose}>&times;</button>
        </div>

        <div className="rules-body">
          <section className="rules-section">
            <h3>Goal</h3>
            <p>Have the <strong>least points</strong> by the end of the game. You may only play with one hand!</p>
          </section>

          <section className="rules-section">
            <h3>Setup</h3>
            <p>Each player gets 4 cards face down. Before play begins, you may peek at your 2 closest cards (bottom row) once to memorize them.</p>
          </section>

          <section className="rules-section">
            <h3>On Your Turn</h3>
            <p>Draw a card from the deck. Then choose:</p>
            <ul>
              <li><strong>Keep it</strong> &ndash; Swap it with one of your 4 cards (the replaced card is discarded)</li>
              <li><strong>Discard it</strong> &ndash; If the card has a special rule, you may use it</li>
            </ul>
          </section>

          <section className="rules-section">
            <h3>Point Values</h3>
            <div className="rules-points-grid">
              <div className="rules-point-item">
                <span className="rules-point-card">A</span>
                <span className="rules-point-value">1 point</span>
              </div>
              <div className="rules-point-item">
                <span className="rules-point-card">2&ndash;6</span>
                <span className="rules-point-value">Face value</span>
              </div>
              <div className="rules-point-item">
                <span className="rules-point-card">7&ndash;10, J, Q</span>
                <span className="rules-point-value">Face value / 10 pts</span>
              </div>
              <div className="rules-point-item">
                <span className="rules-point-card black-king">K <span style={{color: '#2c3e50'}}>&spades;&clubs;</span></span>
                <span className="rules-point-value">10 points</span>
              </div>
              <div className="rules-point-item highlight-good">
                <span className="rules-point-card red-king">K <span style={{color: '#e74c3c'}}>&hearts;&diams;</span></span>
                <span className="rules-point-value">&minus;1 point</span>
              </div>
              <div className="rules-point-item highlight-good">
                <span className="rules-point-card joker-card">&starf; Joker</span>
                <span className="rules-point-value">0 points</span>
              </div>
            </div>
          </section>

          <section className="rules-section">
            <h3>Card Rules (7 and above)</h3>
            <div className="rules-card-rules">
              <div className="rules-rule-item">
                <span className="rules-rule-cards">7 or 8</span>
                <span className="rules-rule-desc">Peek at one of your own cards</span>
              </div>
              <div className="rules-rule-item">
                <span className="rules-rule-cards">9 or 10</span>
                <span className="rules-rule-desc">Peek at one of another player's cards</span>
              </div>
              <div className="rules-rule-item">
                <span className="rules-rule-cards">J or Q</span>
                <span className="rules-rule-desc">Blind switch &ndash; swap any player's card with another player's card (without looking)</span>
              </div>
              <div className="rules-rule-item">
                <span className="rules-rule-cards black-king-rule">K <span style={{color: '#2c3e50'}}>&spades;&clubs;</span></span>
                <span className="rules-rule-desc">Look at any 2 cards on the table, then optionally blind switch any two players' cards</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
