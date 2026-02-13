import Card from './Card';
import './CardGrid.css';

export default function CardGrid({ cards, isPeeking, onCardClick, selectableIndices, selectedIndex, size, highlightedIndices }) {
  if (!cards || cards.length < 4) return null;

  const cardSize = size || 'normal';

  return (
    <div className="card-grid">
      <div className="card-grid-row">
        {[0, 1].map((i) => (
          <Card
            key={i}
            card={cards[i]}
            faceUp={false}
            size={cardSize}
            onClick={onCardClick ? () => onCardClick(i) : undefined}
            selectable={selectableIndices ? selectableIndices.includes(i) : false}
            selected={selectedIndex === i}
            highlightType={highlightedIndices && highlightedIndices[i]}
          />
        ))}
      </div>
      <div className="card-grid-row">
        {[2, 3].map((i) => (
          <Card
            key={i}
            card={cards[i]}
            faceUp={isPeeking}
            size={cardSize}
            onClick={onCardClick ? () => onCardClick(i) : undefined}
            selectable={selectableIndices ? selectableIndices.includes(i) : false}
            selected={selectedIndex === i}
            highlightType={highlightedIndices && highlightedIndices[i]}
          />
        ))}
      </div>
    </div>
  );
}
