import React, { useEffect, useState } from 'react';

// Every screen already declares a fade/scale transition in index.css
// (`.screen { transition: opacity .35s, transform .35s }` and
// `.screen.hidden { opacity:0; transform:scale(.98) }`), but nothing ever
// toggled the `hidden` class — screens are conditionally rendered in
// App.jsx (`{view === 'x' && <Screen/>}`), so each one just mounted at
// full opacity instantly. This is a drop-in replacement for a screen
// component's outer `<div className="screen" id="...">` that mounts
// pre-hidden and removes the class one frame later, so the transition
// that was already written actually plays.
export default function Screen({ id, children }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    // Two rAFs, not one — some browsers coalesce a style set in the same
    // frame as mount with the mount itself, so the "hidden" starting state
    // never actually paints and there's nothing for the transition to
    // animate from. Waiting a full extra frame guarantees it paints first.
    let raf2;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, []);

  return (
    <div id={id} className={entered ? 'screen' : 'screen hidden'}>
      {children}
    </div>
  );
}
