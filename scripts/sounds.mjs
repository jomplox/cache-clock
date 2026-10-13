// Renders the mod's sounds: each reward scene's from the scene's own timeline
// into sounds/reward-<scene>.wav, and the expiry alert's two falling glass
// tones into sounds/expiring.wav: node scripts/sounds.mjs
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
