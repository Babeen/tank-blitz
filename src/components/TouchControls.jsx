import React, { useRef, useEffect } from 'react';

// Drives the same window globals InputManager.getTouchState() already
// reads (see src/game/systems/Input.js) — both the single-player
// GameEngine and the multiplayer InputController poll these
// independently, so this one set of on-screen controls drives whichever
// is active without either needing to know the other exists.
export default function TouchControls() {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const activePointerId = useRef(null);

  useEffect(() => {
    const base = baseRef.current, knob = knobRef.current;
    if (!base || !knob) return;
    const radius = base.offsetWidth / 2;

    const setKnob = (dx, dy) => {
      const mag = Math.hypot(dx, dy);
      const nx = mag > 1 ? dx / mag : dx;
      const ny = mag > 1 ? dy / mag : dy;
      knob.style.transform = `translate(${nx * radius * 0.55}px, ${ny * radius * 0.55}px)`;
      window.__touchInput = { mx: nx, my: ny };
    };
    const resetKnob = () => {
      knob.style.transform = 'translate(0px, 0px)';
      window.__touchInput = { mx: 0, my: 0 };
    };

    const onMove = (e) => {
      if (activePointerId.current !== e.pointerId) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      setKnob((e.clientX - cx) / radius, (e.clientY - cy) / radius);
    };
    const onDown = (e) => {
      if (activePointerId.current != null) return; // one finger drives the stick
      activePointerId.current = e.pointerId;
      base.setPointerCapture(e.pointerId);
      onMove(e);
    };
    const onUp = (e) => {
      if (activePointerId.current !== e.pointerId) return;
      activePointerId.current = null;
      resetKnob();
    };

    base.addEventListener('pointerdown', onDown);
    base.addEventListener('pointermove', onMove);
    base.addEventListener('pointerup', onUp);
    base.addEventListener('pointercancel', onUp);
    return () => {
      base.removeEventListener('pointerdown', onDown);
      base.removeEventListener('pointermove', onMove);
      base.removeEventListener('pointerup', onUp);
      base.removeEventListener('pointercancel', onUp);
      // Don't leave a stale direction active if this unmounts mid-drag
      // (e.g. pause, death, leaving the match).
      window.__touchInput = { mx: 0, my: 0 };
      window.__touchFire = false;
    };
  }, []);

  const fireDown = (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); window.__touchFire = true; };
  const fireUp = (e) => { e.preventDefault(); window.__touchFire = false; };
  const dashTap = (e) => {
    e.preventDefault();
    // One-shot pulse rather than a held flag — Tank.dash()/the server both
    // self-gate on cooldown, so a pulse a little longer than one frame is
    // simplest and safe even if a couple of frames read it as still true.
    window.__touchDash = true;
    setTimeout(() => { window.__touchDash = false; }, 150);
  };

  return (
    <div id="touchControls" style={{ position: 'absolute', inset: 0, zIndex: 15, pointerEvents: 'none' }}>
      <div ref={baseRef} className="touch-joystick" style={{ touchAction: 'none', pointerEvents: 'auto' }}>
        <div ref={knobRef} className="touch-knob" />
      </div>
      <button
        className="touch-btn touch-btn-dash"
        style={{ touchAction: 'none', pointerEvents: 'auto' }}
        onPointerDown={dashTap}
        onContextMenu={(e) => e.preventDefault()}
      >
        DASH
      </button>
      <button
        className="touch-btn touch-btn-fire"
        style={{ touchAction: 'none', pointerEvents: 'auto' }}
        onPointerDown={fireDown}
        onPointerUp={fireUp}
        onPointerCancel={fireUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        FIRE
      </button>
    </div>
  );
}
