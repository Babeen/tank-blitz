export class InputManager {
  constructor() {
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false };
    this.touchActive = false;
    this.touch = { mx: 0, my: 0, fire: false, dash: false };
  }

  init(canvas) {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Numpad0', 'ControlRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) this.mouse.down = true; });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  getTouchState() {
    if (window.__touchInput) { this.touch.mx = window.__touchInput.mx; this.touch.my = window.__touchInput.my; }
    this.touch.fire = !!window.__touchFire;
    this.touch.dash = !!window.__touchDash;
  }

  setTouch(v) { this.touchActive = v; }
  isTouch() { return this.touchActive; }
  key(c) { return !!this.keys[c]; }

  /**
   * Normalized movement-intent snapshot for online multiplayer, read-only —
   * it never touches tank state directly. Reuses the same WASD/arrow keys
   * already bound above, so it doesn't add or change any keyboard bindings.
   */
  getMovementInput() {
    return {
      up: this.key('KeyW') || this.key('ArrowUp'),
      down: this.key('KeyS') || this.key('ArrowDown'),
      left: this.key('KeyA') || this.key('ArrowLeft'),
      right: this.key('KeyD') || this.key('ArrowRight'),
    };
  }
}
