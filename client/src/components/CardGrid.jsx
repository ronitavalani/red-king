import Card from './Card';
import './CardGrid.css';

export default function CardGrid({ cards, isPeeking, onCardClick, selectableIndices, selectedIndex, size, highlightedIndices }) {
  if (!cards || cards.length === 0) return null;

  const cardSize = size || 'normal';
  const BASE_COUNT = 4;

  // Split into base cards (2x2 grid) and overflow (horizontal row)
  const baseCards = cards.slice(0, BASE_COUNT);
  const hasOverflow = cards.length > BASE_COUNT;

  // Build rows of 2 for base cards
  const rows = [];
  for (let r = 0; r < baseCards.length; r += 2) {
    const indices = [r];
    if (r + 1 < baseCards.length) indices.push(r + 1);
    rows.push(indices);
  }

  // Bottom row of base grid is the "peek" row
  const lastRowStart = rows.length > 0 ? rows[rows.length - 1][0] : -1;

  function renderCard(i) {
    if (cards[i] === null) {
      return (
        <div
          key={i}
          className={`card-slot-empty ${cardSize} ${highlightedIndices && highlightedIndices[i] ? `highlight-${highlightedIndices[i]}` : ''}`}
        />
      );
    }
    return (
      <Card
        key={i}
        card={cards[i]}
        faceUp={isPeeking && i >= lastRowStart && i < BASE_COUNT}
        size={cardSize}
        onClick={onCardClick ? () => onCardClick(i) : undefined}
        selectable={selectableIndices ? selectableIndices.includes(i) : false}
        selected={selectedIndex === i}
        highlightType={highlightedIndices && highlightedIndices[i]}
      />
    );
  }

  return (
    <div className="card-grid">
      {rows.map((rowIndices, rowIdx) => (
        <div className="card-grid-row" key={rowIdx}>
          {rowIndices.map(renderCard)}
        </div>
      ))}
      {hasOverflow && (
        <div className="card-grid-overflow">
          {cards.slice(BASE_COUNT).map((_, idx) => renderCard(BASE_COUNT + idx))}
        </div>
      )}
    </div>
  );
}
