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
   * On touch devices, thresholds the analog joystick (touch.mx/my, each
   * roughly -1..1) into the same up/down/left/right shape — multiplayer's
   * movement model is digital either way, so this is the only conversion
   * touch input needs on this side.
   */
  getMovementInput() {
    let up = this.key('KeyW') || this.key('ArrowUp');
    let down = this.key('KeyS') || this.key('ArrowDown');
    let left = this.key('KeyA') || this.key('ArrowLeft');
    let right = this.key('KeyD') || this.key('ArrowRight');
    if (this.isTouch()) {
      const dz = 0.25; // deadzone — ignore small accidental drift near center
      if (this.touch.my < -dz) up = true;
      if (this.touch.my > dz) down = true;
      if (this.touch.mx < -dz) left = true;
      if (this.touch.mx > dz) right = true;
    }
    return { up, down, left, right };
  }
}
