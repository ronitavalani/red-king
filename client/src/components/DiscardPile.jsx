import Card from './Card';
import './DiscardPile.css';

export default function DiscardPile({ topCard, onClick, canMatch }) {
  return (
    <div
      className={`discard-pile ${canMatch ? 'discard-pile-matchable' : ''}`}
      onClick={canMatch ? onClick : undefined}
    >
      {topCard ? (
        <Card card={topCard} faceUp={true} />
      ) : (
        <div className="discard-pile-empty">
          <span>Discard</span>
        </div>
      )}
      <span className="discard-pile-label">
        {canMatch ? 'Tap to Match' : 'Discard'}
      </span>
    </div>
  );
}
