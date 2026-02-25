// client/src/components/Scratchpad.jsx
// Visual panel shown in the sidebar for custom-bot players.
// Displays known own cards, known opponent cards, and discard history.

const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', joker: '★' };
const RED_SUITS = new Set(['hearts', 'diamonds']);

function cardText(card) {
  if (!card) return null;
  if (card.suit === 'joker') return '★Jo';
  return `${card.rank}${SUIT_SYMBOLS[card.suit] || ''}`;
}

function ScratchpadSlot({ card, isEmpty }) {
  if (isEmpty) {
    return <div className="scratchpad-slot empty" />;
  }
  if (!card) {
    return <div className="scratchpad-slot unknown">?</div>;
  }
  const isRed = RED_SUITS.has(card.suit);
  return (
    <div className={`scratchpad-slot known ${isRed ? 'red' : 'black'}`}>
      {cardText(card)}
    </div>
  );
}

function ScratchpadSlotRow({ cards, knownCards, handLayout, reverseRows = false }) {
  // Render 4 slots in 2 rows of 2
  // For opponents, reverseRows=true flips both rows and columns for POV style
  const indices = reverseRows ? [3, 2, 1, 0] : [0, 1, 2, 3];

  return (
    <div className="scratchpad-slot-grid">
      {indices.map(i => {
        // handLayout: true = has card, false = slot empty (matched away)
        // If handLayout is provided and slot is false → empty
        const isEmpty = handLayout ? !handLayout[i] : false;
        // If myCards array provided, check for null
        const myCard = cards ? cards[i] : undefined;
        const slotEmpty = isEmpty || myCard === null;
        const known = slotEmpty ? null : knownCards[i];
        return <ScratchpadSlot key={i} card={known} isEmpty={slotEmpty} />;
      })}
    </div>
  );
}

export default function Scratchpad({
  knownOwnCards,
  knownOpponentCards,
  discardHistory,
  myCards,
  opponents,
  handLayouts,
}) {
  const discardText = discardHistory
    .slice(0, 20)
    .map(c => cardText(c))
    .filter(Boolean)
    .join(' ');

  return (
    <div className="scratchpad">
      <div className="scratchpad-title">SCRATCHPAD</div>

      {opponents && opponents.length > 0 && (
        <div className="scratchpad-section">
          <div className="scratchpad-section-label">OPPONENTS</div>
          <div className="scratchpad-opponents-row">
            {opponents.map(opp => (
              <div key={opp.id} className="scratchpad-opponent">
                <div className="scratchpad-opponent-name">{opp.name}</div>
                <ScratchpadSlotRow
                  cards={null}
                  knownCards={knownOpponentCards[opp.id] || {}}
                  handLayout={handLayouts?.[opp.id] || null}
                  reverseRows={true}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="scratchpad-section">
        <div className="scratchpad-section-label">DISCARDS</div>
        <div className="scratchpad-discard-text">
          {discardText || '—'}
        </div>
      </div>

      <div className="scratchpad-section">
        <div className="scratchpad-section-label">MY CARDS</div>
        <ScratchpadSlotRow
          cards={myCards}
          knownCards={knownOwnCards}
          handLayout={null}
        />
      </div>
    </div>
  );
}
