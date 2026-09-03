import React, { useState } from 'react';
import { DIFF } from '../game/constants/index.js';
import Screen from './Screen';

export default function DifficultyScreen({ onStart, onBack }) {
  const [sel, setSel] = useState('easy');
  return (
    <Screen id="diffScreen">
      <div className="title" style={{ fontSize: 'clamp(28px,6vw,54px)' }}>SELECT DIFFICULTY</div>
      <div className="row diff-row" style={{ margin: '20px 0 6px' }}>
        <button className={`btn green ${sel === 'easy' ? 'selected' : ''}`} onClick={() => setSel('easy')}>EASY</button>
        <button className={`btn primary ${sel === 'normal' ? 'selected' : ''}`} onClick={() => setSel('normal')}>MEDIUM</button>
        <button className={`btn red ${sel === 'hard' ? 'selected' : ''}`} onClick={() => setSel('hard')}>HARD</button>
      </div>
      <div className="diff-desc">{DIFF[sel].label}</div>
      <button className="btn" onClick={() => onStart(sel)} style={{ marginTop: 6 }}>START GAME</button>
      <button className="btn small" onClick={onBack}>BACK</button>
    </Screen>
  );
}
