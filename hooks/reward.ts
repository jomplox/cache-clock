// The reward for a message that reused a warm cache: a little pixel Clawd pops
// up where the ● sits, a gold coin bounces in along the band, and a prop
// makes the moment: the coin drops into a piggy bank, sunglasses drop onto
// Clawd, a mug of coffee (the cache is warm) steams a heart, a bubblegum
// bubble grows until it pops all over his face, or he dons a top hat and a
// monocle that pops out at the total. A close call has Clawd sprint in and
// flip a nearly empty hourglass; a milestone gets the guitar. "Saved $x" then
// rolls up like an odometer. Each scene's sound is rendered from the same
// timeline (scripts/sounds.mjs), so every bounce, the catch and each strum
// land on their frame.

import type { RewardVariant } from '../types'

export const REWARD_EVERYDAY: readonly RewardVariant[] = ['piggy', 'shades', 'mug', 'gum', 'tophat']
export const REWARD_VARIANTS: readonly RewardVariant[] = ['piggy', 'shades', 'mug', 'gum', 'tophat', 'hourglass', 'guitar']

const W = 2400
export const REWARD_H = 22
const D = 4.4
export const REWARD_MS = D * 1000
/** Room the line leaves at its start for Clawd and the prop. */
export const REWARD_ROOM = 76

const X0 = 2
const Y0 = 5
const PX = 2
const PY = 3
const CX = X0 + 17 // Clawd's middle
const CY = 12

const sec = (n: number) => `${n.toFixed(3)}s`

const BODY = ['...############...', '...##e######e##...', '.################.', '...############...', '....#.#....#.#....']
const arms = (l: boolean, r: boolean) => [
  `.${l ? '#' : '.'}.############.${r ? '#' : '.'}.`,
  `.${l ? '#' : '.'}.##e######e##.${r ? '#' : '.'}.`,
  ...BODY.slice(2),
]
const legs = (row: string) => [...BODY.slice(0, 4), row]
const POSES: Record<string, string[]> = {
  idle: BODY,
  cheer: arms(true, true),
  left: arms(true, false),
  right: arms(false, true),
  run1: legs('...#...#..#...#...'),
  run2: legs('.....#.#..#.#.....'),
  reach: [BODY[0]!, BODY[1]!, '.###################', BODY[3]!, BODY[4]!],
  wipe: ['.##############...', '.#.##e######e##...', '...###############.', BODY[3]!, BODY[4]!],
  strum: ['...############...', '...##e######e##...', '.##############...', '...############.#.', '....#.#....#.#....'],
  strumUp: ['...############.#.', '...##e######e##.#.', '.##############...', '...############...', '....#.#....#.#....'],
}

function sprite(rows: readonly string[]): string {
  let s = ''
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; ) {
      const c = r[x]
      if (c === '.') {
        x++
        continue
      }
      let e = x
      while (e < r.length && r[e] === c) e++
      s += `<rect class="${c === 'e' ? 'e' : 'o'}" x="${X0 + x * PX}" width="${(e - x) * PX}" y="${Y0 + y * PY}" height="${PY}"/>`
      x = e
    }
  })
  return s
}

// A prop drawn from a grid of 2px cells; each letter, after the prop's
// prefix, a class of the style.
function grid(prefix: string, x0: number, y0: number, rows: readonly string[]): string {
  let s = ''
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; ) {
      const c = r[x]!
      if (c === '.') {
        x++
        continue
      }
      let e = x
      while (e < r.length && r[e] === c) e++
      s += `<rect class="${prefix}${c}" x="${x0 + x * 2}" y="${y0 + y * 2}" width="${(e - x) * 2}" height="2"/>`
      x = e
    }
  })
  return s
}

type Track = [number, number | string][]

// A step track over the whole scene, begun at 0: [[t, value], ...], each
// value held until the next. Whole-scene tracks keep their last value even
// in a redraw's image that starts after their last step.
function steps(track: Track): { values: string; keyTimes: string } {
  const t = [...track].sort((a, b) => a[0] - b[0]).filter((s, i, all) => i === all.length - 1 || all[i + 1]![0] > s[0])
  if (t[0]![0] > 0) t.unshift([0, t[0]![1]])
  return { values: t.map(s => s[1]).join(';'), keyTimes: t.map(s => (s[0] / D).toFixed(4)).join(';') }
}
const stepAnim = (attr: string, track: Track) => {
  const st = steps(track)
  return `<animate attributeName="${attr}" begin="0s" dur="${D}s" calcMode="discrete" values="${st.values}" keyTimes="${st.keyTimes}" fill="freeze"/>`
}
const stepMove = (track: Track, type = 'translate') => {
  const st = steps(track)
  return `<animateTransform attributeName="transform" type="${type}" begin="0s" dur="${D}s" calcMode="discrete" values="${st.values}" keyTimes="${st.keyTimes}" fill="freeze"/>`
}
const shown = (from: number, to = D) => stepAnim('opacity', [[0, 0], [from, 1], [to, 0]])

type Plan = {
  /** When the coin reaches its catch. */
  tc: number
  /** Where the coin ends. */
  target: [number, number]
  poses: [number, string][]
  /** Clawd's height offset, and (sprinting in) his x offset. */
  y: [number, number][]
  x: [number, number][]
  /** Sounds on the timeline, by kind. */
  sounds: [string, number][]
}

