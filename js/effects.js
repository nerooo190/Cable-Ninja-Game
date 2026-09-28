// 3D slice effects: streak sparks, extracted spark-burst sprites, flash light,
// fibre light beams, packet shards and big electric arcs for the 400V crash.
import * as THREE from 'three';
import { A } from './assets.js';
import { world } from './world.js';
import { glowTexture } from './cables.js';

const MAX_SPARKS = 1600;

class Effects {
  init() {
    const scene = world.scene;

    // ---- streak sparks (line segments stretched along velocity)
    this.sp = {
      pos: new Float32Array(MAX_SPARKS * 3),
      vel: new Float32Array(MAX_SPARKS * 3),
      col: new Float32Array(MAX_SPARKS * 3),
      life: new Float32Array(MAX_SPARKS),
      max: new Float32Array(MAX_SPARKS),
      drag: new Float32Array(MAX_SPARKS),
      grav: new Float32Array(MAX_SPARKS),
      next: 0,
    };
    const geo = new THREE.BufferGeometry();
    this.linePos = new Float32Array(MAX_SPARKS * 6);
    this.lineCol = new Float32Array(MAX_SPARKS * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3));
    this.sparkLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparkLines.frustumCulled = false;
    this.sparkLines.renderOrder = 10;
    scene.add(this.sparkLines);

    // ---- glowing dots for embers (points)
    const pgeo = new THREE.BufferGeometry();
    this.dotPos = new Float32Array(MAX_SPARKS * 3);
    this.dotCol = new Float32Array(MAX_SPARKS * 3);
    pgeo.setAttribute('position', new THREE.BufferAttribute(this.dotPos, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(this.dotCol, 3));
    this.dots = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 0.16, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 10;
    scene.add(this.dots);

    // ---- burst sprites (fx_sparks_a / _b extracted from the asset sheet)
    this.bursts = [];
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: i % 2 ? A.tex.fx_sparks_a : A.tex.fx_sparks_b, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.visible = false;
      s.renderOrder = 11;
      s.userData = { life: 0, max: 1, size: 1 };
      scene.add(s);
      this.bursts.push(s);
    }
    // ---- flash light for cut impacts
    this.flashLight = new THREE.PointLight(0xffffff, 0, 12, 1.5);
    scene.add(this.flashLight);

