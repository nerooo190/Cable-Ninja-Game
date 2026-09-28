// Main menu: five real 3D cables hang into the server room (menu.jpg).
// Slice one to pick a mode — or click / tap its label.
import * as THREE from 'three';
import { Cable, shapeFromPoints } from './cables.js';
import { world, toScreen, toWorld } from './world.js';
import { fx } from './effects.js';
import { audio } from './audio.js';

const ITEMS = [
  { id: 'classic', type: 'lan', ends: [null, 'rj45'], cls: 'start', title: 'START', sub: '[ SCHNITT: SCHICHT<br>STARTEN ]' },
  { id: 'rush', type: 'terminal', ends: [null, 'rj45'], cls: 'rush', title: 'FIBER RUSH', sub: '[ SCHNITT: FIBER-RUSH<br>(TIME ATTACK) ]' },
  { id: 'shop', type: 'bundle', ends: [null, null], cls: 'shop', title: 'UPGRADES', sub: '[ SCHNITT:<br>RACK-UPGRADES ]', icon: 'i-wrench' },
  { id: 'options', type: 'coax', ends: [null, 'coax_f'], cls: 'opts', title: 'OPTIONS', sub: '[ SCHNITT:<br>SYSTEM-CONFIG ]', icon: 'i-gear' },
  { id: 'nightmare', type: 'hv', ends: [null, 'hv_end'], cls: 'hv', title: '<svg viewBox="0 0 32 48"><use href="#i-bolt"/></svg> <span class="long">STARKSTROM </span>400V <svg viewBox="0 0 32 48"><use href="#i-bolt"/></svg>', sub: 'NIGHTMARE MODE - HIGH RISK' },
];

const MIN_SPEED = 280;
const project = (v, out) => toScreen(v, out);

export class Menu {
  constructor(blade, onSelect) {
    this.blade = blade;
    this.onSelect = onSelect;
    this.root = new THREE.Group();
    this.items = [];
    this.debris = [];
    this.active = false;
    this.labels = document.getElementById('labels');
    this.bladeImg = document.querySelector('.menu-blade');
    this.t = 0;
  }

  show() {
    this.hide();
    this.active = true;
    this.locked = false;
    world.scene.add(this.root);
    const hh = world.halfH;
    const hw = world.halfW;
    const spread = Math.min(hw * 0.84, hh * 1.5);
    const topY = hh + 1.5;
    const endY = -hh * 0.2;
    const narrow = world.width < 760;
    ITEMS.forEach((it, i) => {
      const x = (i - 2) * (spread / 2);
      // on narrow screens every second cable hangs lower so the labels don't collide
      const len = topY - endY + (narrow && i % 2 ? hh * 0.22 : 0);
      const pts = [];
      const wob = (Math.random() - 0.5) * 0.5;
      for (let k = 0; k < 5; k++) {
        const u = k / 4;
        pts.push(new THREE.Vector3(Math.sin(u * Math.PI) * wob, -u * len, Math.sin(u * 3) * 0.2));
      }
      const pivot = new THREE.Group();
      pivot.position.set(x, topY, -0.5);
      this.root.add(pivot);
      const cable = new Cable(it.type, { shape: shapeFromPoints(pts), ends: it.ends.slice() });
      cable.pinned = true;
      cable.group.position.copy(cable.offset);
      pivot.add(cable.group);

      const el = document.createElement('div');
      el.className = `mlabel ${it.cls}`;
      el.innerHTML = `${it.icon ? `<svg class="ml-icon" viewBox="0 0 64 64"><use href="#${it.icon}"/></svg>` : ''}<span class="ml-title">${it.title}</span><span class="ml-sub">${it.sub}</span>`;
      el.addEventListener('click', () => this._select(this.items.find((m) => m.it === it), null));
      this.labels.appendChild(el);
      this.items.push({ it, pivot, cable, el, phase: Math.random() * 6, cut: false });
    });
    this.update(0); // place labels immediately (no one-frame flash at 0,0)
  }

