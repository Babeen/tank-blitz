import React from 'react';
import Screen from './Screen';

export default function SettingsScreen({ getSetting, toggleSetting, onBack }) {
  // Each toggle used to be its own independently-centered flex row, so a
  // longer label ("Screen Shake") widened that row's content and shifted
  // its button sideways relative to the others — the buttons zig-zagged
  // instead of lining up. A single CSS grid shares column widths across
  // all three rows, so every button lands in the same column regardless
  // of label length.
  const Toggle = ({ label, k }) => {
    const on = getSetting(k);
    return (
      <>
        <span style={{ color: '#cdd8ee', textAlign: 'left' }}>{label}</span>
        <button className={`btn small ${on ? 'green' : 'red'}`} onClick={() => toggleSetting(k)}>{on ? 'ON' : 'OFF'}</button>
      </>
    );
  };
  return (
    <Screen id="setScreen">
      <div className="panel">
        <h2>SETTINGS</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 18, rowGap: 12, justifyContent: 'center', alignItems: 'center' }}>
          <Toggle label="Sound" k="sound" />
          <Toggle label="Screen Shake" k="shake" />
          <Toggle label="Particles" k="particles" />
        </div>
      </div>
      <button className="btn small" onClick={onBack}>BACK</button>
    </Screen>
  );
}
