// audio.js — the whole soundscape is synthesized live with WebAudio; the
// game ships no audio files. Two building blocks cover everything: `burst`
// (a filtered slice of a shared white-noise buffer — gunfire, explosions,
// footsteps, the flare's hiss of a throw) and `blip` (an oscillator with an
// optional pitch glide — beeps, ticks, hit pings, the round-end jingle).
//
// Distance is faked the cheap way that works: a sound's gain falls off as
// 1 / (1 + 0.09 · dist) and its noise filter darkens with the same factor,
// so a firefight across the yard sounds like it is across the yard.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  // Build the context on first use (browsers refuse one before a gesture)
  // and keep rebuilding nothing afterwards. False when WebAudio is absent.
  function boot() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const samples = noiseBuf.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
    return true;
  }

  function burst(at, dur, gain, cutoff, kind = 'lowpass') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = kind;
    filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(at, Math.random() * 0.2);
    src.stop(at + dur + 0.02);
  }

  function blip(at, dur, gain, from, to, wave = 'square') {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, at);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  const distanceGain = (dist) => 1 / (1 + dist * 0.09);

  // Gunshot recipes: [noise seconds, noise gain, filter base, filter slope]
  // plus, for the heavy guns, a low sawtooth body underneath the crack.
  const SHOT_CRACK = {
    sniper: [0.5, 0.9, 900, 2400],
    shotgun: [0.35, 0.85, 700, 1800],
    smg: [0.13, 0.5, 1200, 2600],
    pistol: [0.16, 0.55, 1100, 2400],
    rifle: [0.22, 0.7, 1000, 2200],
  };
  const SHOT_BODY = {
    sniper: [0.3, 0.4, 160, 40],
    shotgun: [0.2, 0.35, 130, 50],
    rifle: [0.1, 0.2, 190, 70],
  };

  return {
    unlock() { boot(); },
    get ready() { return ctx !== null; },

    shot(kind, dist = 0) {
      if (!boot()) return;
      const v = distanceGain(dist);
      const key = Object.hasOwn(SHOT_CRACK, kind) ? kind : 'rifle';
      const [dur, gain, base, slope] = SHOT_CRACK[key];
      burst(ctx.currentTime, dur, gain * v, base + slope * v);
      const body = SHOT_BODY[key];
      if (body) blip(ctx.currentTime, body[0], body[1] * v, body[2], body[3], 'sawtooth');
    },
    dryFire() { if (boot()) blip(ctx.currentTime, 0.05, 0.15, 1400, 900); },
    reload() {
      if (!boot()) return;
      const t = ctx.currentTime;
      // Out, in, racked: three descending clacks spread over the animation.
      blip(t, 0.05, 0.2, 500, 300);
      blip(t + 0.28, 0.05, 0.25, 700, 400);
      blip(t + 0.55, 0.06, 0.3, 900, 500);
    },
    hit(head) {
      if (!boot()) return;
      blip(ctx.currentTime, head ? 0.16 : 0.07, 0.3, head ? 1560 : 2100, head ? 1560 : 1800, 'sine');
    },
    kill() {
      if (!boot()) return;
      const t = ctx.currentTime;
      blip(t, 0.09, 0.25, 880, 880, 'sine');
      blip(t + 0.09, 0.14, 0.25, 1320, 1320, 'sine');
    },
    hurt() { if (boot()) burst(ctx.currentTime, 0.18, 0.4, 400); },
    step(dist) { if (boot()) burst(ctx.currentTime, 0.07, 0.1 * distanceGain(dist), 500); },
    throwWhoosh() { if (boot()) burst(ctx.currentTime, 0.25, 0.2, 900, 'bandpass'); },
    bounce() { if (boot()) blip(ctx.currentTime, 0.05, 0.15, 300, 180); },
    explosion(big = true) {
      if (!boot()) return;
      const t = ctx.currentTime;
      burst(t, big ? 1.4 : 0.7, 1.0, 500);
      blip(t, big ? 1.1 : 0.6, 0.7, 120, 30, 'sine');
    },
    flashRing() { if (boot()) blip(ctx.currentTime, 1.4, 0.12, 5200, 4800, 'sine'); },
    beep(final = false) {
      if (boot()) blip(ctx.currentTime, final ? 0.4 : 0.09, 0.3, final ? 1320 : 990, 0, 'square');
    },
    defuseTick() { if (boot()) blip(ctx.currentTime, 0.05, 0.2, 660, 660, 'square'); },
    buy(ok) { if (boot()) blip(ctx.currentTime, 0.08, 0.25, ok ? 1180 : 220, ok ? 1180 : 160, 'square'); },
    roundEnd(won) {
      if (!boot()) return;
      const t = ctx.currentTime;
      const melody = won ? [523, 659, 784] : [392, 330, 262];
      melody.forEach((freq, i) => blip(t + i * 0.13, 0.22, 0.22, freq, 0, 'triangle'));
    },
    plantStart() { if (boot()) blip(ctx.currentTime, 0.1, 0.25, 740, 740, 'square'); },
  };
}
