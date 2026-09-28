// Bilingual UI (Deutsch / English). Static markup uses data-i18n / data-i18n-html
// attributes, scripts call t('key', {vars}).
import { save, persist } from './storage.js';

const STR = {
  de: {
    // HUD
    'hud.bandwidth': 'BANDBREITE:',
    'hud.status': 'SERVER-STATUS:',
    'hud.uptime': 'UPTIME:',
    'hud.boost': 'UPLINK BOOST x2',
    'hud.chain': 'KETTE x{n}',
    'mode.classic': 'SCHICHT // CLASSIC',
    'mode.rush': 'FIBER RUSH // 60s',
    'mode.nightmare': '⚡ 400V NIGHTMARE ⚡',
    'aria.pause': 'Pause',
    // menu
    'menu.hint': 'Schneide ein Kabel, um zu wählen',
    'menu.footer': 'BEST BANDWIDTH: <b id="bestScore">0</b> GB/s // PING: <span id="ping">4</span>ms | PACKETS: OK // DATENVOLUMEN: <b id="credits">0</b> TB // SERVER_LOCATION: HANOVER, GERMANY',
    'menu.start': 'START',
    'menu.start.sub': '[ SCHNITT: SCHICHT<br>STARTEN ]',
    'menu.rush': 'FIBER RUSH',
    'menu.rush.sub': '[ SCHNITT: FIBER-RUSH<br>(TIME ATTACK) ]',
    'menu.shop': 'UPGRADES',
    'menu.shop.sub': '[ SCHNITT:<br>RACK-UPGRADES ]',
    'menu.options': 'OPTIONS',
    'menu.options.sub': '[ SCHNITT:<br>SYSTEM-CONFIG ]',
    'menu.hv.long': 'STARKSTROM ',
    'menu.hv.sub': 'NIGHTMARE MODE - HIGH RISK',
    // shop
    'shop.title': 'RACK-UPGRADES',
    'shop.credits': 'DATENVOLUMEN:',
    'shop.maxed': 'Voll ausgebaut. Rack läuft auf Anschlag.',
    'up.blade': 'LASER-KLINGE MK',
    'up.blade.desc': 'Breitere Klinge & längere Spur. PERFEKT-Fenster ±{a}° → ±{b}°',
    'up.psu': 'REDUNDANTES NETZTEIL',
    'up.psu.desc': '+1 Server-Status-Herz (N+1 Redundanz) im Schicht- & 400V-Modus',
    'up.cooling': 'FLÜSSIGKÜHLUNG',
    'up.cooling.desc': 'Kabel fliegen {p}% langsamer – mehr Zeit für den 90°-Schnitt',
    'up.guide': 'WINKEL-LASER',
    'up.guide.desc': 'Projiziert eine handgezeichnete 90°-Hilfslinie auf jedes Kabel',
    // options
    'opt.title': 'SYSTEM-CONFIG',
    'opt.lang': 'SPRACHE / LANGUAGE',
    'opt.sfx': 'SOUND-FX',
    'opt.music': 'SERVER-BRUMMEN (MUSIK)',
    'opt.bloom': 'NEON-BLOOM (GRAFIK)',
    'opt.crt': 'CRT-SCANLINES',
    'opt.shake': 'SCREEN-SHAKE',
    'opt.protractor': 'WINKEL-OVERLAY (SKIZZE)',
    'opt.blade': 'KLINGENFARBE',
    'opt.name': 'OPERATOR-NAME',
    'opt.reset': 'FORMATIEREN (RESET)',
    'opt.reset.confirm': 'WIRKLICH ALLES LÖSCHEN?',
    'opt.reset.done': 'FORMATIERT ✓',
    'btn.back': '← ZURÜCK',
    // pause
    'pause.title': 'WARTUNGSMODUS',
    'pause.text': 'Schicht pausiert. Kabel hängen in der Luft …',
    'btn.resume': 'WEITER',
    'btn.restart': 'NEUSTART',
    'btn.menu': 'HAUPTMENÜ',
    // game over
    'go.newShift': 'NEUE SCHICHT',
    'go.record': 'NEUER REKORD!',
    'go.crash': 'SYSTEMABSTURZ',
    'go.crash.hv': 'KERNEL_PANIC: 400V_CONTACT_DETECTED',
    'go.crash.fw': 'FIREWALL_BREACH: ACCESS_DENIED (0xDEADBEEF)',
    'go.lost': 'SERVER OFFLINE',
    'go.lost.reason': 'PACKET_LOSS: 100% // ZU VIELE KABEL VERPASST',
    'go.timeup': 'SCHICHTENDE',
    'go.timeup.reason': 'FIBER RUSH ABGESCHLOSSEN // 60s UPTIME',
    'st.bandwidth': 'BANDBREITE',
    'st.best': 'BESTWERT',
    'st.cuts': 'KABEL GEKAPPT',
    'st.perfect': 'PERFEKTE 90°',
    'st.angle': 'Ø WINKEL',
    'st.combo': 'MAX. KETTE',
    'st.credits': 'DATENVOLUMEN',
    // in-game popups
    'g.perfect': 'PERFEKT!',
    'g.clean': 'SAUBERER SCHNITT',
    'g.ok': 'OK',
    'g.bad': 'SCHRÄG',
    'g.strip': 'KABELENDE GEKAPPT x1.5',
    'g.packet': 'PAKET GELÖSCHT',
    'g.miss': 'PAKETVERLUST',
    'g.missed': 'VERPASST',
    'g.boost.sub': 'Glasfaser-Bündel gekappt – 8s doppelte Bandbreite',
    'g.combo.sub': '+{n} GB/s KABELSALAT-BONUS',
    'g.crash.hv': '400V KONTAKT!',
    'g.crash.fw': 'FIREWALL DURCHTRENNT!',
    'g.pen.fw': 'FIREWALL BLOCKIERT',
    'g.pen.hv': '400V STROMSCHLAG',
    'hint.first': 'SCHNEIDE IM 90°-WINKEL',
    'hint.first.sub': 'Rechter Winkel = maximale Bandbreite',
    'hint.hazard': '⚠ 400V & FIREWALLS',
    'hint.hazard.sub': 'Berührung = Systemabsturz',
    'hint.start': 'SCHICHT STARTET',
    'hint.rush': '60 Sekunden – kappe so viel du kannst!',
    'hint.avoid': 'Meide 400V-Leitungen & Firewalls!',
    // boot
    'boot.nogl': '> FATAL: WebGL nicht verfügbar.\n> Bitte einen aktuellen Browser verwenden.',
    'noscript': 'Dieses Spiel benötigt JavaScript & WebGL.',
  },
  en: {
    'hud.bandwidth': 'BANDWIDTH:',
    'hud.status': 'SERVER STATUS:',
    'hud.uptime': 'UPTIME:',
    'hud.boost': 'UPLINK BOOST x2',
    'hud.chain': 'CHAIN x{n}',
    'mode.classic': 'SHIFT // CLASSIC',
    'mode.rush': 'FIBER RUSH // 60s',
    'mode.nightmare': '⚡ 400V NIGHTMARE ⚡',
    'aria.pause': 'Pause',
    'menu.hint': 'Slice a cable to choose',
    'menu.footer': 'BEST BANDWIDTH: <b id="bestScore">0</b> GB/s // PING: <span id="ping">4</span>ms | PACKETS: OK // DATA VOLUME: <b id="credits">0</b> TB // SERVER_LOCATION: HANOVER, GERMANY',
    'menu.start': 'START',
    'menu.start.sub': '[ SLICE: START<br>SHIFT ]',
    'menu.rush': 'FIBER RUSH',
    'menu.rush.sub': '[ SLICE: FIBER RUSH<br>(TIME ATTACK) ]',
    'menu.shop': 'UPGRADES',
    'menu.shop.sub': '[ SLICE:<br>RACK UPGRADES ]',
    'menu.options': 'OPTIONS',
    'menu.options.sub': '[ SLICE:<br>SYSTEM CONFIG ]',
    'menu.hv.long': 'HIGH VOLTAGE ',
    'menu.hv.sub': 'NIGHTMARE MODE - HIGH RISK',
    'shop.title': 'RACK UPGRADES',
    'shop.credits': 'DATA VOLUME:',
    'shop.maxed': 'Fully upgraded. The rack is running flat out.',
    'up.blade': 'LASER BLADE MK',
    'up.blade.desc': 'Wider blade & longer trail. PERFECT window ±{a}° → ±{b}°',
    'up.psu': 'REDUNDANT PSU',
    'up.psu.desc': '+1 server status heart (N+1 redundancy) in Shift & 400V mode',
    'up.cooling': 'LIQUID COOLING',
    'up.cooling.desc': 'Cables fly {p}% slower – more time for the 90° cut',
    'up.guide': 'ANGLE LASER',
    'up.guide.desc': 'Projects a hand-drawn 90° guide line onto every cable',
    'opt.title': 'SYSTEM CONFIG',
    'opt.lang': 'LANGUAGE / SPRACHE',
    'opt.sfx': 'SOUND FX',
    'opt.music': 'SERVER HUM (MUSIC)',
    'opt.bloom': 'NEON BLOOM (GRAPHICS)',
    'opt.crt': 'CRT SCANLINES',
    'opt.shake': 'SCREEN SHAKE',
    'opt.protractor': 'ANGLE OVERLAY (SKETCH)',
    'opt.blade': 'BLADE COLOR',
    'opt.name': 'OPERATOR NAME',
    'opt.reset': 'FORMAT (RESET)',
    'opt.reset.confirm': 'REALLY DELETE EVERYTHING?',
    'opt.reset.done': 'FORMATTED ✓',
    'btn.back': '← BACK',
    'pause.title': 'MAINTENANCE MODE',
    'pause.text': 'Shift paused. Cables hang in mid-air …',
    'btn.resume': 'RESUME',
    'btn.restart': 'RESTART',
    'btn.menu': 'MAIN MENU',
    'go.newShift': 'NEW SHIFT',
    'go.record': 'NEW RECORD!',
    'go.crash': 'SYSTEM CRASH',
    'go.crash.hv': 'KERNEL_PANIC: 400V_CONTACT_DETECTED',
    'go.crash.fw': 'FIREWALL_BREACH: ACCESS_DENIED (0xDEADBEEF)',
    'go.lost': 'SERVER OFFLINE',
    'go.lost.reason': 'PACKET_LOSS: 100% // TOO MANY CABLES MISSED',
    'go.timeup': 'END OF SHIFT',
    'go.timeup.reason': 'FIBER RUSH COMPLETE // 60s UPTIME',
    'st.bandwidth': 'BANDWIDTH',
    'st.best': 'BEST',
    'st.cuts': 'CABLES CUT',
    'st.perfect': 'PERFECT 90°',
    'st.angle': 'AVG. ANGLE',
    'st.combo': 'MAX. CHAIN',
    'st.credits': 'DATA VOLUME',
    'g.perfect': 'PERFECT!',
    'g.clean': 'CLEAN CUT',
    'g.ok': 'OK',
    'g.bad': 'SLOPPY',
    'g.strip': 'CABLE END STRIPPED x1.5',
    'g.packet': 'PACKET DELETED',
    'g.miss': 'PACKET LOSS',
    'g.missed': 'MISSED',
    'g.boost.sub': 'Fiber bundle cut – 8s double bandwidth',
    'g.combo.sub': '+{n} GB/s CABLE MESS BONUS',
    'g.crash.hv': '400V CONTACT!',
    'g.crash.fw': 'FIREWALL SEVERED!',
    'g.pen.fw': 'FIREWALL BLOCKED',
    'g.pen.hv': '400V SHOCK',
    'hint.first': 'CUT AT 90°',
    'hint.first.sub': 'Right angle = maximum bandwidth',
    'hint.hazard': '⚠ 400V & FIREWALLS',
    'hint.hazard.sub': 'Touch one = system crash',
    'hint.start': 'SHIFT STARTS',
    'hint.rush': '60 seconds – cut as much as you can!',
    'hint.avoid': 'Avoid 400V lines & firewalls!',
    'boot.nogl': '> FATAL: WebGL not available.\n> Please use an up-to-date browser.',
    'noscript': 'This game requires JavaScript & WebGL.',
  },
};

export const LANGS = ['de', 'en'];

export function lang() {
  const l = save.options.lang;
  if (LANGS.includes(l)) return l;
  return (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function t(key, vars) {
  let s = STR[lang()][key] ?? STR.de[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** translate all static markup */
export function applyStatic(root = document) {
  document.documentElement.lang = lang();
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

const listeners = new Set();
export function onLangChange(fn) { listeners.add(fn); }

export function setLang(l) {
  if (!LANGS.includes(l)) return;
  save.options.lang = l;
  persist();
  applyStatic();
  listeners.forEach((fn) => fn(l));
}