  hide() {
    this.active = false;
    this.root.removeFromParent();
    for (const m of this.items) {
      m.cable.dispose();
      m.el.remove();
    }
    for (const d of this.debris) d.dispose();
    this.root.clear();
    this.items = [];
    this.debris = [];
    this.labels.innerHTML = '';
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    for (const m of this.items) {
      m.pivot.rotation.z = Math.sin(this.t * 0.9 + m.phase) * 0.035;
      m.pivot.rotation.x = Math.sin(this.t * 0.6 + m.phase) * 0.05;
      m.pivot.updateMatrixWorld(true);
      m.cable.update(dt, 0);
      if (!m.cut) m.cable.project(project);
      // label sits under the lowest point of the cable
      const bottom = m.cable.worldPointAt(1);
      bottom.y -= m.cable.type.r * (m.it.ends[1] ? 7.5 : 1.5);
      const s = toScreen(bottom, { x: 0, y: 0 });
      const half = (m.w ||= m.el.offsetWidth) / 2 + 8;
      m.el.style.left = `${Math.min(world.width - half, Math.max(half, s.x))}px`;
      m.el.style.top = `${s.y + 10}px`;
      if (m.it.id === 'classic' && this.bladeImg) {
        this.bladeImg.style.setProperty('--blade-x', `${s.x + 26}px`);
        this.bladeImg.style.setProperty('--blade-y', `${s.y - 40}px`);
      }
    }
    for (const d of this.debris) d.update(dt, 12);
    this.debris = this.debris.filter((d) => {
      if (d.group.position.y > -world.halfH - 8) return true;
      d.dispose();
      return false;
    });

    if (this.locked) { this.blade.takeSegments(); return; }
    for (const s of this.blade.takeSegments()) {
      if (s.speed < MIN_SPEED) continue;
      for (const m of this.items) {
        if (m.cut) continue;
        const hit = m.cable.hitTest(s.p0, s.p1);
        if (hit) { this._select(m, hit); return; }
      }
    }
  }

  _select(m, hit) {
    if (!m || this.locked) return;
    audio.unlock();
    this.locked = true;
    m.cut = true;
    m.el.classList.add('gone');
    let t = 0.72;
    let x;
    let y;
    let bladeDir = new THREE.Vector3(1, 0, 0);
    if (hit) {
      t = hit.t;
      x = hit.x;
      y = hit.y;
      bladeDir = new THREE.Vector3(hit.blade.x, -hit.blade.y, 0).normalize();
      this.blade.sketch(hit, 90 - hit.angle < 9 ? 'perfect' : 'clean');
    } else {
      const p = toScreen(m.cable.worldPointAt(t), { x: 0, y: 0 });
      x = p.x;
      y = p.y;
    }
    const wp = toWorld(x, y);
    const [top, bottom] = m.cable.cut(t, bladeDir);
    // upper stub keeps hanging, lower part drops
    m.cable.group.removeFromParent();
    top.pinned = true;
    top.group.position.copy(top.offset);
    top.group.quaternion.identity();
    m.pivot.add(top.group);
    world.scene.add(bottom.group);
    bottom.vel.set(bladeDir.y * 1.5, 1, 0);
    this.debris.push(bottom);
    const old = m.cable;
    m.cable = top;
    old.dispose();

    const colors = m.cable.type.spark;
    fx.burst(wp, colors, 90, 13, bladeDir);
    fx.spriteBurst(wp, 3.6, 0xffffff, 0.45);
    fx.flash(wp, colors[0], 90);
    if (m.it.id === 'nightmare') { audio.zap(); fx.crash(wp); this.blade.lightning(x, y, 1); } else audio.slice(0.9, m.cable.typeKey);
    setTimeout(() => this.onSelect(m.it.id), m.it.id === 'nightmare' ? 900 : 550);
  }
}