const popY = (at: number): [number, number][] => [
  [0, 18],
  [at, 18],
  [at + 0.05, 10],
  [at + 0.1, 3],
  [at + 0.15, -2],
  [at + 0.21, 0],
]
const hop = (at: number): [number, number][] => [
  [at, -2],
  [at + 0.07, -4],
  [at + 0.15, -5],
  [at + 0.23, -3],
  [at + 0.3, 0],
]

// The flip of a close call: when Clawd turns the hourglass over.
const FLIP = 0.75
const STRUMS = [1.3, 1.62, 1.94, 2.4]
// The bubblegum: blown from his face, popped, worn, shaken, then dropped.
const GUM_BLOW = 1.6
const GUM_POP = 2.6
const GUM_SHAKE = 2.9
const GUM_FALL = 3.45
const BUBBLE: [number, number][] = [[1.6, 3], [1.75, 4], [1.9, 5], [2.05, 6], [2.2, 7], [2.32, 8], [2.42, 9], [2.5, 10], [2.55, 9], [2.58, 10]]
// The top hat lands, the monocle goes in, and pops out at the total.
const HAT_ON = 0.4
const MONO_ON = 1.55
const MONO_POP = 2.7

function plan(v: RewardVariant): Plan {
  const p: Plan = { tc: 1.0, target: [CX, CY - 1], poses: [[0, 'idle']], y: popY(0.05), x: [[0, 0]], sounds: [['pop', 0.05]] }
  if (v === 'piggy') {
    p.target = [55, 5]
    p.poses.push([p.tc + 0.1, 'cheer'], [p.tc + 1.7, 'idle'])
    p.y.push(...hop(p.tc + 0.1))
    p.sounds.push(['clink', p.tc], ['oink', p.tc + 0.2])
  } else if (v === 'shades') {
    p.poses.push([p.tc, 'cheer'], [p.tc + 0.38, 'idle'])
    p.y.push(...hop(p.tc), [p.tc + 1.05, 1], [p.tc + 1.15, 0], [p.tc + 1.3, 1], [p.tc + 1.4, 0])
    p.sounds.push(['swish', p.tc + 0.4], ['click', p.tc + 0.6], ['ting', p.tc + 0.9])
  } else if (v === 'mug') {
    p.poses.push([p.tc, 'cheer'], [p.tc + 0.5, 'idle'], [p.tc + 1.0, 'left'], [p.tc + 1.8, 'idle'])
    p.y.push(...hop(p.tc))
    p.sounds.push(['bubble', p.tc + 0.2], ['bubble', p.tc + 0.45], ['bubble', p.tc + 0.7], ['chirp', p.tc + 1.0])
  } else if (v === 'gum') {
    // Chews, blows, and is startled when it pops; shakes his head, then wipes.
    p.poses.push([p.tc, 'cheer'], [p.tc + 0.3, 'idle'], [GUM_POP, 'cheer'], [GUM_POP + 0.2, 'idle'], [GUM_FALL - 0.15, 'wipe'], [GUM_FALL + 0.2, 'idle'])
    p.y.push(...hop(p.tc), [1.32, 1], [1.4, 0], [1.47, 1], [1.55, 0], [GUM_POP, -3], [GUM_POP + 0.08, -1], [GUM_POP + 0.14, 0])
    p.x = [[0, 0], [GUM_SHAKE, 2], [GUM_SHAKE + 0.06, -2], [GUM_SHAKE + 0.12, 2], [GUM_SHAKE + 0.18, -2], [GUM_SHAKE + 0.24, 0]]
    p.sounds.push(['chew', 1.32], ['chew', 1.47], ['inflate', GUM_BLOW], ['bang', GUM_POP], ['shake', GUM_SHAKE], ['plop', GUM_FALL + 0.1])
  } else if (v === 'tophat') {
    // No hopping in a top hat: he tips it at the catch, screws in a monocle,
    // then sees the total and it pops out.
    p.poses.push([p.tc - 0.05, 'right'], [p.tc + 0.35, 'idle'], [MONO_POP, 'cheer'], [MONO_POP + 0.35, 'idle'])
    p.y.push([MONO_POP, -2], [MONO_POP + 0.08, 0])
    p.sounds.push(['plop', HAT_ON + 0.16], ['ting', MONO_ON], ['fancy', MONO_ON + 0.15], ['boing', MONO_POP], ['tink', MONO_POP + 0.32])
  } else if (v === 'hourglass') {
    p.tc = 1.5
    // Clawd sprints in from off the left, reaches, flips, wipes his brow.
    p.y = [[0, 0]]
    p.x = [[0, -48], [0.1, -48], [0.17, -38], [0.24, -28], [0.31, -19], [0.38, -11], [0.45, -5], [0.52, 0]]
    p.poses = [[0, 'idle']]
    for (let t = 0.1, i = 0; t < 0.52; t += 0.07, i++) p.poses.push([t, i % 2 ? 'run2' : 'run1'])
    p.poses.push([0.52, 'idle'], [0.6, 'reach'], [FLIP + 0.2, 'idle'], [FLIP + 0.3, 'wipe'], [FLIP + 0.62, 'idle'], [p.tc, 'cheer'], [p.tc + 1.6, 'idle'])
    p.y.push([0.17, -1], [0.24, 0], [0.31, -1], [0.38, 0], [0.45, -1], [0.52, 0], ...hop(p.tc))
    p.sounds = [['steps', 0.1], ['flip', FLIP], ['phew', FLIP + 0.3]]
    let t = 0
    for (let gap = 0.17; t < FLIP - 0.03; t += gap, gap *= 0.84) p.sounds.push(['tick', t])
  } else {
    p.poses.push([p.tc, 'cheer'], [p.tc + 0.2, 'strum'])
    STRUMS.forEach(t => p.poses.push([t - 0.04, 'strumUp'], [t + 0.06, 'strum']))
    p.poses.push([p.tc + 2.4, 'cheer'], [p.tc + 2.7, 'idle'])
    p.y.push([p.tc, -3], [p.tc + 0.1, 0])
    STRUMS.forEach(t => p.y.push([t, 1], [t + 0.08, 0]))
    STRUMS.forEach((t, i) => p.sounds.push([i === 3 ? 'strumBig' : i % 2 ? 'strumUp' : 'strum', t]))
  }
  p.y.push([D - 0.45, 0], [D - 0.4, 3], [D - 0.35, 10], [D - 0.3, 18])
  p.sounds.push(['duck', D - 0.42])
  return p
}

