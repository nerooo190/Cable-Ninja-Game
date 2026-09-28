// Core arcade loop: spawning waves, slicing, angle scoring, hazards, modes.
import * as THREE from 'three';
import { Cable, Prop } from './cables.js';
import { world, toScreen, toWorld } from './world.js';
import { fx } from './effects.js';
import { audio } from './audio.js';
import { save, persist } from './storage.js';
import { ui } from './ui.js';
import { t } from './i18n.js';

export const MODES = {
  classic: { lives: 3, time: 0, speed: 1.0, hazard: [0.07, 0.22], mult: 1, crash: true },
  rush: { lives: 0, time: 60, speed: 1.12, hazard: [0.1, 0.2], mult: 1, crash: false },
  nightmare: { lives: 3, time: 0, speed: 1.28, hazard: [0.26, 0.38], mult: 2, crash: true },
};

const GRADES = {
  perfect: { mult: 3 },
  clean: { mult: 2 },
  ok: { mult: 1 },
  bad: { mult: 0.5 },
};

const MIN_SPEED = 320; // px/s — below that the blade doesn't cut
const GRAVITY = 12.5;

const project = (v, out) => toScreen(v, out);
const rand = (a, b) => a + Math.random() * (b - a);

export class Game {
  constructor(blade, hooks) {
    this.blade = blade;
    this.hooks = hooks;
    this.objects = [];
    this.debris = [];
    this.running = false;
    this.paused = false;
  }

  // ------------------------------------------------------------------
  start(modeKey) {
    this.clear();
    this.modeKey = modeKey;
    this.mode = MODES[modeKey];
    this.running = true;
    this.paused = false;
    this.state = 'play';
    this.score = 0;
    this.maxLives = this.mode.lives ? this.mode.lives + save.upgrades.psu : 0;
    this.lives = this.maxLives;
    this.timeLeft = this.mode.time;
    this.elapsed = 0;
    this.spawnT = 0.6;
    this.queue = [];
    this.boostT = 0;
    this.combo = { stroke: -1, count: 0, last: 0, x: 0, y: 0 };
    this.stats = { cuts: 0, perfect: 0, angleSum: 0, maxCombo: 0, packets: 0 };
    this.lastWhoosh = 0;
    this.lastTick = 99;
    this.firstGame = save.stats.games === 0;

    ui.setHud(true, modeKey);
    ui.setScore(0);
    ui.setLives(this.lives, this.maxLives);
    ui.setTimer(this.timeLeft);
    ui.setBoost(0);
    ui.setCombo(0);
    audio.setMode('game');

    this.blade.onStrokeEnd = () => this._finishCombo();
    const hint = this.firstGame
      ? [t('hint.first'), t('hint.first.sub')]
      : [t('hint.start'), t(modeKey === 'rush' ? 'hint.rush' : 'hint.avoid')];
    ui.bigPopup(world.width / 2, world.height * 0.42, hint[0], hint[1], 'combo');
    if (this.firstGame) setTimeout(() => this.running && ui.bigPopup(world.width / 2, world.height * 0.42, t('hint.hazard'), t('hint.hazard.sub'), 'bad'), 1700);
  }

  clear() {
    for (const o of this.objects) o.dispose();
    for (const o of this.debris) o.dispose();
    this.objects = [];
    this.debris = [];
    this.running = false;
    this.state = 'idle';
    fx.clear();
    this.blade.guides = [];
  }

  get difficulty() {
    return Math.min(1, this.elapsed / 110 + this.score / 30000);
  }

  get timeScale() {
    return this.mode.speed * (1 - 0.08 * save.upgrades.cooling);
  }

