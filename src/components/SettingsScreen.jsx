import React from 'react';

export default function SettingsScreen({ getSetting, toggleSetting, onBack }) {
  const Toggle = ({ label, k }) => {
    const on = getSetting(k);
    return (
      <div className="row">
        <span style={{ color: '#cdd8ee', minWidth: 120, textAlign: 'left' }}>{label}</span>
        <button className={`btn small ${on ? 'green' : 'red'}`} onClick={() => toggleSetting(k)}>{on ? 'ON' : 'OFF'}</button>
      </div>
    );
  };
  return (
    <div className="screen" id="setScreen">
      <div className="panel">
        <h2>SETTINGS</h2>
        <Toggle label="Sound" k="sound" />
        <Toggle label="Screen Shake" k="shake" />
        <Toggle label="Particles" k="particles" />
      </div>
      <button className="btn small" onClick={onBack}>BACK</button>
    </div>
  );
}
