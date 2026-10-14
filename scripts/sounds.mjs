// Renders the mod's sounds: each reward scene's from the scene's own timeline
// into sounds/reward-<scene>.wav, the expiry alert's two falling glass tones
// into sounds/expiring.wav, and the new-cache LED panel's into sounds/mint.wav:
// node scripts/sounds.mjs
import fs from 'fs'

const R = await import('../hooks/reward.ts')
for (const v of R.REWARD_VARIANTS) fs.writeFileSync(new URL(`../sounds/reward-${v}.wav`, import.meta.url), R.wav(R.rewardSamples(v)))

const SR = R.SAMPLE_RATE
const out = new Float32Array(Math.ceil(SR * 1.6))
const bell = (at, f, g) => {
  const i0 = Math.round(at * SR)
  for (let i = 0; i0 + i < out.length; i++) {
    const t = i / SR
    out[i0 + i] += g * Math.min(1, t / 0.002) * Math.exp(-t / 0.35) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / 0.06))
  }
}
bell(0, 1760, 0.3)
bell(0.18, 1318.5, 0.3)
fs.writeFileSync(new URL('../sounds/expiring.wav', import.meta.url), R.wav(out))

// The new-cache LED panel, on its timeline (mintSvg in hooks/register.tsx), as
// a little tune in C: the dot charges on G, B, D (the dominant, rising), the
// front fires on a harp sweep up C major over a warm chord, the twinkles
// play a melody while it holds, and the break-up cascades back down to a
// soft C chord. Mallets and bells, through a touch of room.
const mint = new Float32Array(Math.ceil(SR * 5.2))
const add = (at, len, fn) => {
  const i0 = Math.round(at * SR)
  for (let i = 0; i < len * SR && i0 + i < mint.length; i++) mint[i0 + i] += fn(i / SR)
}
const hz = n => 440 * 2 ** ((n - 69) / 12)
const TAU = 2 * Math.PI
// Struck and ringing out: a sine with a little of its octave on the strike.
const mallet = (at, n, g, len = 1.4) => {
  const f = hz(n)
  add(at, len, t => g * Math.min(1, t / 0.004) * Math.min(1, (len - t) / 0.08) * Math.exp(-t / (len / 4)) * (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.12)))
}
// Glassy, high and short.
const glass = (at, n, g, len = 0.9) => {
  const f = hz(n)
  add(at, len, t => g * Math.min(1, t / 0.003) * Math.min(1, (len - t) / 0.08) * Math.exp(-t / (len / 5)) * (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t / 0.05)))
}
// A soft chord swelling in and out, each note two voices a hair apart.
const pad = (at, notes, len, g) =>
  add(at, len, t => {
    const env = Math.min(1, t / 0.4) * Math.min(1, (len - t) / 1.0)
    return g * env * notes.reduce((a, n) => a + Math.sin(TAU * hz(n) * 0.998 * t) + Math.sin(TAU * hz(n) * 1.002 * t), 0)
  })

// Charge: G4, B4, D5, one a ring.
;[67, 71, 74].forEach((n, k) => mallet(k * 0.16, n, 0.13, 0.9))
// Fire: C, the harp sweep up two octaves, a low C under it, and the chord held.
mallet(0.5, 48, 0.12, 2.2)
;[72, 76, 79, 83, 84, 88, 91, 96].forEach((n, k) => mallet(0.5 + k * 0.035, n, 0.075, 1.3))
pad(0.5, [60, 64, 67, 71, 74], 2.9, 0.011)
// The twinkles, a melody on their jumps.
;[88, 91, 93, 91, 96, 95, 91, 93, 88, 91].forEach((n, k) => glass(1.2 + k * 0.17, n, 0.045))
// Break-up: a cascade down as the blocks go dark, settling on a C chord.
;[96, 93, 91, 88, 86, 84, 81, 79].forEach((n, k) => glass(2.9 + k * 0.13, n, 0.055 - k * 0.003, 1.1))
;[60, 67, 76].forEach(n => mallet(4.0, n, 0.07, 1.2))

// A small room: four feedback delays, darkened, mixed in under the dry sound.
const wet = new Float32Array(mint.length)
for (const [ms, fb] of [[29.7, 0.55], [37.1, 0.52], [41.1, 0.5], [43.7, 0.48]]) {
  const d = Math.round((ms / 1000) * SR)
  const buf = new Float32Array(mint.length)
  for (let i = 0; i < buf.length; i++) {
    buf[i] = mint[i] + (i >= d ? fb * buf[i - d] : 0)
    wet[i] += buf[i] / 4
  }
}
let lp = 0
for (let i = 0; i < mint.length; i++) {
  lp += 0.25 * (wet[i] - lp)
  const fade = Math.min(1, (mint.length - i) / (0.3 * SR))
  mint[i] = Math.tanh((mint[i] + 0.3 * lp) * 1.4) * fade
}
fs.writeFileSync(new URL('../sounds/mint.wav', import.meta.url), R.wav(mint))
