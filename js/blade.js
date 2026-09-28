// Pointer input + 2D overlay: laser-blade trail with lightning filaments and
// hand-drawn ("boiling line") angle sketches for every cut.
import { save } from './storage.js';

const BLADE_COLORS = {
  cyan: { glow: '#39e8ff', core: '#e9fdff', fil: '#8ff4ff' },
  magenta: { glow: '#ff4fd8', core: '#ffe9fb', fil: '#ff9bea' },
  gold: { glow: '#ffc933', core: '#fff8e0', fil: '#ffe38a' },
  green: { glow: '#6dff6a', core: '#efffe9', fil: '#b4ff9e' },
};

export class Blade {
  constructor(canvas, target) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.target = target;
    this.down = false;
    this.points = [];         // recent trail points {x, y, t}
    this.pending = [];        // blade segments not yet processed by the game
    this.sketches = [];       // hand-drawn angle annotations
    this.guides = [];         // Winkel-Laser upgrade: 90° guide marks {x, y, ang}
    this.zap = null;          // full-screen 400V lightning after a crash
    this.strokeId = 0;
    this.lastMoveT = 0;
    this.enabled = true;
    this.onStrokeStart = null;
    this.onStrokeEnd = null;
    this._bind();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  get colors() { return BLADE_COLORS[save.options.blade] || BLADE_COLORS.cyan; }
  get trailLife() { return 0.13 + 0.03 * save.upgrades.blade; }

