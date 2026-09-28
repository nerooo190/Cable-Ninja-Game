// Bootstrap + state machine: boot -> menu -> game / shop / options -> game over.
import { initWorld, buildEnvironment, render, world } from './world.js';
import { loadAssets } from './assets.js';
import { fx } from './effects.js';
import { Blade } from './blade.js';
import { Menu } from './menu.js';
import { Game } from './game.js';
import { ui } from './ui.js';
import { audio } from './audio.js';
import { save } from './storage.js';
import { t, applyStatic, onLangChange } from './i18n.js';

const $ = (s) => document.querySelector(s);
const bootLog = $('#bootLog');
const bootBar = $('#bootBar');
const log = (line) => { bootLog.textContent += `\n> ${line}`; };

let state = 'boot';
let menu;
let game;
let blade;
let lastMode = 'classic';

async function boot() {
  applyStatic(); // DE / EN for all static markup
  const canvas = $('#gl');
  try {
    initWorld(canvas);
  } catch (e) {
    bootLog.textContent = t('boot.nogl');
    throw e;
  }
  log('GPU online – WebGL2 renderer ready');
  await loadAssets(world.renderer, (p, label) => {
    bootBar.style.width = `${Math.round(p * 100)}%`;
    log(`mount ${label}`);
    bootLog.scrollTop = bootLog.scrollHeight;
    const lines = bootLog.textContent.split('\n');
    if (lines.length > 9) bootLog.textContent = lines.slice(-9).join('\n');
  });
  buildEnvironment();
  fx.init();
  log('server room: 52 racks online, 400V bus: UNSTABLE');

  blade = new Blade($('#fx2d'), canvas);
  blade.onStrokeStart = () => audio.unlock();
  game = new Game(blade, { onGameOver });
  menu = new Menu(blade, onMenuSelect);

  ui.init({
    back: () => goMenu(),
    resume: () => resume(),
    restart: () => startGame(lastMode),
    menu: () => goMenu(),
    pause: () => pause(),
    reset: (btn) => {
      // two-step confirmation inside the panel (no blocking browser dialog)
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = t('opt.reset.confirm');
        clearTimeout(btn._t);
        btn._t = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = t('opt.reset'); }, 3000);
        return;
      }
      btn.dataset.armed = '';
      btn.textContent = t('opt.reset.done');
      ui.resetProgress();
    },
    bloom: (on) => { world.useBloom = on; },
  });

  // live language switch: rebuild texts that were generated from script
  onLangChange(() => {
    ui.refreshMenuStats();
    if (state === 'menu') menu.show();
    if (state === 'shop') ui.renderShop();
    if (state === 'game' || state === 'pause') {
      ui.setHud(true, game.modeKey);
      ui.setTimer(game.timeLeft);
    }
  });

  // warm up shaders before the first frame is shown
  world.renderer.compile(world.scene, world.camera);
  goMenu();
  setTimeout(() => $('#loading').classList.add('done'), 250);
  setTimeout(() => $('#loading').remove(), 1000);

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (state === 'game') pause();
      else if (state === 'pause') resume();
      else if (state === 'shop' || state === 'options') goMenu();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'game') pause();
  });
  // rebuild the hanging menu cables for the new viewport
  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (state === 'menu') menu.show(); }, 200);
  });
  // unlock audio on the first interaction anywhere
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
}

function tick(dt) {
  if (window.__dcc.noRender) return; // automated tests drive the sim via __dcc.advance()
  world.time.value += dt;
  world.dust?.userData.update(dt);
  // gentle camera breathing
  const t = world.time.value;
  world.camera.position.x = Math.sin(t * 0.21) * 0.25;
  world.camera.position.y = Math.sin(t * 0.17) * 0.18;
  world.camera.lookAt(0, 0, -6);

  if (state === 'menu') menu.update(dt);
  if (state === 'game' || state === 'over') game.update(dt);
  fx.update(state === 'pause' ? 0 : dt * (game?.state === 'crash' ? 0.25 : 1));
  render();
  blade.draw();

  // flicker the menu packet-loss readout
  if (state === 'menu' && Math.random() < 0.03) {
    $('#pktLoss').textContent = `${(95 + Math.random() * 4.9).toFixed(1)}%`;
    $('#ping').textContent = String(3 + Math.floor(Math.random() * 4));
  }
}

function hideScreens() {
  ['#menu', '#shop', '#options', '#pause', '#gameover'].forEach((s) => ui.hide(s));
}

function goMenu() {
  game.clear();
  hideScreens();
  ui.setHud(false);
  ui.clearPopups();
  ui.refreshMenuStats();
  ui.show('#menu');
  menu.show();
  blade.enabled = true;
  audio.setMode('menu');
  state = 'menu';
}

function onMenuSelect(id) {
  if (id === 'shop') {
    menu.hide();
    hideScreens();
    ui.renderShop();
    ui.show('#shop');
    state = 'shop';
  } else if (id === 'options') {
    menu.hide();
    hideScreens();
    ui.syncOptions();
    ui.show('#options');
    state = 'options';
  } else startGame(id);
}

function startGame(mode) {
  audio.unlock();
  lastMode = mode;
  menu.hide();
  hideScreens();
  ui.clearPopups();
  blade.enabled = true;
  blade.cancel();
  game.start(mode);
  state = 'game';
}

function pause() {
  if (state !== 'game' || game.state !== 'play') return;
  game.paused = true;
  blade.cancel();
  ui.show('#pause');
  state = 'pause';
}

function resume() {
  if (state !== 'pause') return;
  ui.hide('#pause');
  game.paused = false;
  blade.cancel();
  state = 'game';
}

function onGameOver(result) {
  state = 'over';
  blade.cancel();
  setTimeout(() => {
    ui.setHud(false);
    ui.showGameOver(result);
  }, result.kind === 'crash' ? 150 : 700);
}

boot().catch((e) => console.error(e));

// expose for debugging in the console
window.__dcc = {
  world, save,
  get game() { return game; },
  get menu() { return menu; },
  get state() { return state; },
  noRender: false,
  /** advance the simulation without rendering (automated tests on slow software GL) */
  advance(seconds, step = 1 / 60) {
    for (let t = 0; t < seconds; t += step) {
      if (state === 'menu') menu.update(step);
      if (state === 'game' || state === 'over') game.update(step);
      fx.update(step);
    }
  },
};
