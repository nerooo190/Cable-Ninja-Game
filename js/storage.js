// Persistent save (best scores, credits, upgrades, options) in localStorage.
const KEY = 'dcc_save_v1';

const DEFAULTS = {
  name: 'USER_404',
  credits: 0,
  best: { classic: 0, rush: 0, nightmare: 0 },
  upgrades: { blade: 0, psu: 0, cooling: 0, guide: 0 },
  options: { sfx: true, music: true, bloom: true, crt: true, shake: true, protractor: true, blade: 'cyan' },
  stats: { games: 0, cuts: 0, perfect: 0 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function merge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], over[k]);
    else if (k in base) base[k] = over[k];
  }
  return base;
}

function load() {
  const data = clone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) merge(data, JSON.parse(raw));
  } catch { /* private mode / blocked storage: play without saving */ }
  return data;
}

export const save = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ }
}

export function resetSave() {
  const fresh = clone(DEFAULTS);
  for (const k of Object.keys(save)) delete save[k];
  Object.assign(save, fresh);
  persist();
}

export function bestOverall() {
  return Math.max(save.best.classic, save.best.rush, save.best.nightmare);
}
