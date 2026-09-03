import React from 'react';
import TouchControls from './TouchControls';
import { isTouchDevice } from '../game/utils/touchDevice.js';

export default function GameCanvas({ canvasRef, minimapRef, showTouch }) {
  return (
    <>
      <canvas id="game" ref={canvasRef} />
      <canvas id="minimap" ref={minimapRef} width="130" height="96" />
      {showTouch && isTouchDevice() && <TouchControls />}
    </>
  );
}