export const catchTime = (v: RewardVariant) => plan(v).tc

// The coin's path: in from the right, three bounces, then into its catch.
function coinPath(p: Plan) {
  const t0 = p.tc - 0.75
  const dur = p.tc - t0
  const kt = [0, 0.32, 0.52, 0.7, 0.82, 0.92, 1]
  const [tx, ty] = p.target
  const ys = [-8, 17, 5, 17, 10, 17, ty]
  const x0 = 640
  const lands = [1, 3, 5].map(i => ({ t: t0 + kt[i]! * dur, x: x0 + (tx - x0) * kt[i]! }))
  const splines = kt
    .slice(1)
    .map((_, i) => (ys[i + 1]! > ys[i]! ? '0.55 0 1 0.9' : '0 0.1 0.45 1'))
    .join(';')
  return { t0, dur, kt, ys, x0, lands, splines }
}

const plus = (x: number, y: number, begin: number) =>
  `<g class="p" opacity="0"><rect x="${x - 1}" y="${y - 3}" width="2" height="6"/><rect x="${x - 3}" y="${y - 1}" width="6" height="2"/>` +
  `<animate attributeName="opacity" begin="${sec(begin)}" dur="0.4s" values="0;1;1;0" keyTimes="0;0.15;0.5;1" fill="freeze"/></g>`

// A prop that pops up from below beside Clawd, jiggles where asked, and ducks
// with him at the end.
function propGroup(body: string, jiggles: number[] = []): string {
  const y: Track = [[0, '0 16'], [0.15, '0 16'], [0.2, '0 8'], [0.25, '0 0']]
  for (const t of jiggles) y.push([t, '0 -2'], [t + 0.06, '0 1'], [t + 0.12, '0 -1'], [t + 0.18, '0 0'])
  y.push([D - 0.4, '0 0'], [D - 0.35, '0 8'], [D - 0.3, '0 16'])
  return `<g>${stepMove(y)}${body}</g>`
}

const PIG = ['..d..ss.....', '.pppppppppp.', 'dpkpppppppppd', 'ddpppppppppp', '.pppppppppp.', '..d.d..d.d..']
const MUG = ['mbbbbm..', 'mmmmmmh.', 'mmmmmm.h', 'mmmmmm.h', 'mmmmmmh.', '.mmmm...']
// Pink gum all over his face after the pop, one eye peeking out, dripping.
const GUM_FACE = ['...pppppp...', 'pppppppppppp', 'p..ppppppppp', 'pp.ppppppppp', '.p..pdp..pd.', '....d.....d.']

// A disc of radius r, in 2px rows.
function disc(cls: string, cx: number, cy: number, r: number): string {
  let s = ''
  for (let y = -r; y < r; y += 2) {
    const w = Math.round(Math.sqrt(Math.max(0, r * r - (y + 1) * (y + 1))))
    if (w > 0) s += `<rect class="${cls}" x="${cx - w}" y="${cy + y}" width="${2 * w}" height="2"/>`
  }
  return s
}

const HEART ='M0 1h2v-1h2v1h1v-1h2v1h2v2h-1v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1h-1z'

