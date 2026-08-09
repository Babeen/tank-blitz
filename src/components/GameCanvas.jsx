import React from 'react';

export default function GameCanvas({ canvasRef, minimapRef }) {
  return (
    <>
      <canvas id="game" ref={canvasRef} />
      <canvas id="minimap" ref={minimapRef} width="130" height="96" />
    </>
  );
}
