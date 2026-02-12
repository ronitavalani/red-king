import Card from './Card';
import './CardGrid.css';

export default function CardGrid({ cards, isPeeking }) {
  if (!cards || cards.length < 4) return null;

  return (
    <div className="card-grid">
      <div className="card-grid-row">
        <Card card={cards[0]} faceUp={false} />
        <Card card={cards[1]} faceUp={false} />
      </div>
      <div className="card-grid-row">
        <Card card={cards[2]} faceUp={isPeeking} />
        <Card card={cards[3]} faceUp={isPeeking} />
      </div>
    </div>
  );
}