function props(v: RewardVariant, p: Plan): { prop: string; worn: string } {
  const tc = p.tc
  if (v === 'piggy') {
    const sparkles = [[46, 4], [64, 6], [42, 14], [68, 15]].map(([x, y], i) => plus(x!, y!, tc + 0.12 + i * 0.07)).join('')
    return { prop: propGroup(grid('pig', 42, 9, PIG), [tc + 0.08, tc + 0.5]) + sparkles, worn: '' }
  }
  if (v === 'shades') {
    // Inside Clawd's group, so they ride his hops; they drop onto his eyes.
    const lenses =
      `<rect class="k" x="${X0 + 7}" y="7" width="8" height="4"/><rect class="k" x="${X0 + 21}" y="7" width="8" height="4"/>` +
      `<rect class="k" x="${X0 + 15}" y="8" width="6" height="1"/><rect class="k" x="${X0 + 4}" y="8" width="3" height="1"/><rect class="k" x="${X0 + 29}" y="8" width="3" height="1"/>` +
      `<rect class="kh" x="${X0 + 8}" y="7" width="2" height="1"/><rect class="kh" x="${X0 + 22}" y="7" width="2" height="1"/>`
    const drop = stepMove([[0, '0 -16'], [tc + 0.4, '0 -16'], [tc + 0.47, '0 -9'], [tc + 0.54, '0 -3'], [tc + 0.6, '0 0']])
    const glint =
      `<rect class="g" x="${X0 + 7}" y="7" width="2" height="4" opacity="0">` +
      `<animate attributeName="opacity" begin="${sec(tc + 0.9)}" dur="0.3s" values="0;1;1;0" fill="freeze"/>` +
      `<animate attributeName="x" begin="${sec(tc + 0.9)}" dur="0.3s" calcMode="discrete" values="${[7, 10, 13, 21, 24, 27].map(x => X0 + x).join(';')}" fill="freeze"/></rect>`
    const sparkle = plus(X0 + 36, 4, tc + 1.15)
    return { prop: sparkle, worn: `<g opacity="0">${shown(tc + 0.4)}<g>${drop}${lenses}${glint}</g></g>` }
  }
  if (v === 'mug') {
    let steam = ''
    ;[47, 51, 55].forEach((x, i) => {
      for (const k of [0, 1]) {
        const b = tc + 0.15 + i * 0.12 + k * 0.42
        steam +=
          `<g class="s" opacity="0"><rect x="${x}" y="5" width="2" height="2"/><rect x="${x + 1}" y="2" width="2" height="2"/>` +
          `<animate attributeName="opacity" begin="${sec(b)}" dur="0.5s" values="0;1;1;0" fill="freeze"/>` +
          `<animateTransform attributeName="transform" type="translate" begin="${sec(b)}" dur="0.5s" calcMode="discrete" values="0 2;1 0;0 -2;-1 -4" fill="freeze"/></g>`
      }
    })
    const heart =
      `<g class="h" opacity="0"><path transform="translate(47 2)" d="${HEART}"/>` +
      `<animate attributeName="opacity" begin="${sec(tc + 1.0)}" dur="1.2s" values="0;1;1;0" keyTimes="0;0.1;0.7;1" fill="freeze"/>` +
      `<animateTransform attributeName="transform" type="translate" begin="${sec(tc + 1.0)}" dur="1.2s" calcMode="discrete" values="0 3;1 1;0 -1;1 -3;0 -5" fill="freeze"/></g>`
    return { prop: propGroup(grid('mug', 44, 9, MUG)) + steam + heart, worn: '' }
  }
  if (v === 'gum') {
    // Worn, so the bubble rides his chewing: one disc a size, each shown
    // until the next, the last until the pop.
    const bubble = BUBBLE.map(([t, r], i) => {
      const cx = 30 + r
      const shine = r >= 5 ? `<rect class="bh" x="${cx - Math.round(r / 2) - 1}" y="${13 - Math.round(r / 2) - 1}" width="2" height="2"/>` : ''
      return `<g opacity="0">${stepAnim('opacity', [[0, 0], [t, 1], [BUBBLE[i + 1]?.[0] ?? GUM_POP, 0]])}${disc('bu', cx, 13, r)}${shine}</g>`
    }).join('')
    const face = stepMove([[0, '0 0'], [GUM_FALL, '0 2'], [GUM_FALL + 0.06, '0 6'], [GUM_FALL + 0.12, '0 11'], [GUM_FALL + 0.18, '0 17']])
    const splat = `<g opacity="0">${shown(GUM_POP, GUM_FALL + 0.24)}<g>${face}${grid('gu', 8, 4, GUM_FACE)}</g></g>`
    const bits = [[-16, -7], [-6, -10], [8, -9], [16, -3], [14, 6], [-12, 6], [20, 2], [4, 8]]
      .map(
        ([dx, dy]) =>
          `<rect class="bu" x="39" y="11" width="3" height="3" opacity="0">` +
          `<animate attributeName="opacity" begin="${sec(GUM_POP)}" dur="0.35s" values="1;1;0" fill="freeze"/>` +
          `<animateTransform attributeName="transform" type="translate" begin="${sec(GUM_POP)}" dur="0.35s" calcMode="discrete" values="0 0;${dx! / 2} ${dy! / 2};${dx} ${dy}" fill="freeze"/></rect>`,
      )
      .join('')
    return { prop: bits, worn: bubble + splat }
  }
  if (v === 'tophat') {
    // Worn: the hat drops onto his head and tips at the catch; the monocle
    // goes in, then pops out and falls away.
    const hat =
      '<rect class="hk" x="14" y="0" width="12" height="4"/><rect class="hh" x="14" y="0" width="12" height="1"/><rect class="hh" x="14" y="1" width="1" height="2"/>' +
      '<rect class="hb" x="14" y="3" width="12" height="1"/><rect class="hk" x="10" y="4" width="20" height="2"/><rect class="hh" x="10" y="4" width="20" height="1"/>'
    const tip = stepMove([
      [0, '0 -12'],
      [HAT_ON, '0 -12'],
      [HAT_ON + 0.06, '0 -7'],
      [HAT_ON + 0.12, '0 -2'],
      [HAT_ON + 0.16, '0 0'],
      [tc - 0.05, '1 -2'],
      [tc + 0.02, '2 -4'],
      [tc + 0.25, '1 -2'],
      [tc + 0.32, '0 0'],
    ])
    const monocle =
      '<rect class="mg" x="25" y="7" width="4" height="5"/>' +
      '<rect class="mo" x="25" y="6" width="4" height="1"/><rect class="mo" x="25" y="12" width="4" height="1"/><rect class="mo" x="24" y="7" width="1" height="5"/><rect class="mo" x="29" y="7" width="1" height="5"/>' +
      '<rect class="mo" x="30" y="13" width="1" height="1"/><rect class="mo" x="31" y="15" width="1" height="1"/><rect class="mo" x="31" y="17" width="1" height="1"/>'
    const fall = stepMove([
      [0, '0 0'],
      [MONO_POP, '0 -3'],
      [MONO_POP + 0.06, '2 -5'],
      [MONO_POP + 0.12, '4 -3'],
      [MONO_POP + 0.2, '5 2'],
      [MONO_POP + 0.28, '6 8'],
      [MONO_POP + 0.36, '6 16'],
    ])
    const glint =
      `<rect class="g" x="25" y="7" width="1" height="5" opacity="0">` +
      `<animate attributeName="opacity" begin="${sec(MONO_ON)}" dur="0.3s" values="0;1;1;0" fill="freeze"/>` +
      `<animate attributeName="x" begin="${sec(MONO_ON)}" dur="0.3s" calcMode="discrete" values="25;26;27;28" fill="freeze"/></rect>`
    const worn = `<g opacity="0">${shown(HAT_ON)}<g>${tip}${hat}</g></g><g opacity="0">${shown(MONO_ON, MONO_POP + 0.4)}<g>${fall}${monocle}${glint}</g></g>`
    return { prop: plus(X0 + 36, 4, MONO_ON + 0.1) + plus(X0 + 40, 14, MONO_POP + 0.05), worn }
  }
  if (v === 'hourglass') {
    // Nearly run out: a grain of sand left on top, a full pile below; turned
    // over, the full side is on top again.
    const glass =
      '<rect class="f" x="45" y="2" width="14" height="2"/><rect class="f" x="45" y="18" width="14" height="2"/>' +
      '<rect class="gl" x="47" y="4" width="10" height="3"/><rect class="gl" x="49" y="7" width="6" height="2"/><rect class="gl" x="51" y="9" width="2" height="2"/>' +
      '<rect class="gl" x="49" y="11" width="6" height="2"/><rect class="gl" x="47" y="13" width="10" height="5"/>' +
      '<rect class="sd" x="51" y="8" width="2" height="1"/><rect class="sd" x="49" y="12" width="6" height="1"/><rect class="sd" x="47" y="13" width="10" height="5"/>'
    const stream =
      `<rect class="sd" x="51.5" y="10" width="1" height="3">` +
      `<animate attributeName="opacity" begin="0s" dur="0.2s" repeatCount="22" calcMode="discrete" values="1;0.3"/></rect>`
    const flip = stepMove(
      [
        [0, '0 52 11'],
        [FLIP, '45 52 11'],
        [FLIP + 0.05, '90 52 11'],
        [FLIP + 0.1, '135 52 11'],
        [FLIP + 0.15, '180 52 11'],
      ],
      'rotate',
    )
    const sweat =
      `<rect class="w" x="${X0 + 32}" y="5" width="2" height="3" opacity="0"><animate attributeName="opacity" begin="${sec(FLIP + 0.35)}" dur="0.5s" values="0;1;0" fill="freeze"/>` +
      `<animateTransform attributeName="transform" type="translate" begin="${sec(FLIP + 0.35)}" dur="0.5s" values="0 0;5 -3;9 1;12 8" fill="freeze"/></rect>`
    const duck = stepMove([[0, '0 0'], [D - 0.4, '0 0'], [D - 0.35, '0 8'], [D - 0.3, '0 24']])
    return { prop: `<g>${duck}<g>${flip}${glass}${stream}</g></g>${plus(62, 5, FLIP + 0.18)}`, worn: sweat }
  }
  const guitar =
    `<g opacity="0">${shown(tc + 0.2, tc + 2.4)}` +
    '<rect class="gn" x="4" y="8" width="3" height="2"/><rect class="gn" x="6" y="10" width="3" height="2"/><rect class="gn" x="8" y="12" width="3" height="2"/><rect class="gn" x="10" y="14" width="3" height="2"/>' +
    '<rect class="gb" x="12" y="13" width="10" height="6"/><rect class="gb" x="14" y="12" width="6" height="8"/><rect class="e" x="15" y="15" width="3" height="2"/>' +
    '<rect class="gn" x="1" y="6" width="4" height="3"/></g>'
  const notes = STRUMS.map((t, i) => {
    const dx = 42 + i * 8
    return (
      `<g class="n" opacity="0"><rect x="${dx}" y="12" width="2" height="7"/><rect x="${dx - 3}" y="17" width="4" height="3"/><rect x="${dx + 2}" y="12" width="3" height="2"/>` +
      `<animate attributeName="opacity" begin="${sec(t)}" dur="0.9s" values="0;1;1;0" keyTimes="0;0.1;0.6;1" fill="freeze"/>` +
      `<animateTransform attributeName="transform" type="translate" begin="${sec(t)}" dur="0.9s" values="0 2;3 -2;5 -6;8 -10" calcMode="discrete" fill="freeze"/></g>`
    )
  }).join('')
  return { prop: notes, worn: guitar }
}

