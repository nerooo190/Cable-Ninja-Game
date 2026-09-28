// Flying objects: textured 3D cables (with GLB connectors), hazard 400V lines,
// firewalls and corrupted data packets — plus screen-space slicing logic.
import * as THREE from 'three';
import { A, cloneModel } from './assets.js';
import { world } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpS = { x: 0, y: 0 };
const tmpQ = new THREE.Quaternion();

// --------------------------------------------------------------------------
// Cable catalogue (matches the KABELTYPEN / GEFAHREN sheet)
// --------------------------------------------------------------------------
export const TYPES = {
  lan: {
    label: 'LAN CAT6', tex: 'cable_cat6', tileD: 8.3, r: 0.27, len: [3.8, 5.4], ends: ['rj45', 'rj45'],
    boot: 0x1d6dff, glow: 0.55, tint: 0x2a8cff, cut: 'cut_lan', points: 100,
    spark: [0x9ff8ff, 0x39c8ff, 0xffffff, 0xffb347],
  },
  fiber: {
    label: 'FIBER-OPTIK', tex: 'cable_fiber', tileD: 7.4, r: 0.25, len: [3.8, 5.2], ends: ['fiber_sc', 'rj45'],
    boot: 0xffc21a, glow: 0.6, tint: 0xffb300, cut: 'cut_fiber', points: 150,
    spark: [0xfff2b0, 0xffd24a, 0xff9d00, 0xffffff],
  },
  terminal: {
    label: 'TERMINAL', tex: 'cable_terminal', tileD: 12, r: 0.23, len: [3.6, 5.0], ends: ['rj45', 'terminal_fork'],
    boot: 0x1fdc55, glow: 0.5, tint: 0x22ff55, cut: 'cut_copper', points: 120,
    spark: [0xb8ff9a, 0x3dff3a, 0xffd24a, 0xffffff],
  },
  coax: {
    label: 'KOAX', tex: 'cable_coax', tileD: 3.2, r: 0.28, len: [3.4, 4.6], ends: ['coax_f', 'coax_f'],
    boot: 0x8d95a5, glow: 0.12, tint: 0xffffff, cut: 'cut_copper', points: 90,
    spark: [0xffffff, 0xc8d0dc, 0xffb347],
  },
  hv: {
    label: 'STARKSTROM 400V', tex: 'cable_hv', tileD: 8.4, r: 0.32, len: [4.6, 5.8], ends: ['hv_end', 'hv_end'],
    boot: 0xff2a3a, glow: 1.1, tint: 0xff3040, cut: 'cut_copper', hazard: true, points: 0,
    spark: [0xffe066, 0x66ccff, 0xffffff],
  },
  bundle: {
    label: 'GLASFASER-BÜNDEL', tex: 'cable_fiber', tileD: 7.4, r: 0.32, len: [4.0, 5.0], ends: [null, null],
    boot: 0xffc21a, glow: 0.9, cut: 'cut_fiber', points: 250, bonus: true, body: 'bundle',
    spark: [0xfff2b0, 0xffd24a, 0xff4fd8, 0x5ff2ff],
  },
};

const mats = {};
function typeMats(key) {
  if (mats[key]) return mats[key];
  const t = TYPES[key];
  const tex = A.tex[t.tex];
  // emissive is tinted with the cable colour so the neon glow stays saturated
  // after ACES tone mapping instead of blowing out to white
  const body = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: new THREE.Color(t.tint ?? t.boot), emissiveIntensity: t.glow, roughness: 0.4, metalness: 0.05,
  });
  const boot = new THREE.MeshStandardMaterial({
    name: 'boot', color: t.boot, emissive: t.boot, emissiveIntensity: key === 'coax' ? 0.05 : 0.35, roughness: 0.42, metalness: 0.1,
  });
  mats[key] = { body, boot };
  return mats[key];
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

// --------------------------------------------------------------------------
// Shape: the random bent centre-line shared by a cable and its cut pieces
// --------------------------------------------------------------------------
function makeShape(type, length, bend = 1) {
  const n = 6;
  const pts = [];
  const amp = (0.35 + Math.random() * 0.6) * bend;
  const freq = 0.6 + Math.random() * 0.9;
  const ph = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const x = (u - 0.5) * length;
    pts.push(new THREE.Vector3(x, Math.sin(u * Math.PI * 2 * freq + ph) * amp, Math.cos(u * 5 + ph) * 0.25 * bend));
  }
  return shapeFromPoints(pts);
}

