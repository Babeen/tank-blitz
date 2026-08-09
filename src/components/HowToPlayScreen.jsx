import React from 'react';

export default function HowToPlayScreen({ onTutorial, onBack }) {
  return (
    <div className="screen" id="howScreen">
      <div className="panel">
        <h2>HOW TO PLAY</h2>
        <p><b>Player 1:</b> WASD move · Mouse aim · Left Click shoot · Space dash</p>
        <p><b>Player 2:</b> Arrows move · Numpad0 shoot · Right Ctrl dash (auto-aim)</p>
        <p>Touch: on-screen joystick + fire/dash buttons (auto-aim).</p>
        <ul>
          <li>Bullets <b>ricochet off steel</b> — bank shots around corners!</li>
          <li>Brick & crates break; barrels explode; bushes hide you; oil is slippery.</li>
          <li>Chain kills for a <b>combo multiplier</b>. Grab power-ups. Snipers show a laser sight before firing.</li>
          <li>Battle: clear 10 levels. Survival: last as long as you can.</li>
        </ul>
      </div>
      <div className="row">
        <button className="btn primary" onClick={onTutorial}>INTERACTIVE TUTORIAL</button>
        <button className="btn small" onClick={onBack}>BACK</button>
      </div>
    </div>
  );
}