  _bind() {
    const t = this.target;
    const pos = (e) => ({ x: e.clientX, y: e.clientY, t: performance.now() / 1000 });
    t.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      t.setPointerCapture?.(e.pointerId);
      this.down = true;
      this.strokeId++;
      this.points = [pos(e)];
      this.onStrokeStart?.();
    });
    t.addEventListener('pointermove', (e) => {
      if (!this.down || !this.enabled) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) this._add(pos(ev));
    });
    const end = () => {
      if (!this.down) return;
      this.down = false;
      this.onStrokeEnd?.();
    };
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', end);
    t.addEventListener('lostpointercapture', end);
  }

  _add(p) {
    const last = this.points[this.points.length - 1];
    if (last) {
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < 2) return;
      const dt = Math.max(1e-3, p.t - last.t);
      const speed = d / dt;
      // slow drags don't cut: a real swipe is needed
      this.pending.push({ p0: { x: last.x, y: last.y }, p1: { x: p.x, y: p.y }, speed, stroke: this.strokeId });
    }
    this.points.push(p);
    this.lastMoveT = p.t;
  }

  takeSegments() {
    const s = this.pending;
    this.pending = [];
    return s;
  }

  cancel() {
    this.down = false;
    this.points = [];
    this.pending = [];
  }

  /** add a hand-drawn protractor sketch at a cut */
  sketch(hit, grade) {
    if (!save.options.protractor) return;
    this.sketches.push({
      x: hit.x, y: hit.y,
      ac: Math.atan2(hit.cable.y, hit.cable.x),
      ab: Math.atan2(hit.blade.y, hit.blade.x),
      deg: Math.round(hit.angle),
      grade,
      t0: performance.now() / 1000,
    });
    if (this.sketches.length > 8) this.sketches.shift();
  }

  // ------------------------------------------------------------------
  draw() {
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this._drawSketches(ctx, now);
    this._drawGuides(ctx, now);
    this._drawZap(ctx, now);

    const life = this.trailLife;
    this.points = this.points.filter((p) => now - p.t < life);
    const pts = this.points;
    if (pts.length < 2) return;
    const col = this.colors;
    const maxW = 9 + save.upgrades.blade * 2;

    // tapered ribbon polygon
    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      let dx = q.x - o.x;
      let dy = q.y - o.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const age = (now - p.t) / life;
      const w = maxW * Math.pow(i / (pts.length - 1), 0.8) * (1 - age * 0.5);
      left.push([p.x - dy * w, p.y + dx * w]);
      right.push([p.x + dy * w, p.y - dx * w]);
    }
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const tipX = tip.x + Math.cos(ang) * maxW * 1.6;
    const tipY = tip.y + Math.sin(ang) * maxW * 1.6;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const p of left) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(tipX, tipY);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 28;
    ctx.fillStyle = col.glow;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 1;
    ctx.fillStyle = col.core;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const w = (maxW * 0.35 * i) / (pts.length - 1);
      const q = right[i];
      const k = w / maxW;
      const x = p.x + (q[0] - p.x) * k;
      const y = p.y + (q[1] - p.y) * k;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(tipX, tipY);
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const w = (maxW * 0.35 * i) / (pts.length - 1);
      const q = left[i];
      const k = w / maxW;
      ctx.lineTo(p.x + (q[0] - p.x) * k, p.y + (q[1] - p.y) * k);
    }
    ctx.closePath();
    ctx.fill();

    // lightning filaments (Laser-Klinge look)
    ctx.shadowBlur = 8;
    ctx.strokeStyle = col.fil;
    ctx.lineWidth = 1.3;
    for (let f = 0; f < 2; f++) {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const j = maxW * 1.6 * (i / pts.length);
        const x = p.x + (Math.random() - 0.5) * j;
        const y = p.y + (Math.random() - 0.5) * j;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** crackling yellow/blue lightning bolts from (x, y) across the screen */
  lightning(x, y, dur = 1.5) {
    this.zap = { x, y, t0: performance.now() / 1000, dur };
  }

  _drawZap(ctx, now) {
    const z = this.zap;
    if (!z) return;
    const age = (now - z.t0) / z.dur;
    if (age > 1) { this.zap = null; return; }
    const W = window.innerWidth;
    const H = window.innerHeight;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    const n = 7;
    for (let b = 0; b < n; b++) {
      if (Math.random() < age * 0.8) continue; // bolts thin out over time
      const ang = Math.random() * Math.PI * 2;
      const len = Math.hypot(W, H) * (0.3 + Math.random() * 0.5);
      const pts = [[z.x, z.y]];
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const jit = 38 * Math.sin(t * Math.PI);
        pts.push([z.x + Math.cos(ang) * len * t + (Math.random() - 0.5) * jit, z.y + Math.sin(ang) * len * t + (Math.random() - 0.5) * jit]);
      }
      const col = Math.random() < 0.5 ? '#ffe066' : '#66ccff';
      for (const [w, c, blur, a] of [[7, col, 26, 0.5], [2.5, '#ffffff', 10, 1]]) {
        ctx.globalAlpha = a * (1 - age);
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.shadowColor = col;
        ctx.shadowBlur = blur;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawGuides(ctx, now) {
    if (!this.guides.length) return;
    const rnd = mulberry(Math.floor(now * 12));
    ctx.save();
    ctx.strokeStyle = '#ffc933';
    ctx.fillStyle = '#ffc933';
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#ff9d00';
    ctx.shadowBlur = 6;
    ctx.setLineDash([6, 5]);
    ctx.font = '12px "Share Tech Mono", monospace';
    for (const g of this.guides) {
      const dx = Math.cos(g.ang) * 46;
      const dy = Math.sin(g.ang) * 46;
      roughLine(ctx, g.x - dx, g.y - dy, g.x + dx, g.y + dy, rnd, 1);
      ctx.fillText('90°', g.x + dx + 4, g.y + dy + 4);
    }
    ctx.restore();
  }

  _drawSketches(ctx, now) {
    const DUR = 1.1;
    this.sketches = this.sketches.filter((s) => now - s.t0 < DUR);
    // "boiling" hand-drawn lines: re-seed jitter at 12 fps
    const boil = Math.floor(now * 12);
    for (const s of this.sketches) {
      const age = (now - s.t0) / DUR;
      const a = Math.min(1, (1 - age) * 2.2);
      const rnd = mulberry(boil * 131 + ((s.x * 7) | 0));
      const col = s.grade === 'perfect' ? '#ffe27a' : s.grade === 'clean' ? '#8dff62' : s.grade === 'ok' ? '#5ff2ff' : '#ff8fa0';
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.shadowColor = col;
      ctx.shadowBlur = 6;
      const R = 34 + age * 10;
      // cable axis + blade line
      roughLine(ctx, s.x - Math.cos(s.ac) * R * 1.5, s.y - Math.sin(s.ac) * R * 1.5, s.x + Math.cos(s.ac) * R * 1.5, s.y + Math.sin(s.ac) * R * 1.5, rnd, 2);
      ctx.setLineDash([5, 5]);
      roughLine(ctx, s.x - Math.cos(s.ab) * R * 1.3, s.y - Math.sin(s.ab) * R * 1.3, s.x + Math.cos(s.ab) * R * 1.3, s.y + Math.sin(s.ab) * R * 1.3, rnd, 2);
      ctx.setLineDash([]);
      // angle arc between them
      let a0 = s.ac;
      let a1 = s.ab;
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > Math.PI / 2) { a1 += Math.PI; d = a1 - a0; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; }
      ctx.beginPath();
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const t = a0 + (d * i) / steps;
        const rr = R * 0.7 + (rnd() - 0.5) * 2.2;
        const x = s.x + Math.cos(t) * rr;
        const y = s.y + Math.sin(t) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // right-angle box for perfect cuts
      if (s.grade === 'perfect') {
        const k = R * 0.3;
        const ux = Math.cos(a0) * k, uy = Math.sin(a0) * k;
        const vx = Math.cos(a0 + Math.sign(d) * Math.PI / 2) * k, vy = Math.sin(a0 + Math.sign(d) * Math.PI / 2) * k;
        roughLine(ctx, s.x + ux, s.y + uy, s.x + ux + vx, s.y + uy + vy, rnd, 1);
        roughLine(ctx, s.x + ux + vx, s.y + uy + vy, s.x + vx, s.y + vy, rnd, 1);
      }
      ctx.font = '600 15px "Share Tech Mono", monospace';
      const tx = s.x + Math.cos(a0 + d / 2) * (R * 0.7 + 18) - 12;
      const ty = s.y + Math.sin(a0 + d / 2) * (R * 0.7 + 18) + 5;
      ctx.fillText(`${s.deg}°`, tx + (rnd() - 0.5), ty + (rnd() - 0.5));
      ctx.restore();
    }
  }
}

function roughLine(ctx, x1, y1, x2, y2, rnd, passes = 2) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const j = Math.min(3, len * 0.02) + 0.6;
  for (let k = 0; k < passes; k++) {
    const mx = (x1 + x2) / 2 + (rnd() - 0.5) * j * 2;
    const my = (y1 + y2) / 2 + (rnd() - 0.5) * j * 2;
    ctx.beginPath();
    ctx.moveTo(x1 + (rnd() - 0.5) * j, y1 + (rnd() - 0.5) * j);
    ctx.quadraticCurveTo(mx, my, x2 + (rnd() - 0.5) * j, y2 + (rnd() - 0.5) * j);
    ctx.stroke();
  }
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
