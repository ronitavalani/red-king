import './DrawPile.css';

export default function DrawPile({ count, onClick, canDraw }) {
  return (
    <div
      className={`draw-pile ${canDraw ? 'draw-pile-active' : ''}`}
      onClick={canDraw ? onClick : undefined}
    >
      <div className="draw-pile-stack">
        <div className="draw-pile-card offset-2" />
        <div className="draw-pile-card offset-1" />
        <div className="draw-pile-card offset-0" />
      </div>
      <span className="draw-pile-count">{count} cards</span>
      {canDraw && <span className="draw-pile-hint">Tap to draw</span>}
    </div>
  );
}
