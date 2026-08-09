import React from 'react';

// Purely visual — the server remains authoritative for the actual countdown
// value and for when the match transitions to ACTIVE (Part 5). The `key`
// prop forces React to remount the number on every tick, which retriggers
// the CSS scale/fade animation for each beat.
export default function CountdownOverlay({ countdown }) {
  if (countdown == null) return null;
  const label = countdown > 0 ? String(countdown) : 'GO!';

  return (
    <div className="countdown-overlay">
      <div key={label} className="countdown-number" style={{ color: countdown > 0 ? '#ffd54a' : '#6bd35a' }}>
        {label}
      </div>
    </div>
  );
}
