import Card from './Card';
import './CardGrid.css';

export default function CardGrid({ cards, isPeeking, onCardClick, selectableIndices, selectedIndex, size, highlightedIndices }) {
  if (!cards || cards.length === 0) return null;

  const cardSize = size || 'normal';

  // Build rows of 2 cards each
  const rows = [];
  for (let r = 0; r < cards.length; r += 2) {
    const indices = [r];
    if (r + 1 < cards.length) indices.push(r + 1);
    rows.push(indices);
  }

  // Bottom row is the "peek" row (last row, same as original behavior)
  const lastRowStart = rows.length > 0 ? rows[rows.length - 1][0] : -1;

  return (
    <div className="card-grid">
      {rows.map((rowIndices, rowIdx) => (
        <div className="card-grid-row" key={rowIdx}>
          {rowIndices.map((i) =>
            cards[i] === null ? (
              <div
                key={i}
                className={`card-slot-empty ${cardSize} ${highlightedIndices && highlightedIndices[i] ? `highlight-${highlightedIndices[i]}` : ''}`}
              />
            ) : (
              <Card
                key={i}
                card={cards[i]}
                faceUp={isPeeking && i >= lastRowStart}
                size={cardSize}
                onClick={onCardClick ? () => onCardClick(i) : undefined}
                selectable={selectableIndices ? selectableIndices.includes(i) : false}
                selected={selectedIndex === i}
                highlightType={highlightedIndices && highlightedIndices[i]}
              />
            )
          )}
        </div>
      ))}
    </div>
  );
}
