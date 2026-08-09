export const Utils = {
  clamp: (v, a, b) => v < a ? a : v > b ? b : v,
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a, b) => a + Math.random() * (b - a),
  randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
  angLerp: (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  },
  choose: a => a[Math.floor(Math.random() * a.length)],
  norm: a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; },
  easeOut: t => 1 - Math.pow(1 - t, 3)
};