export function shapeFromPoints(pts) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const L = curve.getLength();
  return { curve, L, frames: null };
}

function frames(shape) {
  if (!shape.frames) shape.frames = shape.curve.computeFrenetFrames(64, false);
  return shape.frames;
}

// --------------------------------------------------------------------------
// Base flying object
// --------------------------------------------------------------------------
class Flyer {
  constructor() {
    this.group = new THREE.Group();
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.alive = true;
    this.sliceable = true;
    this.hazard = false;
    this.bonus = false;
    this.age = 0;
    this.pinned = false;
  }

  update(dt, gravity) {
    this.age += dt;
    if (!this.pinned) {
      this.vel.y -= gravity * dt;
      this.group.position.addScaledVector(this.vel, dt);
      this.group.rotation.x += this.spin.x * dt;
      this.group.rotation.y += this.spin.y * dt;
      this.group.rotation.z += this.spin.z * dt;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.isMesh && o.userData.ownGeo) o.geometry.dispose();
    });
  }
}

// --------------------------------------------------------------------------
// Cable
// --------------------------------------------------------------------------
export class Cable extends Flyer {
  /**
   * @param {string} typeKey key of TYPES
   * @param {object} o  { shape, a, b, ends, offset, length }
   */
  constructor(typeKey, o = {}) {
    super();
    const type = (this.type = TYPES[typeKey]);
    this.typeKey = typeKey;
    this.kind = 'cable';
    this.hazard = !!type.hazard;
    this.bonus = !!type.bonus;
    this.shape = o.shape || makeShape(type, o.length || THREE.MathUtils.randFloat(...type.len), o.bend ?? 1);
    this.a = o.a ?? 0;
    this.b = o.b ?? 1;
    this.ends = o.ends || type.ends.slice();
    this.offset = o.offset || this.shape.curve.getPointAt((this.a + this.b) / 2).clone();
    this.mats = typeMats(typeKey);
    this._build();
    this._prepareSamples();
  }

  get tileLen() { return this.type.tileD * Math.PI * this.type.r; }

  _build() {
    const { type, shape, a, b, offset } = this;
    const g = this.group;
    const r = type.r;

    if (type.body === 'bundle') this._buildBundle();
    else {
      const segs = Math.max(10, Math.round(56 * (b - a)));
      const pts = [];
      for (let i = 0; i <= segs; i++) pts.push(shape.curve.getPointAt(a + (b - a) * (i / segs)).sub(offset));
      const sub = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(sub, segs, r, 14, false);
      const u0 = (a * shape.L) / this.tileLen;
      const u1 = (b * shape.L) / this.tileLen;
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
      const mesh = new THREE.Mesh(geo, this.mats.body);
      mesh.userData.ownGeo = true;
      g.add(mesh);
    }

    // connectors / cut cross-sections
    this.endObjs = [];
    this.ends.forEach((kind, i) => {
      if (!kind) { this.endObjs.push(null); return; }
      const t = i === 0 ? a : b;
      const p = shape.curve.getPointAt(t).sub(offset);
      const tan = shape.curve.getTangentAt(t).clone();
      if (i === 0) tan.negate();
      const model = cloneModel(kind === 'cut' ? type.cut : kind, this.mats.boot);
      model.scale.setScalar(r);
      model.position.copy(p);
      model.quaternion.setFromUnitVectors(UP, tan);
      g.add(model);
      this.endObjs.push(model);
    });

    if (this.hazard) this._buildHazardFx();
  }

