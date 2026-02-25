// client/src/components/SuggestionPanel.jsx
// Shown above the drawn-card area when it's the custom-bot player's turn.
// Displays what the bot would do and lets the player accept or override.

export default function SuggestionPanel({ suggestion, onAccept, onOverride }) {
  if (!suggestion) return null;

  return (
    <div className="suggestion-panel">
      <span className="suggestion-header">BOT SUGGESTION</span>
      <span className="suggestion-label">{suggestion.label}</span>
      <span className="suggestion-reasoning">{suggestion.reasoning}</span>
      <div className="suggestion-buttons">
        {suggestion.confirmable && (
          <button className="btn btn-primary btn-sm" onClick={onAccept}>
            Accept
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={onOverride}>
          Override
        </button>
      </div>
    </div>
  );
}
