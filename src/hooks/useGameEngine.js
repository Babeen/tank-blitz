import { useEffect, useRef, useCallback } from 'react';
import { GameEngine } from '../game/engine/GameEngine.js';

export function useGameEngine(canvasRef, minimapRef, onStateChange, onHUDUpdate, onToast, onComboPulse, onBossChange) {
  const engineRef = useRef(null);

  const init = useCallback(() => {
    if (!canvasRef.current || !minimapRef.current) return;
    const engine = new GameEngine(canvasRef.current, minimapRef.current, {
      onStateChange, onHUDUpdate, onToast, onComboPulse, onBossChange
    });
    engine.init();
    engineRef.current = engine;
    return engine;
  }, [canvasRef, minimapRef, onStateChange, onHUDUpdate, onToast, onComboPulse, onBossChange]);

  useEffect(() => {
    const engine = init();
    const onKey = (e) => { if (e.code === 'Escape' || e.code === 'KeyP') engine.pause(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [init]);

  return engineRef;
}