  _buildBundle() {
    const { type, shape, a, b, offset } = this;
    const fr = frames(shape);
    const r = type.r;
    const ringR = r * 0.6;
    const rs = r * 0.34;
    const N = Math.max(8, Math.round(40 * (b - a)));
    const colors = [0xffc21a, 0xffd86a, 0xffb000, 0xfff0b0, 0xffc21a, 0xffe08a, 0xffffff];
    for (let k = 0; k < 7; k++) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const s = a + (b - a) * (i / N);
        const fi = Math.min(64, Math.round(s * 64));
        const p = shape.curve.getPointAt(s).sub(offset);
        if (k > 0) {
          const ang = (k / 6) * Math.PI * 2 + s * 5;
          p.addScaledVector(fr.normals[fi], Math.cos(ang) * ringR).addScaledVector(fr.binormals[fi], Math.sin(ang) * ringR);
        }
        pts.push(p);
      }
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, rs, 8, false);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colors[k], emissive: colors[k], emissiveIntensity: 0.3, roughness: 0.3 }));
      m.userData.ownGeo = true;
      this.group.add(m);
      // glowing fibre tips at uncut ends
      [[0, a], [1, b]].forEach(([i, s]) => {
        if (this.ends[i] === 'cut') return;
        const tip = new THREE.Mesh(new THREE.SphereGeometry(rs * 1.2, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2c0).multiplyScalar(1.6) }));
        tip.position.copy(pts[i === 0 ? 0 : pts.length - 1]);
        tip.userData.ownGeo = true;
        this.group.add(tip);
      });
    }
    // chrome tie band in the middle (from the MENÜ-KABEL sheet)
    if (a < 0.5 && b > 0.5) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, r * 1.3, 18), new THREE.MeshStandardMaterial({ color: 0xc8d0dc, metalness: 1, roughness: 0.25 }));
      band.position.copy(shape.curve.getPointAt(0.5).sub(offset));
      band.quaternion.setFromUnitVectors(UP, shape.curve.getTangentAt(0.5));
      band.userData.ownGeo = true;
      this.group.add(band);
    }
    // soft golden halo
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc933, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.3 }));
    halo.scale.set(4, 2.2, 1);
    this.group.add(halo);
    this.halo = halo;
  }

  _buildHazardFx() {
    // crackling yellow / blue arcs around the 400V line ("glühen gelb/blau")
    const ARCS = 7;
    const SEG = 7;
    const pos = new Float32Array(ARCS * SEG * 2 * 3);
    const col = new Float32Array(ARCS * SEG * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.userData.ownGeo = true;
    lines.frustumCulled = false;
    this.group.add(lines);
    this.arcs = { lines, ARCS, SEG, timer: 0 };
    // pulsing glow sprites along the cable
    this.halos = [];
    for (let i = 0; i < 3; i++) {
      const s = this.a + (this.b - this.a) * ((i + 0.5) / 3);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: i % 2 ? 0x66ccff : 0xffd23a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
      sp.position.copy(this.shape.curve.getPointAt(s).sub(this.offset));
      sp.scale.setScalar(2.2);
      this.group.add(sp);
      this.halos.push(sp);
    }
    // floating warning sign (icon extracted from the reference sheet)
    if (this.b - this.a > 0.9) {
      const warn = new THREE.Sprite(new THREE.SpriteMaterial({ map: A.tex.icon_warning, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      warn.scale.set(1.1, 1.1, 1);
      warn.position.set(0, 1.1, 0.5);
      this.group.add(warn);
      this.warn = warn;
    }
    this._rerollArcs();
  }

  _rerollArcs() {
    const { lines, ARCS, SEG } = this.arcs;
    const pos = lines.geometry.attributes.position.array;
    const col = lines.geometry.attributes.color.array;
    const r = this.type.r;
    let k = 0;
    for (let a = 0; a < ARCS; a++) {
      const s0 = this.a + Math.random() * (this.b - this.a);
      const s1 = THREE.MathUtils.clamp(s0 + (Math.random() - 0.5) * 0.35, this.a, this.b);
      const p0 = this.shape.curve.getPointAt(s0).sub(this.offset);
      const p1 = this.shape.curve.getPointAt(s1).sub(this.offset);
      const lift = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.2).normalize().multiplyScalar(r * (2 + Math.random() * 3));
      const c = Math.random() < 0.5 ? [1, 0.85, 0.25] : [0.35, 0.8, 1];
      const b = 0.6 + Math.random() * 0.8;
      let prev = p0.clone();
      for (let i = 1; i <= SEG; i++) {
        const t = i / SEG;
        const p = p0.clone().lerp(p1, t).addScaledVector(lift, Math.sin(t * Math.PI));
        if (i < SEG) p.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(r * 1.3));
        pos.set([prev.x, prev.y, prev.z, p.x, p.y, p.z], k * 6);
        col.set([c[0] * b, c[1] * b, c[2] * b, c[0] * b, c[1] * b, c[2] * b], k * 6);
        prev = p;
        k++;
      }
    }
    lines.geometry.attributes.position.needsUpdate = true;
    lines.geometry.attributes.color.needsUpdate = true;
  }

  update(dt, gravity) {
    super.update(dt, gravity);
    if (this.arcs) {
      this.arcs.timer -= dt;
      if (this.arcs.timer <= 0) {
        this.arcs.timer = 0.05 + Math.random() * 0.05;
        this._rerollArcs();
      }
      const p = 0.5 + 0.5 * Math.sin(this.age * 22);
      this.halos.forEach((h, i) => { h.material.opacity = 0.35 + 0.45 * (i % 2 ? p : 1 - p); });
      if (this.warn) this.warn.material.opacity = 0.6 + 0.4 * Math.sin(this.age * 10);
    }
    if (this.halo) this.halo.material.opacity = 0.22 + 0.12 * Math.sin(this.age * 8);
  }

  // ---------------- slicing ----------------
  _prepareSamples() {
    const K = 16;
    this.sT = [];
    this.sLocal = [];
    for (let i = 0; i < K; i++) {
      const t = this.a + (this.b - this.a) * (i / (K - 1));
      this.sT.push(t);
      this.sLocal.push(this.shape.curve.getPointAt(t).sub(this.offset));
    }
    // extend the hit line over the connectors
    const ext = (i) => (this.ends[i] && this.ends[i] !== 'cut' ? this.type.r * 6.5 : this.type.r * 1.2);
    const t0 = this.shape.curve.getTangentAt(this.a);
    const t1 = this.shape.curve.getTangentAt(this.b);
    this.sLocal.unshift(this.sLocal[0].clone().addScaledVector(t0, -ext(0)));
    this.sT.unshift(this.a);
    this.sLocal.push(this.sLocal[this.sLocal.length - 1].clone().addScaledVector(t1, ext(1)));
    this.sT.push(this.b);
    this.screen = this.sLocal.map(() => ({ x: 0, y: 0 }));
  }

  project(project) {
    this.group.updateMatrixWorld();
    for (let i = 0; i < this.sLocal.length; i++) {
      tmpV.copy(this.sLocal[i]).applyMatrix4(this.group.matrixWorld);
      project(tmpV, this.screen[i]);
    }
  }

  /** screen-space blade segment test -> hit or null */
  hitTest(p0, p1) {
    const S = this.screen;
    for (let i = 0; i < S.length - 1; i++) {
      const h = segIntersect(p0, p1, S[i], S[i + 1]);
      if (h) {
        const t = this.sT[i] + (this.sT[i + 1] - this.sT[i]) * h.u;
        const cdx = S[i + 1].x - S[i].x;
        const cdy = S[i + 1].y - S[i].y;
        const bdx = p1.x - p0.x;
        const bdy = p1.y - p0.y;
        const cos = Math.abs(cdx * bdx + cdy * bdy) / (Math.hypot(cdx, cdy) * Math.hypot(bdx, bdy) + 1e-9);
        const angle = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, cos)));
        return { t, x: h.x, y: h.y, angle, cable: { x: cdx, y: cdy }, blade: { x: bdx, y: bdy } };
      }
    }
    return null;
  }

  /** screen-space centre (for miss markers / popups) */
  screenCenter(project, out = tmpS) {
    return project(this.group.getWorldPosition(tmpV), out);
  }

  /** fraction of the cut position towards the nearest connector end (0 = at connector) */
  endProximity(t) {
    const L = this.b - this.a;
    let d = Infinity;
    if (this.ends[0] && this.ends[0] !== 'cut') d = Math.min(d, (t - this.a) / L);
    if (this.ends[1] && this.ends[1] !== 'cut') d = Math.min(d, (this.b - t) / L);
    return d;
  }

  /** world-space point on the centre line */
  worldPointAt(t, out = new THREE.Vector3()) {
    this.group.updateMatrixWorld();
    return out.copy(this.shape.curve.getPointAt(t)).sub(this.offset).applyMatrix4(this.group.matrixWorld);
  }

  worldTangentAt(t, out = new THREE.Vector3()) {
    return out.copy(this.shape.curve.getTangentAt(t)).applyQuaternion(this.group.getWorldQuaternion(tmpQ));
  }

  /** split into two pieces at curve parameter t; returns [pieceA, pieceB] */
  cut(t, bladeDirWorld) {
    const span = this.b - this.a;
    t = THREE.MathUtils.clamp(t, this.a + span * 0.07, this.b - span * 0.07);
    const cutWorld = this.worldPointAt(t);
    const n = new THREE.Vector3(-bladeDirWorld.y, bladeDirWorld.x, 0).normalize();
    const pieces = [
      new Cable(this.typeKey, { shape: this.shape, a: this.a, b: t, ends: [this.ends[0], 'cut'] }),
      new Cable(this.typeKey, { shape: this.shape, a: t, b: this.b, ends: ['cut', this.ends[1]] }),
    ];
    const wq = this.group.getWorldQuaternion(new THREE.Quaternion());
    const wp = this.group.getWorldPosition(new THREE.Vector3());
    for (const p of pieces) {
      p.sliceable = false;
      p.hazard = false;
      p.group.quaternion.copy(wq);
      p.group.position.copy(p.offset).sub(this.offset).applyQuaternion(wq).add(wp);
      const side = Math.sign(tmpV.copy(p.group.position).sub(cutWorld).dot(n)) || 1;
      p.vel.copy(this.vel).multiplyScalar(0.55).addScaledVector(n, side * (2.2 + Math.random() * 1.6));
      p.vel.y += 1.5;
      p.spin.copy(this.spin).multiplyScalar(0.5);
      p.spin.z += side * (1.5 + Math.random() * 3);
      p.spin.x += (Math.random() - 0.5) * 2;
    }
    return pieces;
  }
}

