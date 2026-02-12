import Card from './Card';
import './DiscardPile.css';

export default function DiscardPile({ topCard }) {
  return (
    <div className="discard-pile">
      {topCard ? (
        <Card card={topCard} faceUp={true} />
      ) : (
        <div className="discard-pile-empty">
          <span>Discard</span>
        </div>
      )}
      <span className="discard-pile-label">Discard</span>
    </div>
  );
}