// Restarts the image's clock `ago` seconds in: what a redraw's image needs to
// pick up where the last one was.
function shifted(svg: string, ago: number): string {
  return ago <= 0 ? svg : svg.replace(/begin="([\d.]+)s"/g, (_, t: string) => `begin="${sec(Number(t) - ago)}"`)
}

export function rewardSvg(at: number, v: RewardVariant, elapsedMs = 0): string {
  const p = plan(v)
  const c = coinPath(p)
  const [tx, ty] = p.target
  let poses = ''
  for (const name of new Set(p.poses.map(s => s[1]))) poses += `<g opacity="0">${stepAnim('opacity', p.poses.map(([t, n]) => [t, n === name ? 1 : 0]))}${sprite(POSES[name]!)}</g>`
  const { prop, worn } = props(v, p)
  const clawd = `<g>${stepMove(p.x.map(([t, x]) => [t, `${x} 0`]))}<g>${stepMove(p.y.map(([t, y]) => [t, `0 ${y}`]))}${poses}${worn}</g></g>`

  // The catch: square rings closing out from the coin, sparkles around it.
  const rings = [3, 7, 11]
    .map((r, k) => `<rect class="r" x="${tx - r}" y="${ty - r}" width="${2 * r}" height="${2 * r}" fill="none" stroke-width="2" opacity="0"><set attributeName="opacity" begin="${sec(p.tc + k * 0.06)}" dur="0.07s" to="1"/></rect>`)
    .join('')
  const sparks = [[tx + 21, 4], [tx + 28, 15], [tx + 12, 2], [tx + 36, 7], [tx + 17, 18]].map(([x, y], i) => plus(x!, y!, p.tc + 0.04 + i * 0.07)).join('')
  const puffs = c.lands
    .map(
      ({ t, x }) =>
        `<g class="d" opacity="0"><rect x="${(x - 6).toFixed(0)}" y="19" width="2" height="2"/><rect x="${(x + 4).toFixed(0)}" y="19" width="2" height="2"/>` +
        `<animate attributeName="opacity" begin="${sec(t)}" dur="0.3s" values="0;1;0" fill="freeze"/>` +
        `<animateTransform attributeName="transform" type="translate" begin="${sec(t)}" dur="0.3s" values="0 0;0 -2" fill="freeze"/></g>`,
    )
    .join('')
  const coin =
    `<g opacity="0">${stepAnim('opacity', [[0, 0], [c.t0, 1], [p.tc + (v === 'piggy' ? 0.08 : 0), 0]])}` +
    `<animateTransform attributeName="transform" type="translate" begin="${sec(c.t0)}" dur="${sec(c.dur)}" values="${c.x0} 0;${tx} 0" fill="freeze"/>` +
    `<g><animateTransform attributeName="transform" type="translate" begin="${sec(c.t0)}" dur="${sec(c.dur)}" values="${c.ys.map(y => `0 ${y}`).join(';')}" keyTimes="${c.kt.join(';')}" calcMode="spline" keySplines="${c.splines}" fill="freeze"/>` +
    '<rect class="c" x="-4" y="-3" width="8" height="6"/><rect class="c" x="-3" y="-4" width="6" height="8"/><rect class="cd" x="-1" y="-2" width="2" height="4"/><rect class="ch" x="-3" y="-3" width="2" height="2"/>' +
    `<animateTransform attributeName="transform" type="scale" begin="${sec(c.t0)}" dur="0.32s" repeatCount="indefinite" calcMode="discrete" values="1 1;0.5 1;0.2 1;0.5 1" additive="sum"/></g></g>`

  const body = shifted(prop + clawd + rings + sparks + puffs + coin, elapsedMs / 1000)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${REWARD_H}" width="${W}" height="${REWARD_H}" preserveAspectRatio="xMinYMid slice" shape-rendering="crispEdges"><!-- reward ${at} -->` +
    '<style>.o{fill:#d97757}.e{fill:#1f1e1d}.c{fill:#f2c14e}.cd{fill:#c8961c}.ch{fill:#fff6d6}.p{fill:#ffe9a8}.d{fill:#e3b341}.r{stroke:#ffe08a}' +
    '.w{fill:#8fc7ff}.h{fill:#ff6b8a}.n{fill:#e3b341}.gb{fill:#f3e3c3}.gn{fill:#4a2f1a}' +
    '.k{fill:#111}.kh{fill:#5a6a7a}.g{fill:#fff}.f{fill:#8a5a2b}.gl{fill:#cfe8ff;fill-opacity:.35}.sd{fill:#e3b341}.s{fill:#c9c9c9}' +
    '.pigp{fill:#f4a6b8}.pigd{fill:#d9758f}.pigk{fill:#1f1e1d}.pigs{fill:#7a3a4a}.mugm{fill:#f3e3c3}.mugb{fill:#6b4226}.mugh{fill:#f3e3c3}' +
    '.bu,.gup{fill:#ff8fc8}.bh{fill:#ffe3f1}.gud{fill:#e0609e}.hk{fill:#4a4a5c}.hh{fill:#8a8aa0}.hb{fill:#c0392b}.mo{fill:#e3b341}.mg{fill:#cfe8ff;fill-opacity:.35}' +
    '@media (prefers-color-scheme:light){.p{fill:#d9a227}.d{fill:#d9a227}.r{stroke:#d9a227}.n{fill:#b07d10}.s{fill:#9a998f}.gl{fill:#7fa7c9}.mugm,.mugh{fill:#e6d3ad}.hk{fill:#26262e}.hh{fill:#5a5a6e}.mo{fill:#b07d10}.mg{fill:#7fa7c9}}' +
    '</style>' +
    body +
    '</svg>'
  )
}