// --------------------------------------------------------------------------
// Props: firewall (hazard) + corrupted data packet (target)
// --------------------------------------------------------------------------
export class Prop extends Flyer {
  constructor(kind) {
    super();
    this.kind = kind;
    if (kind === 'firewall') {
      this.hazard = true;
      const m = cloneModel('firewall');
      m.scale.setScalar(0.62);
      this.group.add(m);
      this.model = m;
      this.hitR = 2.5;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff5a1a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 }));
      glow.scale.setScalar(7);
      glow.position.z = -0.6;
      this.group.add(glow);
      this.glow = glow;
      this.fireMat = null;
      m.traverse((o) => { if (o.isMesh && o.material.name === 'fire') this.fireMat = o.material; });
    } else {
      const m = cloneModel('packet');
      m.scale.setScalar(0.72);
      this.group.add(m);
      this.model = m;
      this.hitR = 1.25;
      this.points = 60;
      this.glitchT = 0;
    }
    this.center = { x: 0, y: 0 };
    this.screenR = 10;
  }

  update(dt, gravity) {
    super.update(dt, gravity);
    if (this.kind === 'firewall') {
      this.model.rotation.z += dt * 7; // spinning razor wall
      const p = 0.5 + 0.5 * Math.sin(this.age * 14);
      this.glow.material.opacity = 0.45 + 0.35 * p;
      if (this.fireMat) this.fireMat.emissiveIntensity = 0.7 + 0.6 * p;
    } else {
      this.glitchT -= dt;
      if (this.glitchT <= 0) {
        this.glitchT = 0.05 + Math.random() * 0.3;
        const g = Math.random() < 0.35;
        this.model.position.set(g ? (Math.random() - 0.5) * 0.35 : 0, g ? (Math.random() - 0.5) * 0.2 : 0, 0);
        this.model.scale.set(0.72 * (g ? 1.2 : 1), 0.72 * (g ? 0.8 : 1), 0.72);
      }
    }
  }

  project(project) {
    this.group.updateMatrixWorld();
    project(this.group.getWorldPosition(tmpV), this.center);
    // world radius -> pixel radius at z ~ 0
    this.screenR = (this.hitR / (world.halfH * 2)) * world.height;
  }

  hitTest(p0, p1) {
    const c = this.center;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const L2 = dx * dx + dy * dy || 1;
    const u = THREE.MathUtils.clamp(((c.x - p0.x) * dx + (c.y - p0.y) * dy) / L2, 0, 1);
    const x = p0.x + dx * u;
    const y = p0.y + dy * u;
    if (Math.hypot(x - c.x, y - c.y) < this.screenR) return { t: 0.5, x, y, angle: 90, blade: { x: dx, y: dy } };
    return null;
  }

  screenCenter(project, out = tmpS) {
    return project(this.group.getWorldPosition(tmpV), out);
  }
}

// --------------------------------------------------------------------------
function segIntersect(p, p2, q, q2) {
  const rx = p2.x - p.x;
  const ry = p2.y - p.y;
  const sx = q2.x - q.x;
  const sy = q2.y - q.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = q.x - p.x;
  const qpy = q.y - p.y;
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p.x + rx * t, y: p.y + ry * t, u };
}
