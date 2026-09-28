// DOM layer: HUD, popups, panels (shop / options / pause / game over).
import { save, persist, resetSave, bestOverall } from './storage.js';
import { audio } from './audio.js';

const $ = (s) => document.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export const UPGRADES = [
  {
    id: 'blade', title: 'LASER-KLINGE MK', icon: 'i-bolt', color: '#39e8ff', costs: [300, 800, 1600],
    desc: (lv) => `Breitere Klinge & längere Spur. PERFEKT-Fenster ±${6 + 3 * lv}° → ±${6 + 3 * (lv + 1)}°`,
  },
  {
    id: 'psu', title: 'REDUNDANTES NETZTEIL', icon: 'i-heart', color: '#ff2447', costs: [500, 1500],
    desc: () => '+1 Server-Status-Herz (N+1 Redundanz) im Schicht- & 400V-Modus',
  },
  {
    id: 'cooling', title: 'FLÜSSIGKÜHLUNG', icon: 'i-gear', color: '#5ff2ff', costs: [400, 1000],
    desc: (lv) => `Kabel fliegen ${8 * (lv + 1)}% langsamer – mehr Zeit für den 90°-Schnitt`,
  },
  {
    id: 'guide', title: 'WINKEL-LASER', icon: 'i-wrench', color: '#ffc933', costs: [600],
    desc: () => 'Projiziert eine handgezeichnete 90°-Hilfslinie auf jedes Kabel',
  },
];