// The amount saved, rolling up like an odometer from the catch: each digit
// spins through its column and settles, the rightmost last; then a glint.
const ODO_H = 20
const advance = (ch: string) => (/\d/.test(ch) ? 8.6 : ch === '.' || ch === ',' ? 4.4 : 8.6)
export function odometerSvg(at: number, value: string, delay: number, elapsedMs = 0): { source: string; width: number } {
  const ago = elapsedMs / 1000
  const d = (s: number) => `${(s - ago).toFixed(3)}s`
  let x = 1
  let cols = ''
  let css = ''
  let di = 0
  const digits = [...value].filter(ch => /\d/.test(ch)).length
  for (const ch of value) {
    if (/\d/.test(ch)) {
      let stack = ''
      for (let k = 0; k < 20; k++) stack += `<text x="${x.toFixed(1)}" y="${15 + k * ODO_H}">${k % 10}</text>`
      const dur = 0.7 + (di / Math.max(1, digits - 1)) * 0.8
      css += `.c${di}{animation:r${di} ${dur.toFixed(2)}s cubic-bezier(.15,.75,.2,1) ${d(delay)} both}@keyframes r${di}{from{transform:translateY(0)}to{transform:translateY(-${(Number(ch) + 10) * ODO_H}px)}}`
      cols += `<g class="c${di}">${stack}</g>`
      di += 1
    } else cols += `<text x="${x.toFixed(1)}" y="15">${ch}</text>`
    x += advance(ch)
  }
  const width = Math.ceil(x + 1)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${ODO_H}" width="${width}" height="${ODO_H}"><!-- odometer ${at} -->` +
    '<style>text{font:600 14px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;font-variant-numeric:tabular-nums;fill:#e3b341}' +
    '@media (prefers-color-scheme:light){text{fill:#9a6b06}}' +
    `.glint{animation:glint .7s ease-in-out ${d(delay + 1.6)} both}@keyframes glint{from{transform:translateX(-30px);opacity:1}to{transform:translateX(${width + 10}px);opacity:1}}` +
    `.odo{animation:in .12s linear ${d(delay)} both}@keyframes in{from{opacity:0}to{opacity:1}}` +
    css +
    '</style>' +
    `<defs><clipPath id="w"><rect y="3" width="${width}" height="${ODO_H - 5}"/></clipPath>` +
    '<linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    `<mask id="t" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${ODO_H}"><g>${cols}</g></mask></defs>` +
    `<g class="odo" clip-path="url(#w)">${cols}<g mask="url(#t)"><rect class="glint" x="0" y="0" width="24" height="${ODO_H}" fill="url(#gl)" opacity="0"/></g></g></svg>`
  return { source, width }
}

