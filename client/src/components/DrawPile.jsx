import './DrawPile.css';

export default function DrawPile({ count }) {
  return (
    <div className="draw-pile">
      <div className="draw-pile-stack">
        <div className="draw-pile-card offset-2" />
        <div className="draw-pile-card offset-1" />
        <div className="draw-pile-card offset-0" />
      </div>
      <span className="draw-pile-count">{count} cards</span>
    </div>
  );
}