    // ---- shards (packet explosion)
    this.shards = [];
    const shardGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const shardMats = [0xff4fd8, 0x5ff2ff, 0xffffff].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2) }));
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(shardGeo, shardMats[i % 3]);
      m.visible = false;
      m.userData = { vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
      scene.add(m);
      this.shards.push(m);
    }

    // ---- fibre light beams
    this.beams = [];

    // ---- big crash lightning
    const BOLTS = 8;
    const SEG = 14;
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLTS * SEG * 6), 3));
    bgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(BOLTS * SEG * 6), 3));
    this.bolts = new THREE.LineSegments(bgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.bolts.frustumCulled = false;
    this.bolts.visible = false;
    this.bolts.renderOrder = 12;
    this.boltInfo = { BOLTS, SEG, life: 0, origin: new THREE.Vector3(), timer: 0 };
    scene.add(this.bolts);
  }

  // ------------------------------------------------------------------
  spark(p, v, color, life = 0.6, drag = 1.8, grav = 9) {
    const s = this.sp;
    const i = s.next;
    s.next = (s.next + 1) % MAX_SPARKS;
    s.pos.set([p.x, p.y, p.z], i * 3);
    s.vel.set([v.x, v.y, v.z], i * 3);
    const c = new THREE.Color(color);
    s.col.set([c.r, c.g, c.b], i * 3);
    s.life[i] = life;
    s.max[i] = life;
    s.drag[i] = drag;
    s.grav[i] = grav;
  }

  /** radial spark burst, biased along `dir` (cut plane) */
  burst(p, colors, count = 60, speed = 12, dir = null) {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.6).normalize();
      if (dir && Math.random() < 0.6) v.lerp(dir.clone().multiplyScalar(Math.random() < 0.5 ? 1 : -1), 0.6).normalize();
      v.multiplyScalar(speed * (0.25 + Math.random() * 0.9));
      this.spark(p, v, colors[(Math.random() * colors.length) | 0], 0.25 + Math.random() * 0.55);
    }
  }

  spriteBurst(p, size = 3, tint = 0xffffff, life = 0.35) {
    const s = this.bursts.find((b) => !b.visible) || this.bursts[0];
    s.visible = true;
    s.position.copy(p);
    s.position.z += 0.4;
    s.material.color.set(tint);
    s.material.rotation = Math.random() * Math.PI * 2;
    s.userData.life = life;
    s.userData.max = life;
    s.userData.size = size;
  }

  flash(p, color = 0xffffff, intensity = 60) {
    this.flashLight.position.copy(p).setZ(2);
    this.flashLight.color.set(color);
    this.flashLight.intensity = intensity;
  }

  shatter(p, count = 26) {
    let n = 0;
    for (const s of this.shards) {
      if (s.visible) continue;
      s.visible = true;
      s.position.copy(p);
      s.scale.setScalar(0.6 + Math.random() * 1.2);
      s.userData.vel.set((Math.random() - 0.5) * 14, Math.random() * 10 - 2, (Math.random() - 0.5) * 6);
      s.userData.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      s.userData.life = 0.8 + Math.random() * 0.6;
      if (++n >= count) break;
    }
  }

  /** light shooting out of a freshly cut fibre, attached to the cut piece */
  fiberBeam(piece, localPos, localDir, color = 0xfff0b0) {
    const geo = new THREE.CylinderGeometry(0.02, 0.24, 2.4, 12, 1, true);
    geo.translate(0, 1.2, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(localPos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir);
    piece.group.add(m);
    this.beams.push({ mesh: m, life: 1.2, max: 1.2 });
  }

  /** giant 400V arcs for the system crash */
  crash(p) {
    this.boltInfo.origin.copy(p);
    this.boltInfo.life = 1.6;
    this.bolts.visible = true;
    this.burst(p, [0xffffff, 0xffe066, 0x66ccff, 0x9f7bff], 260, 26);
    for (let i = 0; i < 4; i++) this.spriteBurst(p, 6 + i * 3, i % 2 ? 0x88ccff : 0xffee88, 0.6 + i * 0.1);
    this.flash(p, 0x9fd8ff, 400);
  }

  _rerollBolts() {
    const { BOLTS, SEG, origin } = this.boltInfo;
    const pos = this.bolts.geometry.attributes.position.array;
    const col = this.bolts.geometry.attributes.color.array;
    let k = 0;
    for (let b = 0; b < BOLTS; b++) {
      const ang = Math.random() * Math.PI * 2;
      const len = 8 + Math.random() * 16;
      const end = new THREE.Vector3(origin.x + Math.cos(ang) * len, origin.y + Math.sin(ang) * len, origin.z);
      const c = Math.random() < 0.5 ? [1, 0.95, 0.5] : [0.5, 0.85, 1];
      let prev = origin.clone();
      for (let i = 1; i <= SEG; i++) {
        const t = i / SEG;
        const p = origin.clone().lerp(end, t);
        if (i < SEG) p.add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, 0));
        pos.set([prev.x, prev.y, prev.z, p.x, p.y, p.z], k * 6);
        const f = 1.4 * (1 - t * 0.6);
        col.set([c[0] * f, c[1] * f, c[2] * f, c[0] * f, c[1] * f, c[2] * f], k * 6);
        prev = p;
        k++;
      }
    }
    this.bolts.geometry.attributes.position.needsUpdate = true;
    this.bolts.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    this.sp.life.fill(0);
    this.bursts.forEach((b) => (b.visible = false));
    this.shards.forEach((s) => (s.visible = false));
    this.beams.forEach((b) => b.mesh.removeFromParent());
    this.beams = [];
    this.bolts.visible = false;
    this.boltInfo.life = 0;
  }

  // ------------------------------------------------------------------
  update(dt) {
    const s = this.sp;
    const LP = this.linePos;
    const LC = this.lineCol;
    const DP = this.dotPos;
    const DC = this.dotCol;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const i3 = i * 3;
      const i6 = i * 6;
      if (s.life[i] <= 0) {
        LC.fill(0, i6, i6 + 6);
        DC.fill(0, i3, i3 + 3);
        continue;
      }
      s.life[i] -= dt;
      const k = Math.exp(-s.drag[i] * dt);
      s.vel[i3] *= k;
      s.vel[i3 + 1] = s.vel[i3 + 1] * k - s.grav[i] * dt;
      s.vel[i3 + 2] *= k;
      s.pos[i3] += s.vel[i3] * dt;
      s.pos[i3 + 1] += s.vel[i3 + 1] * dt;
      s.pos[i3 + 2] += s.vel[i3 + 2] * dt;
      const f = Math.max(0, s.life[i] / s.max[i]);
      const st = 0.035;
      LP[i6] = s.pos[i3];
      LP[i6 + 1] = s.pos[i3 + 1];
      LP[i6 + 2] = s.pos[i3 + 2];
      LP[i6 + 3] = s.pos[i3] - s.vel[i3] * st;
      LP[i6 + 4] = s.pos[i3 + 1] - s.vel[i3 + 1] * st;
      LP[i6 + 5] = s.pos[i3 + 2] - s.vel[i3 + 2] * st;
      const b = 1.6 * f;
      LC[i6] = s.col[i3] * b; LC[i6 + 1] = s.col[i3 + 1] * b; LC[i6 + 2] = s.col[i3 + 2] * b;
      LC[i6 + 3] = s.col[i3] * b * 0.2; LC[i6 + 4] = s.col[i3 + 1] * b * 0.2; LC[i6 + 5] = s.col[i3 + 2] * b * 0.2;
      DP[i3] = s.pos[i3]; DP[i3 + 1] = s.pos[i3 + 1]; DP[i3 + 2] = s.pos[i3 + 2];
      DC[i3] = s.col[i3] * f; DC[i3 + 1] = s.col[i3 + 1] * f; DC[i3 + 2] = s.col[i3 + 2] * f;
    }
    this.sparkLines.geometry.attributes.position.needsUpdate = true;
    this.sparkLines.geometry.attributes.color.needsUpdate = true;
    this.dots.geometry.attributes.position.needsUpdate = true;
    this.dots.geometry.attributes.color.needsUpdate = true;

    for (const b of this.bursts) {
      if (!b.visible) continue;
      const u = b.userData;
      u.life -= dt;
      if (u.life <= 0) { b.visible = false; continue; }
      const t = 1 - u.life / u.max;
      const sc = u.size * (0.4 + 0.9 * Math.sqrt(t));
      b.scale.set(sc * 1.17, sc, 1);
      b.material.opacity = Math.min(1, (1 - t) * 1.6);
    }

    this.flashLight.intensity *= Math.exp(-dt * 14);

    for (const sh of this.shards) {
      if (!sh.visible) continue;
      const u = sh.userData;
      u.life -= dt;
      if (u.life <= 0 || sh.position.y < -world.halfH - 3) { sh.visible = false; continue; }
      u.vel.y -= 14 * dt;
      sh.position.addScaledVector(u.vel, dt);
      sh.rotation.x += u.spin.x * dt;
      sh.rotation.y += u.spin.y * dt;
    }

    this.beams = this.beams.filter((b) => {
      b.life -= dt;
      if (b.life <= 0 || !b.mesh.parent) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); return false; }
      b.mesh.material.opacity = (b.life / b.max) * (0.35 + 0.25 * Math.random());
      return true;
    });

    const bi = this.boltInfo;
    if (bi.life > 0) {
      bi.life -= dt;
      bi.timer -= dt;
      if (bi.timer <= 0) { bi.timer = 0.045; this._rerollBolts(); }
      this.bolts.material.opacity = Math.min(1, bi.life);
      if (bi.life <= 0) this.bolts.visible = false;
    }
  }
}

export const fx = new Effects();
