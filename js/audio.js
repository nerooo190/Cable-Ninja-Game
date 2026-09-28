// Fully synthesized WebAudio sound design: laser slices, sparks, 400V zaps,
// server-room hum and a small arcade bass sequencer. No audio files needed.

class Audio {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.mode = 'menu'; // 'menu' | 'game' | 'off'
    this._seqTimer = null;
    this._beepTimer = null;
  }

  // must be called from a user gesture
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 1 : 0;
    this.music.connect(this.master);

    // shared white noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // distortion curve for zaps
    const n = 1024;
    this.curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      this.curve[i] = Math.tanh(x * 6);
    }
    this._startHum();
    this.setMode(this.mode);
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.music) this.music.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.2);
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }
  get ok() { return !!this.ctx && this.sfxOn; }

  // ---------- building blocks ----------
  _noise(dur, { type = 'bandpass', freq = 2000, q = 1, gain = 0.5, attack = 0.002, freqEnd = null, dest = this.sfx, when = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = this.t + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  _tone(freq, dur, { type = 'sine', gain = 0.3, freqEnd = null, attack = 0.004, dest = this.sfx, when = 0, detune = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = this.t + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = detune;
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // ---------- game sounds ----------
  whoosh(speed = 1) {
    if (!this.ok) return;
    const s = Math.min(1, speed);
    this._noise(0.22, { type: 'bandpass', freq: 600 + 1400 * s, freqEnd: 2600 + 2000 * s, q: 1.4, gain: 0.12 + 0.12 * s });
  }

  slice(quality = 0.5, kind = 'lan') {
    if (!this.ok) return;
    // snip + electric sizzle, brighter for clean 90° cuts
    const base = kind === 'fiber' ? 2400 : kind === 'coax' ? 1400 : 1800;
    this._tone(base + quality * 1600, 0.12, { type: 'square', gain: 0.07, freqEnd: 300 });
    this._noise(0.09, { type: 'highpass', freq: 3500, gain: 0.45 });
    this._noise(0.35, { type: 'bandpass', freq: 5200, q: 3, gain: 0.12, when: 0.02 });
    if (kind === 'fiber') this._tone(3200, 0.4, { type: 'sine', gain: 0.06, freqEnd: 5200, when: 0.03 });
  }

  perfect() {
    if (!this.ok) return;
    [0, 4, 7, 12].forEach((st, i) => this._tone(880 * 2 ** (st / 12), 0.22, { type: 'triangle', gain: 0.1, when: i * 0.045 }));
  }

  combo(n) {
    if (!this.ok) return;
    for (let i = 0; i < Math.min(n, 8); i++) this._tone(523 * 2 ** ((i * 2) / 12), 0.16, { type: 'square', gain: 0.05, when: i * 0.06 });
  }

  launch() {
    if (!this.ok) return;
    this._tone(140, 0.18, { type: 'sine', gain: 0.18, freqEnd: 60 });
    this._noise(0.12, { type: 'lowpass', freq: 900, gain: 0.1 });
  }

  crackle(dur = 0.6) {
    if (!this.ok) return;
    for (let i = 0; i < 6; i++) this._noise(0.05, { type: 'highpass', freq: 2500 + Math.random() * 3000, gain: 0.12, when: Math.random() * dur });
    this._tone(100, dur, { type: 'sawtooth', gain: 0.035, detune: 8 });
  }

  zap() {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t0 = this.t;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t0);
    o.frequency.linearRampToValueAtTime(55, t0 + 1.4);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = ctx.createGain();
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    const sh = ctx.createWaveShaper();
    sh.curve = this.curve;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
    o.connect(sh).connect(g).connect(this.sfx);
    o.start(t0); lfo.start(t0);
    o.stop(t0 + 1.7); lfo.stop(t0 + 1.7);
    this._noise(1.2, { type: 'highpass', freq: 1200, gain: 0.5 });
    this._noise(0.5, { type: 'lowpass', freq: 300, gain: 0.8 });
    for (let i = 0; i < 10; i++) this._noise(0.04, { type: 'highpass', freq: 4000, gain: 0.3, when: Math.random() * 0.9 });
  }

  shatter() {
    if (!this.ok) return;
    for (let i = 0; i < 5; i++) this._tone(1200 + Math.random() * 2800, 0.08, { type: 'square', gain: 0.04, when: i * 0.02 });
    this._noise(0.25, { type: 'highpass', freq: 5000, gain: 0.25 });
  }

  miss() {
    if (!this.ok) return;
    this._tone(330, 0.3, { type: 'square', gain: 0.08, freqEnd: 110 });
    this._tone(220, 0.35, { type: 'square', gain: 0.06, freqEnd: 80, when: 0.12 });
  }

  boost() {
    if (!this.ok) return;
    for (let i = 0; i < 6; i++) this._tone(440 * 2 ** (i / 4), 0.2, { type: 'sawtooth', gain: 0.05, when: i * 0.05 });
  }

  click() {
    if (!this.ok) return;
    this._tone(1600, 0.05, { type: 'square', gain: 0.05 });
  }

  tick() {
    if (!this.ok) return;
    this._tone(1000, 0.06, { type: 'sine', gain: 0.1 });
  }

  gameOver() {
    if (!this.ok) return;
    [0, -3, -7, -12].forEach((st, i) => this._tone(330 * 2 ** (st / 12), 0.4, { type: 'square', gain: 0.07, when: i * 0.16 }));
  }

  // ---------- ambience + music ----------
  _startHum() {
    const ctx = this.ctx;
    const hum = ctx.createGain();
    hum.gain.value = 0.05;
    hum.connect(this.music);
    [50, 100, 150].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.25, 0.1][i];
      o.connect(g).connect(hum);
      o.start();
    });
    // fans: looped filtered noise
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(f).connect(g).connect(hum);
    src.start();
    // random data-center beeps
    this._beepTimer = setInterval(() => {
      if (!this.musicOn || Math.random() < 0.5) return;
      this._tone(1200 + Math.random() * 1800, 0.07, { type: 'sine', gain: 0.025, dest: this.music });
    }, 1400);
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ctx) return;
    clearInterval(this._seqTimer);
    this._seqTimer = null;
    if (mode !== 'game') return;
    // tiny look-ahead sequencer: driving minor bassline + hats
    const bpm = 124;
    const step = 60 / bpm / 2;
    const bass = [45, 45, 57, 45, 43, 43, 55, 43, 41, 41, 53, 41, 43, 43, 55, 47];
    let i = 0;
    let next = this.t + 0.1;
    this._seqTimer = setInterval(() => {
      while (next < this.t + 0.2) {
        const when = next - this.t;
        const midi = bass[i % bass.length];
        this._tone(440 * 2 ** ((midi - 69) / 12), step * 0.9, { type: 'sawtooth', gain: 0.045, dest: this.music, when, attack: 0.01 });
        if (i % 2 === 1) this._noise(0.04, { type: 'highpass', freq: 7000, gain: 0.05, dest: this.music, when });
        if (i % 4 === 0) this._tone(110, 0.14, { type: 'sine', gain: 0.18, freqEnd: 45, dest: this.music, when });
        next += step;
        i++;
      }
    }, 40);
  }
}

export const audio = new Audio();
