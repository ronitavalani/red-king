import './Card.css';

const SUIT_SYMBOLS = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
  joker: '\u2605',
};

const SUIT_COLORS = {
  hearts: '#e74c3c',
  diamonds: '#e74c3c',
  clubs: '#2c3e50',
  spades: '#2c3e50',
  joker: '#d4a84b',
};

export default function Card({ card, faceUp, size = 'normal', onClick, selectable, selected, glowing, highlightType }) {
  const classes = [
    'card',
    faceUp && card ? 'face-up' : 'face-down',
    size,
    selectable ? 'selectable' : '',
    selected ? 'selected' : '',
    glowing ? 'glowing' : '',
    highlightType ? `highlight-${highlightType}` : '',
  ].filter(Boolean).join(' ');

  if (!faceUp || !card) {
    return <div className={classes} onClick={onClick} />;
  }

  const color = SUIT_COLORS[card.suit];
  const symbol = SUIT_SYMBOLS[card.suit];
  const isJoker = card.suit === 'joker';

  return (
    <div className={classes} style={{ '--card-color': color }} onClick={onClick}>
      {isJoker ? (
        <>
          <span className="card-rank-top">
            {symbol}
          </span>
          <span className="card-center-joker">JOKER</span>
          <span className="card-rank-bottom">
            {symbol}
          </span>
        </>
      ) : (
        <>
          <span className="card-rank-top">
            {card.rank}
            <br />
            {symbol}
          </span>
          <span className="card-suit-center">{symbol}</span>
          <span className="card-rank-bottom">
            {card.rank}
            <br />
            {symbol}
          </span>
        </>
      )}
    </div>
  );
}