// The soundtrack, sample by sample, on the same clock as the drawing.
export const SAMPLE_RATE = 22050
export function rewardSamples(v: RewardVariant): Float32Array {
  const SR = SAMPLE_RATE
  const p = plan(v)
  const c = coinPath(p)
  const out = new Float32Array(Math.ceil(SR * D))
  const add = (at: number, len: number, fn: (t: number) => number) => {
    const i0 = Math.round(at * SR)
    for (let i = 0; i < len * SR && i0 + i < out.length; i++) if (i0 + i >= 0) out[i0 + i]! += fn(i / SR)
  }
  const blip = (at: number, f0: number, f1: number, len: number, g: number, buzz = 0) => {
    let ph = 0
    add(at, len, t => {
      ph += (2 * Math.PI * (f0 + (f1 - f0) * (t / len))) / SR
      const s = Math.sin(ph) + buzz * Math.sin(2 * ph) + buzz * 0.5 * Math.sin(3 * ph)
      return g * s * Math.min(1, t / 0.004) * Math.pow(1 - t / len, 2)
    })
  }
  const bell = (at: number, f: number, g: number, len = 1.2) =>
    add(at, len, t => g * Math.min(1, t / 0.003) * Math.exp(-t / (len / 4)) * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.01 * t) * Math.exp(-t / 0.08)))
  let seed = 7
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const hiss = (at: number, len: number, g: number, smooth: number) => {
    let lp = 0
    add(at, len, t => ((lp += smooth * (noise() - lp)), g * lp * Math.sin((Math.PI * t) / len)))
  }
  const pluck = (at: number, f: number, g: number, len = 1.8) => {
    const n = Math.round(SR / f)
    const buf = Array.from({ length: n }, noise)
    let k = 0
    add(at, len, t => {
      const s = buf[k % n]!
      buf[k % n] = 0.5 * (s + buf[(k + 1) % n]!) * 0.997
      k++
      return g * s * Math.min(1, (len - t) / 0.2)
    })
  }
  const G = [98, 123.47, 146.83, 196, 246.94, 392]
  const C = [130.81, 164.81, 196, 261.63, 329.63, 392]
  for (const [kind, t] of p.sounds) {
    if (kind === 'pop') blip(t, 320, 880, 0.07, 0.12)
    if (kind === 'duck') blip(t, 700, 260, 0.09, 0.08)
    if (kind === 'chirp') {
      blip(t, 1500, 2200, 0.05, 0.06)
      blip(t + 0.07, 1700, 2600, 0.06, 0.06)
    }
    if (kind === 'clink') {
      bell(t + 0.06, 2637, 0.1, 0.5)
      bell(t + 0.12, 3136, 0.08, 0.5)
    }
    if (kind === 'oink') {
      blip(t, 260, 210, 0.09, 0.1, 0.6)
      blip(t + 0.13, 280, 220, 0.11, 0.1, 0.6)
    }
    if (kind === 'swish') hiss(t, 0.18, 0.5, 0.35)
    if (kind === 'click') add(t, 0.012, s => 0.15 * noise() * (1 - s / 0.012))
    if (kind === 'ting') bell(t, 3520, 0.07, 0.6)
    if (kind === 'bubble') blip(t, 480 + ((t * 997) % 1) * 300, 900, 0.05, 0.05)
    if (kind === 'tick') add(t, 0.01, s => 0.12 * noise() * (1 - s / 0.01))
    if (kind === 'steps') for (let k = 0; k < 6; k++) blip(t + k * 0.07, 140, 90, 0.04, 0.08)
    if (kind === 'flip') {
      hiss(t, 0.15, 0.4, 0.25)
      blip(t + 0.15, 180, 120, 0.06, 0.12)
    }
    if (kind === 'phew') hiss(t, 0.3, 0.25, 0.1)
    if (kind === 'strum') G.forEach((f, i) => pluck(t + i * 0.012, f, 0.09))
    if (kind === 'strumUp') [...C].reverse().forEach((f, i) => pluck(t + i * 0.01, f, 0.08))
    if (kind === 'strumBig') G.forEach((f, i) => pluck(t + i * 0.02, f, 0.11, 2.0))
    if (kind === 'chew') blip(t, 170, 120, 0.07, 0.08, 0.5)
    if (kind === 'inflate') {
      // A rubbery squeak rising with the bubble, cut off by the pop.
      const len = GUM_POP - t
      let ph = 0
      add(t, len, s => {
        ph += (2 * Math.PI * (260 + 520 * Math.pow(s / len, 1.4)) * (1 + 0.03 * Math.sin(2 * Math.PI * 7 * s))) / SR
        return 0.05 * Math.min(1, s / 0.1) * (Math.sin(ph) + 0.4 * Math.sin(2 * ph))
      })
    }
    if (kind === 'bang') {
      add(t, 0.08, s => 0.45 * noise() * Math.exp(-s / 0.02))
      blip(t, 180, 60, 0.14, 0.2)
      blip(t + 0.05, 600, 150, 0.14, 0.08, 0.8)
    }
    if (kind === 'shake') for (let k = 0; k < 4; k++) blip(t + k * 0.06, k % 2 ? 330 : 280, k % 2 ? 260 : 220, 0.05, 0.06, 0.6)
    if (kind === 'plop') {
      blip(t, 240, 120, 0.08, 0.12)
      add(t, 0.01, s => 0.08 * noise() * (1 - s / 0.01))
    }
    if (kind === 'fancy') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => pluck(t + i * 0.09, f, 0.08, 0.7))
    if (kind === 'boing') {
      let ph = 0
      add(t, 0.5, s => {
        ph += (2 * Math.PI * 240 * (1 + 0.8 * Math.exp(-s / 0.12)) * (1 + 0.18 * Math.sin(2 * Math.PI * 16 * s) * Math.exp(-s / 0.25))) / SR
        return 0.12 * Math.min(1, s / 0.005) * Math.exp(-s / 0.18) * Math.sin(ph)
      })
    }
    if (kind === 'tink') bell(t, 4186, 0.06, 0.4)
  }
  c.lands.forEach(({ t }, i) => blip(t, 900 + i * 220, 1100 + i * 260, 0.03, 0.09))
  bell(p.tc, 1318.5, 0.2)
  bell(p.tc + 0.08, 1975.5, 0.17)
  // The counter's wheel clicking as it slows.
  let tk = p.tc + 0.05
  for (let i = 0; i < 14; i++) {
    add(tk, 0.006, t => 0.05 * noise() * (1 - t / 0.006))
    tk += 0.03 * Math.pow(1.17, i)
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]! * 1.2)
  return out
}

export function wav(samples: Float32Array): Uint8Array {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const s = (o: number, t: string) => [...t].forEach((ch, i) => b.setUint8(o + i, ch.charCodeAt(0)))
  s(0, 'RIFF')
  b.setUint32(4, 36 + samples.length * 2, true)
  s(8, 'WAVEfmt ')
  b.setUint32(16, 16, true)
  b.setUint16(20, 1, true)
  b.setUint16(22, 1, true)
  b.setUint32(24, SAMPLE_RATE, true)
  b.setUint32(28, SAMPLE_RATE * 2, true)
  b.setUint16(32, 2, true)
  b.setUint16(34, 16, true)
  s(36, 'data')
  b.setUint32(40, samples.length * 2, true)
  samples.forEach((v, i) => b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true))
  return new Uint8Array(b.buffer)
}