  // ------------------------------------------------------------------
  update(dtReal) {
    if (this.paused || !this.state || this.state === 'idle') return;
    let dt = dtReal;

    if (this.state === 'crash') {
      this.crashT += dtReal;
      dt = dtReal * 0.12;
      if (this.crashT > 1.6) this._end('crash');
    }

    // mode speed / cooling upgrade scale the simulation clock, not the arcs
    const sdt = dt * this.timeScale;
    const g = GRAVITY * world.scale;

    if (this.state === 'play') {
      this.elapsed += dt;
      if (this.mode.time) {
        this.timeLeft -= dt;
        ui.setTimer(this.timeLeft);
        const sec = Math.ceil(this.timeLeft);
        if (sec <= 5 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; audio.tick(); }
        if (this.timeLeft <= 0) { this._end('timeup'); return; }
      }
      if (this.boostT > 0) {
        this.boostT -= dt;
        ui.setBoost(this.boostT);
      }
      this._spawner(dt);
    }

    // physics
    for (const o of this.objects) o.update(sdt, g);
    for (const o of this.debris) o.update(sdt, g * 1.1);

    // slicing
    if (this.state === 'play') this._slice();

    // cleanup + misses
    const floor = -world.halfH - 3.5;
    this.objects = this.objects.filter((o) => {
      if (o.alive && !(o.group.position.y < floor && o.vel.y < 0)) return true;
      if (o.alive && o.sliceable && !o.hazard && !o.bonus && this.state === 'play') this._miss(o);
      o.dispose();
      return false;
    });
    this.debris = this.debris.filter((o) => {
      if (o.group.position.y > floor - 4) return true;
      o.dispose();
      return false;
    });

    // Winkel-Laser upgrade: 90° guide marks
    if (save.upgrades.guide && this.state === 'play') {
      this.blade.guides = this.objects
        .filter((o) => o.kind === 'cable' && !o.hazard)
        .map((o) => {
          const S = o.screen;
          const m = S.length >> 1;
          return { x: S[m].x, y: S[m].y, ang: Math.atan2(S[m + 1].y - S[m - 1].y, S[m + 1].x - S[m - 1].x) + Math.PI / 2 };
        });
    } else this.blade.guides = [];
  }

  // ------------------------------------------------------------------
  _spawner(dt) {
    // delayed launches of the current wave
    for (const q of this.queue) q.t -= dt;
    const ready = this.queue.filter((q) => q.t <= 0);
    this.queue = this.queue.filter((q) => q.t > 0);
    ready.forEach((q) => this._launch(q.kind));

    this.spawnT -= dt;
    if (this.spawnT > 0 || this.queue.length) return;
    const d = this.difficulty;
    const rush = this.modeKey === 'rush';
    this.spawnT = (rush ? 1.0 : 1.35) - d * 0.6 + Math.random() * 0.6;
    const n = Math.min(7, 1 + Math.floor(Math.random() * (2.4 + d * 3.6) + (rush ? 1 : 0)));
    const salvo = Math.random() < 0.25;
    let hazards = 0;
    for (let i = 0; i < n; i++) {
      const kind = this._pickKind(d, hazards);
      if (kind === 'hv' || kind === 'firewall') hazards++;
      this.queue.push({ kind, t: salvo ? i * 0.05 : i * rand(0.15, 0.4) });
    }
  }

  _pickKind(d, hazardsInWave) {
    const [h0, h1] = this.mode.hazard;
    const ph = this.elapsed < 4 ? 0 : h0 + (h1 - h0) * d;
    if (Math.random() < ph && hazardsInWave < 1 + Math.floor(d * 2)) return Math.random() < 0.58 ? 'hv' : 'firewall';
    if (this.boostT <= 0 && Math.random() < 0.035) return 'bundle';
    if (Math.random() < 0.14) return 'packet';
    const r = Math.random();
    return r < 0.34 ? 'lan' : r < 0.6 ? 'fiber' : r < 0.84 ? 'terminal' : 'coax';
  }

  _launch(kind) {
    const o = kind === 'packet' || kind === 'firewall' ? new Prop(kind) : new Cable(kind);
    const hw = world.halfW;
    const hh = world.halfH;
    const x0 = rand(-hw * 0.78, hw * 0.78);
    const y0 = -hh - 2.6;
    const apex = rand(-hh * 0.05, hh * 0.72);
    const G = GRAVITY * world.scale;
    const vy = Math.sqrt(2 * G * (apex - y0));
    const tA = vy / G;
    const xT = rand(-hw * 0.45, hw * 0.45);
    o.group.position.set(x0, y0, rand(-0.6, 0.6));
    o.vel.set((xT - x0) / (tA * 1.5), vy, 0);
    o.group.rotation.set(rand(-0.5, 0.5), rand(-0.4, 0.4), rand(0, Math.PI * 2));
    o.spin.set(rand(-0.6, 0.6), rand(-0.5, 0.5), rand(0.6, 2.4) * (Math.random() < 0.5 ? -1 : 1));
    if (o.kind === 'firewall') o.spin.set(0, 0, rand(-1, 1));
    world.scene.add(o.group);
    this.objects.push(o);
    audio.launch();
    if (o.hazard && o.kind === 'cable') audio.crackle(0.7);
  }

