import React from 'react';

export default function CreditsScreen({ onBack }) {
  return (
    <div className="screen" id="credScreen">
      <div className="panel">
        <h2>CREDITS</h2>
        <p style={{ textAlign: 'center' }}>Tank Arena Blitz</p>
        <p style={{ textAlign: 'center' }}>Design, code, art & sound — all in a single HTML file.</p>
        <p style={{ textAlign: 'center' }}>Canvas API · Web Audio API · Vanilla JS</p>
        <p style={{ textAlign: 'center', color: '#ffd54a' }}>Master the ricochet. Rule the arena.</p>
      </div>
      <button className="btn small" onClick={onBack}>BACK</button>
    </div>
  );
}
