import React from 'react';

export default function PauseScreen({ onResume, onRestart, onQuit }) {
  return (
    <div className="screen" id="pauseScreen">
      <div className="title" style={{ fontSize: 'clamp(30px,7vw,60px)' }}>PAUSED</div>
      <button className="btn primary" onClick={onResume}>RESUME</button>
      <button className="btn" onClick={onRestart}>RESTART</button>
      <button className="btn red" onClick={onQuit}>QUIT TO MENU</button>
    </div>
  );
}