  // ------------------------------------------------------------------
  _slice() {
    const segs = this.blade.takeSegments();
    for (const o of this.objects) if (o.alive && o.sliceable) o.project(project);
    if (!segs.length) return;
    const now = performance.now() / 1000;
    let travel = 0;
    for (const s of segs) {
      if (s.speed < MIN_SPEED) continue;
      travel += Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y);
      for (const o of this.objects) {
        if (!o.alive || !o.sliceable) continue;
        const hit = o.hitTest(s.p0, s.p1);
        if (!hit) continue;
        this._onHit(o, hit, s);
        if (this.state !== 'play') return;
      }
    }
    if (travel > 60 && now - this.lastWhoosh > 0.22) {
      this.lastWhoosh = now;
      audio.whoosh(Math.min(1, travel / 300));
    }
  }

  _bladeWorldDir(hit) {
    return new THREE.Vector3(hit.blade.x, -hit.blade.y, 0).normalize();
  }

  _onHit(o, hit, seg) {
    const wp = toWorld(hit.x, hit.y);
    if (o.hazard) {
      if (this.mode.crash) return this._crash(o, hit, wp);
      return this._rushPenalty(o, hit, wp);
    }
    o.alive = false;
    const boost = this.boostT > 0 ? 2 : 1;
    const mm = this.mode.mult;

    if (o.kind === 'packet') {
      fx.shatter(wp);
      fx.burst(wp, [0xff4fd8, 0x5ff2ff, 0xffffff], 50, 12);
      fx.spriteBurst(wp, 3.2, 0xff9bea);
      audio.shatter();
      const pts = o.points * mm * boost;
      this._addScore(pts);
      this.stats.packets++;
      ui.popup(hit.x, hit.y - 20, pts, 'ok', t('g.packet'));
      this._comboStep(seg, hit);
      return;
    }

    // ---- cable cut: angle grade
    const pw = 6 + 3 * save.upgrades.blade;
    const dev = 90 - hit.angle;
    const grade = dev <= pw ? 'perfect' : dev <= 20 ? 'clean' : dev <= 45 ? 'ok' : 'bad';
    const strip = o.endProximity(hit.t) < 0.2;
    let pts = o.type.points * GRADES[grade].mult * (strip ? 1.5 : 1) * mm * boost;
    pts = Math.round(pts / 5) * 5;

    const bladeDir = this._bladeWorldDir(hit);
    const pieces = o.cut(hit.t, bladeDir);
    for (const p of pieces) {
      world.scene.add(p.group);
      this.debris.push(p);
    }
    o.dispose();

    // effects at the cut
    const colors = o.type.spark;
    fx.burst(wp, colors, grade === 'perfect' ? 110 : 70, grade === 'perfect' ? 15 : 11, bladeDir);
    fx.spriteBurst(wp, grade === 'perfect' ? 4.2 : 3, 0xffffff, 0.4);
    fx.flash(wp, colors[0], grade === 'perfect' ? 120 : 60);
    if (o.typeKey === 'fiber' || o.typeKey === 'bundle') {
      // light spraying out of both open fibre ends
      const [pa, pb] = pieces;
      const la = pa.shape.curve.getPointAt(pa.b).sub(pa.offset);
      const lb = pb.shape.curve.getPointAt(pb.a).sub(pb.offset);
      const ta = pa.shape.curve.getTangentAt(pa.b).clone();
      const tb = pb.shape.curve.getTangentAt(pb.a).clone().negate();
      fx.fiberBeam(pa, la.addScaledVector(ta, o.type.r * 1.4), ta);
      fx.fiberBeam(pb, lb.addScaledVector(tb, o.type.r * 1.4), tb);
    }
    audio.slice(1 - dev / 90, o.typeKey);
    if (grade === 'perfect') audio.perfect();

    this._addScore(pts);
    this.stats.cuts++;
    this.stats.angleSum += hit.angle;
    if (grade === 'perfect') this.stats.perfect++;
    ui.popup(hit.x, hit.y - 26, pts, grade, `${Math.round(hit.angle)}° ${t(`g.${grade}`)}`, strip ? t('g.strip') : '');
    this.blade.sketch(hit, grade);

    if (o.bonus) {
      this.boostT = 8;
      ui.setBoost(this.boostT);
      audio.boost();
      ui.bigPopup(world.width / 2, world.height * 0.35, t('hud.boost'), t('g.boost.sub'), 'boost');
    }
    this._comboStep(seg, hit);
  }

  _addScore(pts) {
    this.score += pts;
    ui.setScore(this.score, true);
  }

  _comboStep(seg, hit) {
    const now = performance.now() / 1000;
    const c = this.combo;
    if (seg.stroke === c.stroke && now - c.last < 0.45) c.count++;
    else {
      this._finishCombo();
      c.count = 1;
      c.stroke = seg.stroke;
    }
    c.last = now;
    c.x = hit.x;
    c.y = hit.y;
    ui.setCombo(c.count);
  }

  _finishCombo() {
    const c = this.combo;
    if (!c || !this.running) return;
    if (c.count >= 3 && this.state === 'play') {
      const bonus = c.count * 50 * this.mode.mult * (this.boostT > 0 ? 2 : 1);
      this._addScore(bonus);
      ui.bigPopup(Math.min(world.width - 120, Math.max(120, c.x)), Math.max(120, c.y - 70), `COMBO x${c.count}`, t('g.combo.sub', { n: bonus }), 'combo');
      audio.combo(c.count);
    }
    this.stats.maxCombo = Math.max(this.stats.maxCombo, c.count);
    c.count = 0;
    c.stroke = -1;
    ui.setCombo(0);
  }

  _miss(o) {
    const s = o.screenCenter(project, { x: 0, y: 0 });
    audio.miss();
    if (!this.mode.lives) {
      ui.missMark(s.x, t('g.missed'));
      return;
    }
    this.lives--;
    ui.setLives(this.lives, this.maxLives, true);
    ui.missMark(s.x);
    ui.flash(s.x, world.height, true);
    if (this.lives <= 0) this._end('lost');
  }

  _crash(o, hit, wp) {
    this.state = 'crash';
    this.crashT = 0;
    this.crashCause = o.kind === 'firewall' ? 'firewall' : 'hv';
    o.sliceable = false;
    fx.crash(wp);
    this.blade.lightning(hit.x, hit.y, 1.6);
    audio.zap();
    ui.flash(hit.x, hit.y);
    ui.shake(true);
    this.blade.cancel();
    ui.bigPopup(world.width / 2, world.height * 0.45, t('go.crash'), t(this.crashCause === 'hv' ? 'g.crash.hv' : 'g.crash.fw'), 'bad');
  }

  _rushPenalty(o, hit, wp) {
    o.alive = false;
    fx.burst(wp, [0xffe066, 0x66ccff, 0xffffff], 120, 16);
    fx.spriteBurst(wp, 5, 0x88ccff, 0.5);
    fx.flash(wp, 0x9fd8ff, 200);
    this.blade.lightning(hit.x, hit.y, 0.6);
    audio.zap();
    ui.flash(hit.x, hit.y, true);
    ui.shake();
    this.timeLeft = Math.max(0, this.timeLeft - 5);
    this.score = Math.max(0, this.score - 250);
    ui.setScore(this.score, true);
    ui.bigPopup(hit.x, hit.y - 40, '−5s  −250', t(o.kind === 'firewall' ? 'g.pen.fw' : 'g.pen.hv'), 'bad');
    this._finishCombo();
  }

  // ------------------------------------------------------------------
  _end(kind) {
    if (!this.running) return;
    this._finishCombo();
    this.running = false;
    this.state = 'over';
    this.blade.cancel();
    this.blade.guides = [];
    audio.setMode('menu');
    if (kind !== 'crash') audio.gameOver();

    const prevBest = save.best[this.modeKey];
    const record = this.score > prevBest && this.score > 0;
    if (record) save.best[this.modeKey] = this.score;
    const credits = Math.floor(this.score / 20);
    save.credits += credits;
    save.stats.games++;
    save.stats.cuts += this.stats.cuts;
    save.stats.perfect += this.stats.perfect;
    persist();

    const titles = {
      // i18n keys, translated when the panel is shown
      crash: ['go.crash', this.crashCause === 'firewall' ? 'go.crash.fw' : 'go.crash.hv'],
      lost: ['go.lost', 'go.lost.reason'],
      timeup: ['go.timeup', 'go.timeup.reason'],
    };
    this.hooks.onGameOver({
      kind,
      title: titles[kind][0],
      reason: titles[kind][1],
      score: this.score,
      best: save.best[this.modeKey],
      record,
      credits,
      cuts: this.stats.cuts,
      perfect: this.stats.perfect,
      avgAngle: this.stats.cuts ? this.stats.angleSum / this.stats.cuts : 0,
      maxCombo: this.stats.maxCombo,
    });
  }
}