export const ui = {
  hud: $('#hud'),
  scoreEl: $('#score'),
  hearts: $('#hearts'),
  timer: $('#timer'),
  statusCap: $('#statusCap'),
  boost: $('#boost'),
  boostTime: $('#boostTime'),
  comboMeter: $('#comboMeter'),
  modeTag: $('#modeTag'),
  popups: $('#popups'),
  flashEl: $('#flash'),
  app: $('#app'),
  handlers: {},

  init(handlers) {
    this.handlers = handlers;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      audio.click();
      this.handlers[btn.dataset.action]?.(btn);
    });
    $('#pauseBtn').addEventListener('click', () => this.handlers.pause?.());
    this._initOptions();
    this.applyOptions();
    this.refreshMenuStats();
  },

  show(id) { $(id).classList.remove('hidden'); },
  hide(id) { $(id).classList.add('hidden'); },

  // ---------------- HUD ----------------
  setHud(visible, mode) {
    this.hud.classList.toggle('hidden', !visible);
    if (!visible) return;
    const names = { classic: 'SCHICHT // CLASSIC', rush: 'FIBER RUSH // 60s', nightmare: '⚡ 400V NIGHTMARE ⚡' };
    this.modeTag.textContent = names[mode];
    this.modeTag.className = mode;
    const timed = mode === 'rush';
    this.hearts.classList.toggle('hidden', timed);
    this.timer.classList.toggle('hidden', !timed);
    this.statusCap.textContent = timed ? 'UPTIME:' : 'SERVER-STATUS:';
  },

  setScore(v, bump = false) {
    this.scoreEl.textContent = fmt(v);
    if (bump) {
      const el = this.scoreEl.parentElement;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  },

  setLives(lives, max, hit = false) {
    let html = '';
    for (let i = 0; i < max; i++) {
      const alive = i < lives;
      const cls = alive ? '' : 'lost' + (hit && i === lives ? ' hit' : '');
      html += `<svg class="${cls}" viewBox="0 0 64 58"><use href="#${alive ? 'i-heart' : 'i-heart-empty'}"/></svg>`;
    }
    this.hearts.innerHTML = html;
  },

  setTimer(t) {
    const s = Math.max(0, Math.ceil(t));
    this.timer.textContent = `0:${String(s).padStart(2, '0')}`;
    this.timer.classList.toggle('low', t <= 10);
  },

  setBoost(t) {
    this.boost.classList.toggle('hidden', t <= 0);
    if (t > 0) this.boostTime.textContent = `${t.toFixed(1)}s`;
  },

  setCombo(n) {
    this.comboMeter.textContent = n >= 2 ? `KETTE x${n}` : '';
  },

  // ---------------- popups ----------------
  popup(x, y, pts, grade, label, extra = '') {
    const el = document.createElement('div');
    el.className = `pop g-${grade}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = `<span class="pts">+${fmt(pts)}</span><span class="grade">${label}</span>${extra ? `<span class="strip">${extra}</span>` : ''}`;
    this._pop(el);
  },

  bigPopup(x, y, title, sub, cls) {
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = `<span class="pts">${title}</span><span class="grade">${sub}</span>`;
    this._pop(el, 1300);
  },

  missMark(x, label = 'PAKETVERLUST') {
    const el = document.createElement('div');
    el.className = 'miss-x';
    el.style.left = `${Math.max(40, Math.min(window.innerWidth - 40, x))}px`;
    el.style.top = `${window.innerHeight - 20}px`;
    el.innerHTML = `✕<small>${label}</small>`;
    this._pop(el, 1300);
  },

  _pop(el, ms = 1100) {
    this.popups.appendChild(el);
    setTimeout(() => el.remove(), ms);
  },

  clearPopups() { this.popups.innerHTML = ''; },

  flash(x, y, red = false) {
    const f = this.flashEl;
    f.style.setProperty('--fx', `${x}px`);
    f.style.setProperty('--fy', `${y}px`);
    f.classList.remove('go', 'red');
    void f.offsetWidth;
    if (red) f.classList.add('red');
    f.classList.add('go');
  },

  shake(big = false) {
    if (!save.options.shake) return;
    const a = this.app;
    a.classList.remove('shake', 'shake-big');
    void a.offsetWidth;
    a.classList.add(big ? 'shake-big' : 'shake');
  },

  // ---------------- menu footer ----------------
  refreshMenuStats() {
    $('#bestScore').textContent = fmt(bestOverall());
    $('#credits').textContent = fmt(save.credits);
    $('#opName').textContent = save.name;
  },

  // ---------------- shop ----------------
  renderShop() {
    $('#shopCredits').textContent = fmt(save.credits);
    const list = $('#shopList');
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lv = save.upgrades[u.id];
      const maxed = lv >= u.costs.length;
      const cost = u.costs[lv];
      const item = document.createElement('div');
      item.className = 'shop-item';
      item.innerHTML = `
        <div class="si-icon" style="color:${u.color}"><svg viewBox="0 0 64 64"><use href="#${u.icon}"/></svg></div>
        <div><h3>${u.title}${u.costs.length > 1 ? ' ' + 'I'.repeat(Math.min(lv + 1, u.costs.length)) : ''}</h3>
          <p>${maxed ? 'Voll ausgebaut. Rack läuft auf Anschlag.' : u.desc(lv)}</p>
          <div class="lv">${u.costs.map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></div>
        <button class="btn ${maxed ? '' : 'primary'}" ${maxed || save.credits < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `${fmt(cost)} TB`}</button>`;
      item.querySelector('button').addEventListener('click', () => {
        if (maxed || save.credits < cost) return;
        save.credits -= cost;
        save.upgrades[u.id]++;
        persist();
        audio.boost();
        this.renderShop();
        this.refreshMenuStats();
      });
      list.appendChild(item);
    }
  },

  // ---------------- options ----------------
  _initOptions() {
    document.querySelectorAll('[data-opt]').forEach((inp) => {
      inp.checked = !!save.options[inp.dataset.opt];
      inp.addEventListener('change', () => {
        save.options[inp.dataset.opt] = inp.checked;
        persist();
        this.applyOptions();
        audio.click();
      });
    });
    const sw = $('#bladeSwatches');
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('[data-blade]');
      if (!b) return;
      save.options.blade = b.dataset.blade;
      persist();
      this._markSwatch();
      audio.click();
    });
    this._markSwatch();
    const name = $('#nameInput');
    name.value = save.name;
    name.addEventListener('input', () => {
      save.name = name.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, '').slice(0, 12) || 'USER_404';
      persist();
      this.refreshMenuStats();
    });
    name.addEventListener('pointerdown', (e) => e.stopPropagation());
  },

  syncOptions() {
    document.querySelectorAll('[data-opt]').forEach((inp) => { inp.checked = !!save.options[inp.dataset.opt]; });
    $('#nameInput').value = save.name;
    this._markSwatch();
  },

  _markSwatch() {
    document.querySelectorAll('#bladeSwatches [data-blade]').forEach((b) => b.classList.toggle('on', b.dataset.blade === save.options.blade));
  },

  applyOptions() {
    const o = save.options;
    audio.setSfx(o.sfx);
    audio.setMusic(o.music);
    document.body.classList.toggle('no-crt', !o.crt);
    this.handlers.bloom?.(o.bloom);
  },

  resetProgress() {
    resetSave();
    this.syncOptions();
    this.applyOptions();
    this.refreshMenuStats();
  },

  // ---------------- game over ----------------
  showGameOver(r) {
    const panel = $('#goPanel');
    panel.classList.remove('lost', 'timeup');
    if (r.kind === 'lost') panel.classList.add('lost');
    if (r.kind === 'timeup') panel.classList.add('timeup');
    $('.bsod-face').textContent = r.kind === 'timeup' ? ':)' : ':(';
    $('#goTitle').textContent = r.title;
    $('#goReason').textContent = r.reason;
    const stats = [
      ['BANDBREITE', `${fmt(r.score)} GB/s`],
      ['BESTWERT', `${fmt(r.best)} GB/s`],
      ['KABEL GEKAPPT', fmt(r.cuts)],
      ['PERFEKTE 90°', fmt(r.perfect)],
      ['Ø WINKEL', r.cuts ? `${r.avgAngle.toFixed(1)}°` : '—'],
      ['MAX. KETTE', `x${r.maxCombo}`],
      ['DATENVOLUMEN', `+${fmt(r.credits)} TB`],
    ];
    $('#goStats').innerHTML = stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
    $('#goRecord').classList.toggle('hidden', !r.record);
    this.show('#gameover');
  },
};
