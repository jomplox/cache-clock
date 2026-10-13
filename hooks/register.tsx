import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, PluginOptions, PromptOrigin, Register } from 'claude-code'

import type { AgentCache, CacheInfo, KeepWarm, OtherChat, Reward, RewardVariant, WorkflowRun } from '../types'
import { REWARD_EVERYDAY, REWARD_H, REWARD_MS, REWARD_ROOM, REWARD_VARIANTS, catchTime, odometerSvg, rewardSvg } from './reward'

// How Claude Code caches: code.claude.com/docs/en/prompt-caching
const cache = atom({ plugin: 'cache-clock', key: 'cache' } as const, null)
// The session's model since the last switch; null until one happens.
const model = atom({ plugin: 'cache-clock', key: 'model' } as const, null)
// Subagents' caches by agent id; each has its own prefix and, by default, 5m.
const agents = atom({ plugin: 'cache-clock', key: 'agents' } as const, {})
const keepWarm = atom({ plugin: 'cache-clock', key: 'keepWarm' } as const, { isOn: null, refreshes: 0 })
const miss = atom({ plugin: 'cache-clock', key: 'miss' } as const, null)
const others = atom({ plugin: 'cache-clock', key: 'others' } as const, [])
const alertedAt = atom({ plugin: 'cache-clock', key: 'alertedAt' } as const, null)
// This chat's stats switch: null follows the `stats` option.
const showStats = atom({ plugin: 'cache-clock', key: 'showStats' } as const, null)
// The last time this chat's prefix was written to cache from scratch.
const minted = atom({ plugin: 'cache-clock', key: 'minted' } as const, null)
const runs = atom({ plugin: 'cache-clock', key: 'runs' } as const, {})
// The last typed message that reused the warm cache.
const reward = atom({ plugin: 'cache-clock', key: 'reward' } as const, null)

// Main-conversation TTL until the transcript says otherwise: one hour on a
// subscription within plan usage.
const DEFAULT_TTL = 60
const AGENT_TTL = 5

// The one message a keep-warm refresh appends after the conversation; the
// reply is discarded.
const PING = 'Automatic keep-alive from the cache-clock mod, sent only to refresh the prompt cache. Reply with just: ok'

// Each session publishes its cache under `chat:<session id>` in the store.
const CHAT_KEY = 'chat:'
const DAY = 24 * 3_600_000
// From this width subagents sit two to a row.
const WIDE = 110

// Other chats that went cold longer ago than this are left out of the band.
const COLD_SHOWN = 2 * 3_600_000

// Keep-warm refreshes this long before expiry; the alert fires this long before.
const refreshLead = (ttlMin: number) => Math.min(2, ttlMin / 5) * 60_000
const alertLead = (ttlMin: number) => Math.min(5, ttlMin / 5) * 60_000

type Settings = { keepWarm: boolean; keepWarmMax: number; alert: string; otherChats: boolean; stats: boolean; reward: string }

function settings(options: PluginOptions): Settings {
  return {
    keepWarm: options.keepWarm === true,
    keepWarmMax: typeof options.keepWarmMax === 'number' ? Math.max(0, options.keepWarmMax) : 3,
    alert: typeof options.alert === 'string' ? options.alert : 'toast+sound',
    otherChats: options.otherChats !== false,
    stats: options.stats !== false,
    reward: typeof options.reward === 'string' ? options.reward : 'animation+sound',
  }
}

// What the session's hooks share outside $.state: reset on each module load.
type Flags = {
  isRunning: boolean
  isForking: boolean
  sessionId: string
  transcript: string
  label: string
  published: string
  ticks: number
  /** The ids `$.agent.list()` last named; null until it has answered once. */
  listed: Set<string> | null
  /** This chat's cache record from its transcript; null until read. */
  stats: ChatStats | null
  statsAt: number
  /** Keep-warm refreshes that failed in a row. */
  failures: number
  /** Each workflow agent's run id, by agent id. */
  runOf: Map<string, string>
  /** Until when /cache-clock-demo replays the new-cache animation, or the rewards. */
  demoUntil: number
  demoKind: 'mint' | 'reward'
  demoIndex: number
  /** The person typed the prompt the next turn answers. */
  isTyped: boolean
  // The reward's sound while it plays, so a takeback or the next one stops it.
  jingle: AbortController | null
}

// The main conversation's requests, from its transcript: what they read from
// cache, how often the cache was written again whole, and the pauses between them.
type ChatStats = {
  read: number
  total: number
  rebuilds: number
  rewritten: number
  /** Every pause, shortest first. */
  pauses: number[]
  /** The last requests, oldest first: prompt size, share read from cache. */
  requests: { at: number; total: number; read: number; isRebuild: boolean }[]
  /** The last pauses, oldest first. */
  gaps: { at: number; ms: number }[]
}

// Requests and pauses the charts draw, the most recent.
const CHART_REQUESTS = 60
const CHART_GAPS = 30

// One line per distinct request (epoch seconds, uncached input, cache read,
// cache write) and per prompt of the person's (epoch seconds, "U").
const STATS_SCRIPT = `PATH=/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin
grep -hE '"cache_read_input_tokens"|"type":"user"' "$1" 2>/dev/null | grep -v '"isSidechain":true' |
jq -Rr 'def ts: .timestamp | sub("\\\\.[0-9]+Z$"; "Z") | fromdateiso8601;
  fromjson? |
  if .type == "assistant" and .message.usage and .message.model != "<synthetic>" then
    .message.usage as $u
    | [(.message.id // .requestId // ""), ts,
       ($u.input_tokens // 0), ($u.cache_read_input_tokens // 0), ($u.cache_creation_input_tokens // 0)] | @tsv
  elif .type == "user" and .isMeta != true and .isCompactSummary != true
    and ((.message.content | type) == "string" or ([.message.content[]? | select(.type == "tool_result")] | length) == 0) then
    ["", ts, "U"] | @tsv
  else empty end' |
awk -F'\t' '$1 == "" || !seen[$1]++ { print $2 "\t" $3 "\t" $4 "\t" $5 }'`

// Stats are read again at most this often: a long transcript takes seconds.
const STATS_EVERY = 5 * 60_000

function parseStats(stdout: string): ChatStats | null {
  const stats: ChatStats = { read: 0, total: 0, rebuilds: 0, rewritten: 0, pauses: [], requests: [], gaps: [] }
  let last: number | null = null
  let isPrompted = false
  for (const line of stdout.split('\n')) {
    const fields = line.split('\t')
    const sec = Number(fields[0])
    if (!sec) continue
    if (fields[1] === 'U') {
      isPrompted = true
      continue
    }
    const [input, hit, write] = fields.slice(1).map(Number)
    const at = sec * 1000
    const all = (input || 0) + (hit || 0) + (write || 0)
    // Past the first request, one that wrote most of a sizeable prompt found
    // its cache gone: expired, compacted, or another model's.
    const isRebuild = last !== null && all >= 4096 && (write || 0) > all / 2
    if (isRebuild) {
      stats.rebuilds += 1
      stats.rewritten += write || 0
    }
    stats.requests.push({ at, total: all, read: hit || 0, isRebuild })
    // A pause: from the last request before a prompt of the person's to the
    // first after it, start to start, as the cache's TTL counts it.
    if (isPrompted && last !== null) {
      stats.pauses.push(at - last)
      stats.gaps.push({ at, ms: at - last })
    }
    isPrompted = false
    stats.read += hit || 0
    stats.total += all
    last = at
  }
  stats.pauses.sort((a, b) => a - b)
  stats.requests = stats.requests.slice(-CHART_REQUESTS)
  stats.gaps = stats.gaps.slice(-CHART_GAPS)
  return stats.total > 0 ? stats : null
}

async function refreshStats($: EngineInterface, flags: Flags, isForced = false): Promise<void> {
  if (!flags.transcript) return
  const now = await $.clock.now()
  if (!isForced && now - flags.statsAt < STATS_EVERY) return
  flags.statsAt = now
  const out = await $.process.run(['/bin/sh', '-c', STATS_SCRIPT, 'sh', flags.transcript]).catch(() => null)
  if (out && out.exitCode === 0 && !out.isStdoutTruncated) flags.stats = parseStats(out.stdout) ?? flags.stats
}

// API list prices, for the stats' comparisons: base input $/MTok and what a
// cache read costs as a share of it. A write costs 2× base (1h) or 1.25× (5m).
const PRICES: [RegExp, number, number][] = [
  [/fable-5-1|mythos-5-1/, 10, 0.025],
  [/fable|mythos/, 10, 0.1],
  [/opus-5-5/, 4, 0.05],
  [/opus/, 5, 0.1],
  [/sonnet-4/, 3, 0.1],
  [/sonnet/, 2, 0.1],
  [/haiku-5/, 0.1, 0.1],
  [/haiku/, 1, 0.1],
]

function price(modelId: string | undefined | null): { base: number | null; read: number } {
  const hit = modelId ? PRICES.find(([re]) => re.test(modelId)) : undefined
  return hit ? { base: hit[1], read: hit[2] } : { base: null, read: 0.1 }
}

const writeMult = (ttlMin: number) => (ttlMin === 60 ? 2 : 1.25)

// "4m", "1h 20m".
function duration(ms: number): string {
  const m = Math.round(ms / 60_000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

// Charts for the stats box, as SVG images: an interactive frame would give
// tooltips, but Desktop reloads it on each redraw of the band (every second)
// and it blinks. Every chart is 1000 units wide, stretched to its slot
// (preserveAspectRatio none), so nothing in it may mind being stretched:
// bars, and lines that keep their stroke. Colors from the dataviz reference palette: the series blue per
// theme, status "serious" for what went wrong, a recessive gray for guides.
const CHART_H = 34
const chartCache = new WeakMap<ChatStats, Map<string, string>>()
function chart(stats: ChatStats, key: string, draw: () => string): string {
  let byKey = chartCache.get(stats)
  if (!byKey) chartCache.set(stats, (byKey = new Map()))
  let svg = byKey.get(key)
  if (svg === undefined) byKey.set(key, (svg = draw()))
  return svg
}
const CHART_STYLE = `<style>
  svg { color-scheme: light dark; --bar: #2a78d6; --bad: #ec835a; --guide: rgba(120,120,115,.45); --track: rgba(120,120,115,.14) }
  @media (prefers-color-scheme: dark) { svg { --bar: #3987e5; --guide: rgba(195,194,183,.35); --track: rgba(195,194,183,.06) } }
  .b { fill: var(--bar); opacity: .8 } .b.x { fill: var(--bad); opacity: .95 }
  .t { fill: var(--track) }
  .r { stroke: var(--guide); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke }
  .a { fill: var(--bar); opacity: .18 } .l { fill: none; stroke: var(--bar); stroke-width: 1.5; vector-effect: non-scaling-stroke }
</style>`

const svgDoc = (w: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${CHART_H}" width="1000" height="${CHART_H}" preserveAspectRatio="none">${CHART_STYLE}<g transform="scale(${(1000 / w).toFixed(4)} 1)">${body}</g></svg>`

// Bars, right-aligned in at least `slots` places so a few stay thin; each a
// faint track and the bar from the baseline.
function barChart(values: { h: number; isBad: boolean }[], slots: number, guide?: number): string {
  const n = Math.max(values.length, slots)
  const w = n * 10
  const offset = n - values.length
  const bars = values
    .map((v, i) => {
      const x = (offset + i) * 10 + 1.5
      const h = Math.max(1.5, Math.min(1, v.h) * (CHART_H - 2))
      return `<rect class="t" x="${x}" y="0" width="7" height="${CHART_H}"/><rect class="b${v.isBad ? ' x' : ''}" x="${x}" y="${CHART_H - h}" width="7" height="${h}"/>`
    })
    .join('')
  const line = guide === undefined ? '' : `<line class="r" x1="0" x2="${w}" y1="${CHART_H - guide * (CHART_H - 2)}" y2="${CHART_H - guide * (CHART_H - 2)}"/>`
  return svgDoc(w, bars + line)
}

function readsChart(stats: ChatStats): string {
  return barChart(
    stats.requests.map(r => ({ h: r.total ? r.read / r.total : 0, isBad: r.isRebuild })),
    40,
  )
}

// Pauses on a square-root scale up to twice the TTL, so a 3m pause still
// shows beside a 2h one; the TTL is the dashed line.
function pausesChart(stats: ChatStats, ttlMin: number): string {
  const ttl = ttlMin * 60_000
  return barChart(
    stats.gaps.map(g => ({ h: Math.sqrt(g.ms / (2 * ttl)), isBad: g.ms > ttl })),
    24,
    Math.SQRT1_2,
  )
}

// The prompt's size per request, as an area: it grows with the conversation
// and drops at a compaction.
function sizeChart(stats: ChatStats): string {
  const reqs = stats.requests
  const max = Math.max(...reqs.map(r => r.total), 1)
  const n = Math.max(reqs.length, 40)
  const w = n * 10
  const offset = n - reqs.length
  const pt = (r: (typeof reqs)[number], i: number) => `${(offset + i) * 10 + 5},${(CHART_H - 1 - (r.total / max) * (CHART_H - 3)).toFixed(1)}`
  const line = reqs.map(pt).join(' ')
  const first = (offset * 10 + 5).toFixed(0)
  const lastX = ((n - 1) * 10 + 5).toFixed(0)
  return svgDoc(w, `<polygon class="a" points="${first},${CHART_H} ${line} ${lastX},${CHART_H}"/><polyline class="l" points="${line}"/>`)
}

// The reads chart's caption, short enough for a third of the band.
// A new cache plays a one-shot LED panel over the line: the "● Cache warm"
// dot charges (square rings closing in) and fires; five rows of LEDs light up
// behind ragged comet fronts running right; lit LEDs twinkle for a beat; then
// the panel breaks into blocks left to right, each throwing a spark that rises
// off the band. Every edge is a pixel: no blur, no text. It is an image, and
// the desktop draws a new one at each redraw, which restarts its clock and
// hitches: the per-second redraw waits while it plays, and any other redraw's
// source starts its animations as long ago as the mint, so the image picks up
// where the last one was.
const MINT_MS = 5000
const MINT_W = 2400
const MINT_H = 22
const MINT_X = 10 // the dot
const MINT_FIRE = 0.5
// A front's run across the full width, a steady 1000px a second: a 900px
// band is lit in about a second, the widest before the break-up.
const MINT_RUN = 2.4
const MINT_EASE = 'calcMode="linear"'
const MINT_LAGS = [0, 0.045, 0.015, 0.06, 0.03] // per row: a ragged front
const MINT_BLOCK = 12
const MINT_BREAK = 2.9
const MINT_SPAN = 1.1
// The break-up sweeps this much of the band over its span, so a band of
// ordinary width sees all of it; past here it goes at the end.
const MINT_SEEN = 1000
const MINT_SPARK = 0.6

function mintRand(seed: number): () => number {
  // mulberry32: the same blocks, sparks and twinkles every time.
  let prng = seed
  return () => {
    prng = (prng + 0x6d2b79f5) | 0
    let t = Math.imul(prng ^ (prng >>> 15), 1 | prng)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sec = (n: number) => `${n.toFixed(3)}s`
const mintSet = (attr: string, begin: number, to: string | number) => `<set attributeName="${attr}" begin="${sec(begin)}" to="${to}" fill="freeze"/>`
// The LED rows: 4px pitch, 3px LEDs, at y = 1, 5, 9, 13, 17.
const ledY = (row: number) => 1 + row * 4

let mintBody: string | null = null
function mintSvg(at: number, elapsedMs = 0): string {
  if (mintBody === null) {
    // The lit panel, row by row, and the comet riding each row's front.
    let lit = ''
    let comet = ''
    MINT_LAGS.forEach((lag, i) => {
      const begin = sec(MINT_FIRE + lag)
      const y = i === 0 ? 0 : ledY(i)
      const h = i === 0 || i === 4 ? 5 : 4
      // Held to the end: an animation that ended before a redraw's image
      // began is dropped, freeze or not, and the panel would go dark.
      lit += `<rect x="0" y="${y}" width="${MINT_X}" height="${h}" fill="#fff"><animate attributeName="width" begin="${begin}" dur="${MINT_MS / 1000}s" values="${MINT_X};${MINT_W};${MINT_W}" keyTimes="0;${(MINT_RUN / (MINT_MS / 1000)).toFixed(3)};1" ${MINT_EASE} fill="freeze"/></rect>`
      comet +=
        `<g transform="translate(-999 0)"><animateTransform attributeName="transform" type="translate" begin="${begin}" dur="${MINT_RUN}s" values="${MINT_X} 0;${MINT_W} 0" ${MINT_EASE} fill="freeze"/>` +
        `<rect x="-180" y="${ledY(i)}" width="180" height="3" fill="url(#cg)"/><rect x="-2" y="${ledY(i)}" width="2" height="3" fill="#fff"/></g>`
    })

    // The break-up: blocks going dark left to right, some throwing a spark.
    const rand = mintRand(0x6d1a7)
    let blocks = ''
    let sparks = ''
    for (let x = 0; x < MINT_W; x += MINT_BLOCK) {
      for (const y of [0, 11]) {
        const t = MINT_BREAK + (Math.min(x, MINT_SEEN) / MINT_SEEN) * MINT_SPAN + rand() * 0.25
        blocks += `<rect x="${x}" y="${y}" width="${MINT_BLOCK}" height="11" fill="#fff">${mintSet('fill', t, '#000')}</rect>`
        if (rand() < 0.3) {
          const sx = x + 4 * Math.floor(rand() * 2)
          const sy = ledY(Math.floor(rand() * 5))
          sparks +=
            `<rect class="s" x="${sx}" y="${sy}" width="3" height="3" opacity="0">` +
            `<animate attributeName="opacity" begin="${sec(t)}" dur="${MINT_SPARK}s" values="1;1;.8;.6;.4;.2;0" calcMode="discrete" fill="freeze"/>` +
            `<animate attributeName="y" begin="${sec(t)}" dur="${MINT_SPARK}s" values="${[0, 2, 4, 6, 8, 10, 12].map(d => sy - d).join(';')}" calcMode="discrete" fill="freeze"/></rect>`
        }
      }
    }

    // Twinkles: a sparse pattern of lit LEDs, jumping about while the panel holds.
    const tw = mintRand(0x7e1c)
    let twinkle = ''
    for (let x = 0; x < 240; x += 4) for (let i = 0; i < 5; i++) if (tw() < 0.06) twinkle += `<rect x="${x}" y="${ledY(i)}" width="3" height="3"/>`

    // The dot charges: square rings closing in, one a step.
    const charge = [9, 6, 3]
      .map(
        (r, k) =>
          `<rect class="k" x="${MINT_X - r}" y="${11 - r}" width="${2 * r}" height="${2 * r}" fill="none" stroke-width="2" opacity="0">` +
          `<set attributeName="opacity" begin="${sec(k * 0.16)}" dur="0.16s" to="1"/></rect>`,
      )
      .join('')

    // Pattern content takes its fill from inside the pattern: one per colour.
    const leds = (cls: string) =>
      `<pattern id="led${cls}" width="4" height="${MINT_H}" patternUnits="userSpaceOnUse"><g class="${cls}">${[0, 1, 2, 3, 4].map(i => `<rect y="${ledY(i)}" width="3" height="3"/>`).join('')}</g></pattern>`
    const mask = (id: string, body: string) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${MINT_W}" height="${MINT_H}">${body}</mask>`
    mintBody =
      '<style>.p{fill:#16241a}.l{fill:#2f7a38}.c{fill:#d8ffd0}.s{fill:#b6f5a8}.t{fill:#7ddc7d}.k{stroke:#b6f5a8}</style>' +
      '<defs>' +
      leds('l') +
      leds('c') +
      `<pattern id="tw" width="240" height="${MINT_H}" patternUnits="userSpaceOnUse"><g class="t">${twinkle}</g>` +
      '<animateTransform attributeName="patternTransform" type="translate" begin="1.2s" dur="1.7s" values="0 0;28 0;52 0;12 0;72 0;40 0;84 0;20 0;64 0;8 0" calcMode="discrete" fill="freeze"/></pattern>' +
      '<linearGradient id="cg"><stop offset="0" stop-color="#000"/><stop offset=".7" stop-color="#777"/><stop offset="1" stop-color="#fff"/></linearGradient>' +
      mask('lit', lit) +
      mask('cm', comet) +
      mask('br', blocks) +
      '</defs>' +
      '<g mask="url(#br)"><g mask="url(#lit)">' +
      `<rect class="p" width="${MINT_W}" height="${MINT_H}"/>` +
      `<rect width="${MINT_W}" height="${MINT_H}" fill="url(#ledl)"/>` +
      `<rect width="${MINT_W}" height="${MINT_H}" fill="url(#tw)" opacity="0">${mintSet('opacity', 1.2, 1)}</rect>` +
      `<rect width="${MINT_W}" height="${MINT_H}" fill="url(#ledc)" mask="url(#cm)"/>` +
      '</g></g>' +
      sparks +
      charge
  }
  const ago = elapsedMs / 1000
  const body = ago <= 0 ? mintBody : mintBody.replace(/begin="([\d.]+)s"/g, (_, t: string) => `begin="${sec(Number(t) - ago)}"`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MINT_W} ${MINT_H}" width="${MINT_W}" height="${MINT_H}" preserveAspectRatio="xMinYMid slice" shape-rendering="crispEdges"><!-- minted ${at} -->${body}</svg>`
}

function readsCaption(stats: ChatStats): string {
  const pct = Math.round((stats.read / stats.total) * 100)
  return ` ${pct}% · ${stats.rebuilds ? `${stats.rebuilds} ${stats.rebuilds === 1 ? 'rebuild' : 'rebuilds'}` : 'no rebuilds'}`
}

// The band's second row, most useful first: what losing the cache would
// cost, what keep-warm paid to keep it, how the cache has done in this chat,
// and how the person's pauses compare with its TTL.
function statLines(info: CacheInfo | null, current: string | null, kw: KeepWarm, stats: ChatStats | null, now: number) {
  const lines: { key: string; label: string; value: string }[] = []
  const ttlMin = info?.ttlMin ?? DEFAULT_TTL
  const p = price(info?.model ?? current)
  if (info?.tokens && !info.isCompacted) {
    const x = Math.round(writeMult(ttlMin) / p.read)
    const isLive = liveLeft(info, current, now) !== null
    lines.push({
      key: 'cold',
      label: isLive ? 'If it goes cold' : 'Cold now',
      value: ` re-caching ${kTokens(info.tokens)} costs ≈${x}× reading it warm`,
    })
    if (kw.refreshes > 0 && kw.lastRead && p.base !== null) {
      const paid = (kw.refreshes * kw.lastRead * p.base * p.read) / 1e6
      const kept = (info.tokens * p.base * writeMult(ttlMin)) / 1e6
      lines.push({
        key: 'payoff',
        label: 'Keep-warm',
        value: ` ${kw.refreshes} ${kw.refreshes === 1 ? 'refresh' : 'refreshes'} ≈ $${paid.toFixed(2)} kept a $${kept.toFixed(2)} rewrite away`,
      })
    }
  }
  if (stats) {
    const pct = Math.round((stats.read / stats.total) * 100)
    const rebuilt = stats.rebuilds
      ? ` · ${stats.rebuilds} ${stats.rebuilds === 1 ? 'rebuild' : 'rebuilds'} (${kTokens(stats.rewritten)} re-written)`
      : ' · no rebuilds'
    lines.push({ key: 'health', label: 'This chat', value: ` ${pct}% read from cache${rebuilt}` })
    if (stats.pauses.length >= 3) {
      const median = stats.pauses[Math.floor(stats.pauses.length / 2)] ?? 0
      const over = stats.pauses.filter(ms => ms > ttlMin * 60_000).length
      lines.push({
        key: 'pace',
        label: 'Your pauses',
        value: ` typically ${duration(median)} · ${over} over ${ttlMin === 60 ? '1h' : '5m'}`,
      })
    }
  }
  return lines
}

// "opus[1m]" and "claude-opus-5-5[1m]" share the cache of the bare id.
const bare = (id: string) => id.replace(/\[.*\]$/, '')

// Walks the transcript's tail back to the last response (time, model, prompt
// size), a compaction after it, and the last cache write's TTL. A subagent's
// own transcript holds only sidechain rows.
async function fromTranscript($: EngineInterface, path: string, isAgent = false): Promise<CacheInfo | null> {
  const tail = await $.process.run(['tail', '-c', '3000000', path]).catch(() => null)
  if (!tail || tail.exitCode !== 0) return null

  const lines = tail.stdout.split('\n')
  let info: Omit<CacheInfo, 'ttlMin'> | null = null
  let compactedAt: number | null = null
  let ttlMin: 5 | 60 | null = null
  for (let i = lines.length - 1; i >= 0 && (info === null || ttlMin === null); i--) {
    const line = lines[i] ?? ''
    if (info === null && compactedAt === null && line.includes('"compact_boundary"')) {
      try {
        const row = JSON.parse(line)
        if (row.subtype === 'compact_boundary' && !!row.isSidechain === isAgent) compactedAt = Date.parse(row.timestamp)
      } catch {}
      if (compactedAt !== null) continue
    }
    if (!line.includes('"usage"')) continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const usage = row.message?.usage
    if (row.type !== 'assistant' || !!row.isSidechain !== isAgent || !usage || row.message.model === '<synthetic>') continue
    const size = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    if (size === 0) continue
    if (info === null) {
      info = {
        at: requestStart(lines, i, row.message.id) ?? Date.parse(row.timestamp),
        model: bare(row.message.model),
        tokens: size,
      }
    }
    const writes = usage.cache_creation ?? {}
    if (writes.ephemeral_1h_input_tokens > 0) ttlMin = 60
    else if (writes.ephemeral_5m_input_tokens > 0) ttlMin = 5
  }
  if (info === null) return null
  const base = { ...info, ttlMin: ttlMin ?? (isAgent ? AGENT_TTL : DEFAULT_TTL) }
  return compactedAt === null ? base : { ...base, at: compactedAt, tokens: undefined, isCompacted: true }
}

// A response's rows are stamped as each block completes; its request was sent
// at about the time of the row before its first block (the prompt or tool result).
function requestStart(lines: string[], i: number, id: string | undefined): number | null {
  for (let j = i - 1; j >= 0 && j > i - 200; j--) {
    let row: any
    try {
      row = JSON.parse(lines[j] ?? '')
    } catch {
      continue
    }
    if (id && row.message?.id === id) continue
    const at = Date.parse(row.timestamp)
    return Number.isNaN(at) ? null : at
  }
  return null
}

async function seed($: EngineInterface, path: string): Promise<void> {
  await fromTranscript($, path)
    .then(info => info && update($, cache, prev => prev ?? info))
    .catch(() => {})
}

// The chat's name as the app shows it (the transcript's last custom title),
// else its folder's name.
async function chatLabel($: EngineInterface, path: string): Promise<string> {
  const found = !path
    ? null
    : await $.process.run(['/bin/sh', '-c', 'grep -h \'"type":"custom-title"\' "$1" 2>/dev/null | tail -1', 'sh', path]).catch(() => null)
  try {
    const title = JSON.parse(found?.stdout ?? '').customTitle
    if (typeof title === 'string' && title) return title
  } catch {}
  const cwd = await $.session.cwd().catch(() => '')
  return cwd.split('/').filter(Boolean).pop() ?? 'chat'
}

// "59:59" counting down from a 1h TTL ("60:00" at the start); hours only past that.
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s <= 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  // Past an hour (only ever time gone by): hours, or days, without seconds.
  const h = Math.floor(s / 3600)
  return h < 24 ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

const kTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

// Subagent labels are kept whole up to this; the band cuts them to its width.
const LABEL_MAX = 120
const short = (text: string, max = 28) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

// Time left on a cache the next message would read: null when it has expired,
// was replaced by a compaction, or belongs to a model the session left.
function liveLeft(info: CacheInfo | null, current: string | null, now: number): number | null {
  if (info === null || info.isCompacted) return null
  if (current && info.model && current !== info.model) return null
  const left = info.at + info.ttlMin * 60_000 - now
  return left > 0 ? left : null
}

// A run whose stop never arrived (the process went away) counts as running
// for at most this long after its last request.
const RUN_STALE = 3_600_000

const isAgentRunning = (a: AgentCache, now: number) => !!a.isRunning && now - a.at < RUN_STALE

// Records one subagent; drops the ones that stopped and whose cache has lapsed.
async function touchAgent($: EngineInterface, id: string, patch: (prev: AgentCache | undefined) => AgentCache) {
  const now = await $.clock.now()
  await update($, agents, all => {
    const kept = Object.entries(all).filter(([, a]) => isAgentRunning(a, now) || a.at + a.ttlMin * 60_000 > now)
    return { ...Object.fromEntries(kept), [id]: patch(all[id]) }
  })
}

// The agent's task description: from the running agents' list, else from
// the `.meta.json` the engine keeps beside its transcript (which outlives the run).
async function agentLabel($: EngineInterface, id: string, type: string | undefined, flags: Flags): Promise<string> {
  const listed = await $.agent
    .list()
    .then(list => list.find(a => a.id === id))
    .catch(() => undefined)
  if (listed?.description) return short(listed.description, LABEL_MAX)
  if (flags.transcript) {
    const meta = flags.transcript.replace(/\.jsonl$/, `/subagents/agent-${id}.meta.json`)
    const description = await $.fs
      .read(meta)
      .then(text => JSON.parse(text).description)
      .catch(() => undefined)
    if (typeof description === 'string' && description) return short(description, LABEL_MAX)
  }
  return short(listed?.type || type || 'subagent')
}

// Statuses in which an agent sends its next request on its own (a waiting
// one is held on approval or other work, and its cache can lapse).
const ACTIVE = new Set(['pending', 'running'])

const agentTranscript = (flags: Flags, id: string) => flags.transcript.replace(/\.jsonl$/, `/subagents/agent-${id}.jsonl`)

// Follows the engine's own record of each subagent's status: an active one
// shows as running; one that stopped since gets its last request's time,
// size and TTL from its transcript, which start its resume countdown.
async function syncAgents($: EngineInterface, flags: Flags): Promise<void> {
  const listed = await $.agent.list().catch(() => null)
  if (listed === null) return
  flags.listed = new Set(listed.map(a => a.id))
  const known = await read($, agents)
  const now = await $.clock.now()
  for (const a of listed) {
    const prev = known[a.id]
    const label = short(a.description || a.type || 'subagent', LABEL_MAX)
    if (ACTIVE.has(a.status)) {
      if (!prev?.isRunning) await touchAgent($, a.id, p => ({ at: p?.at ?? now, ttlMin: p?.ttlMin ?? AGENT_TTL, label: keepLabel(p, label), tokens: p?.tokens, isRunning: true }))
    } else if (prev?.isRunning !== false && (prev || a.status === 'idle')) {
      const info = flags.transcript ? await fromTranscript($, agentTranscript(flags, a.id), true).catch(() => null) : null
      await touchAgent($, a.id, p => ({
        // Without its transcript: it was running moments ago, so about now.
        at: info ? Math.max(p?.at ?? 0, info.at) : p?.isRunning ? now : (p?.at ?? now),
        ttlMin: info?.ttlMin ?? p?.ttlMin ?? AGENT_TTL,
        label: keepLabel(p, label),
        tokens: info?.tokens ?? p?.tokens,
        isRunning: false,
      }))
    }
  }
}

// A run none of whose agents sent a request this long is taken as over.
const WORK_STALE = 3 * 3_600_000
// Runs listed in the stats box: those active this recently.
const RUNS_SHOWN = 2 * 3_600_000

// What this chat waits on while no turn runs: its workflow runs and its
// subagents running in the background. Each wakes it when it ends.
async function pendingWork($: EngineInterface, flags: Flags, now: number): Promise<{ count: number; label: string }> {
  const live = Object.values(await read($, runs)).filter(r => !r.isDone && now - r.lastAt < WORK_STALE)
  const bg = Object.entries(await read($, agents)).filter(
    ([id, a]) => !flags.runOf.has(id) && (flags.listed === null || flags.listed.has(id)) && isAgentRunning(a, now),
  ).length
  const parts = []
  if (live.length === 1) parts.push(`workflow ${short(live[0]!.name, 40)}`)
  else if (live.length > 1) parts.push(`${live.length} workflows`)
  if (bg > 0) parts.push(`${bg} background ${bg === 1 ? 'agent' : 'agents'}`)
  return { count: live.length + bg, label: parts.join(' + ') }
}

async function touchRun($: EngineInterface, runId: string, at: number): Promise<void> {
  await update($, runs, prev => {
    const run = prev[runId]
    return run ? { ...prev, [runId]: { ...run, lastAt: Math.max(run.lastAt, at) } } : prev
  })
}

// Keep-warm's refreshes per idle stretch. While work this chat waits on runs,
// it holds the cache for as many refreshes as one rewrite of it costs: each
// refresh reads the conversation, a rewrite writes it again whole.
function refreshLimit(s: Settings, ttlMin: number, modelId: string | null | undefined, isWaiting: boolean): number {
  return isWaiting ? Math.max(s.keepWarmMax, Math.floor(writeMult(ttlMin) / price(modelId).read)) : s.keepWarmMax
}

// Keeps a real label once known; replaces a fallback one.
// A label cut short by an older version gives way to the whole one.
const keepLabel = (prev: AgentCache | undefined, label: string) =>
  prev?.label && prev.label !== 'subagent' && !(prev.label.endsWith('…') && label.length > prev.label.length) ? prev.label : label

async function setKeepWarm($: EngineInterface, isOn: boolean): Promise<void> {
  await update($, keepWarm, () => ({ isOn, refreshes: 0 }))
}

// One tool-less request over the conversation that reads its cache, which
// resets the cache's timer. Pauses keep-warm until the next message when it
// reads little from cache, or fails twice, so a refresh that cannot help is
// not repeated. Each outcome is
// appended to ~/.claude/cache-clock.log; answers it in one line.
async function refresh($: EngineInterface, flags: Flags, sentAt: number): Promise<string> {
  if (flags.isRunning || flags.isForking) return 'refresh not sent (a turn or a refresh is running)'
  flags.isForking = true
  try {
    const r = await $.model.fork({ prompt: PING })
    const usage = 'usage' in r ? r.usage : undefined
    const hit = usage?.cache_read_input_tokens ?? 0
    const total = hit + (usage?.cache_creation_input_tokens ?? 0) + (usage?.input_tokens ?? 0)
    const pause = (stopped: string) => update($, keepWarm, prev => ({ ...prev, stopped }))
    let outcome: string
    if (!r.isAnswered && r.reason !== 'empty-reply') {
      outcome = r.reason === 'api-error' ? `refresh failed (API error ${r.status ?? ''})`.replace(' )', ')') : `refresh not sent (${r.reason})`
      flags.failures += 1
      if (flags.failures >= 2 || r.reason === 'nothing-to-fork') await pause(outcome)
    } else if (total === 0 || hit < total / 2) {
      flags.failures = 0
      outcome = `refresh read only ${kTokens(hit)} of ${kTokens(total)} tokens from cache`
      await pause(outcome)
    } else {
      flags.failures = 0
      outcome = `refresh read ${kTokens(hit)} of ${kTokens(total)} tokens from cache`
      // A message sent while the refresh ran set a later time already.
      await update($, cache, prev => prev && { ...prev, at: Math.max(prev.at, sentAt) })
      await update($, keepWarm, prev => ({ ...prev, refreshes: prev.refreshes + 1, lastRead: hit }))
    }
    await logLine($, flags, sentAt, `${outcome} (read ${hit}, write ${usage?.cache_creation_input_tokens ?? 0}, input ${usage?.input_tokens ?? 0})`)
    return outcome
  } finally {
    flags.isForking = false
  }
}

// Keeps the last 500 lines once it passes 1000.
async function logLine($: EngineInterface, flags: Flags, at: number, text: string): Promise<void> {
  const line = `${new Date(at).toISOString()} ${flags.label || flags.sessionId} · ${text}`
  const script = 'f="$HOME/.claude/cache-clock.log"; printf "%s\\n" "$1" >> "$f"; [ "$(wc -l < "$f")" -gt 1000 ] && tail -n 500 "$f" > "$f.tmp" && mv "$f.tmp" "$f"; true'
  await $.process.run(['/bin/sh', '-c', script, 'sh', line]).catch(() => {})
}

// Shortly before the cache expires, while keep-warm is on and has refreshes left.
async function replayDemo($: EngineInterface, s: Settings, flags: Flags): Promise<void> {
  const now = await $.clock.now()
  if (now >= flags.demoUntil) return
  if (flags.demoKind === 'reward') {
    const prize = await read($, reward)
    if (prize !== null && now - prize.at < REWARD_MS + 600) return
    const variant = REWARD_VARIANTS[flags.demoIndex++ % REWARD_VARIANTS.length]!
    const r: Reward = { at: now, variant, saved: 12.36, today: 41.8, streak: 7 }
    if (variant === 'hourglass') r.spare = 41_000
    if (variant === 'guitar') r.milestone = '$50 saved today'
    await playReward($, s, flags, r)
    return
  }
  const mint = await read($, minted)
  if (mint === null || now - mint.at >= MINT_MS + 500) await update($, minted, () => ({ at: now, tokens: 0 }))
}

// The reward's running totals, across chats: saved today and warm returns
// in a row (a cold return or a miss ends the run).
const TOTALS_KEY = 'reward-totals'
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000]
type Totals = { day: string; saved: number; streak: number }

async function readTotals($: EngineInterface, at: number): Promise<Totals> {
  const v = (await $.store.get(TOTALS_KEY).catch(() => undefined)) as Partial<Totals> | undefined
  const day = new Date(at).toDateString()
  return { day, saved: v?.day === day && typeof v.saved === 'number' ? v.saved : 0, streak: typeof v?.streak === 'number' ? v.streak : 0 }
}

// The scene's clock starts here, with its sound, so the two stay together.
async function playReward($: EngineInterface, s: Settings, flags: Flags, r: Reward): Promise<void> {
  r.at = await $.clock.now()
  await update($, reward, () => r)
  flags.jingle?.abort()
  flags.jingle = null
  if (s.reward === 'animation+sound') {
    const jingle = (flags.jingle = new AbortController())
    $.audio.play({ asset: `sounds/reward-${r.variant}.wav` }, { signal: jingle.signal }).catch(() => {})
  }
  $.clock.after(REWARD_MS + 20, () => $.ui.invalidate('ui.render'))
}

async function takeBack($: EngineInterface, flags: Flags, won: Reward): Promise<void> {
  const prize = await read($, reward)
  if (prize?.at !== won.at) return
  await update($, reward, () => null)
  flags.jingle?.abort()
  flags.jingle = null
}

// A typed message about to read the warm cache: what that saves, the scene
// it earns, and the totals as they will stand. Played now, as it is sent;
// the first response confirms it (a miss takes it back).
async function startReward($: EngineInterface, s: Settings, flags: Flags, info: CacheInfo, tokens: number, at: number): Promise<Reward | null> {
  const { base, read: readMult } = price(info.model)
  if (base === null) return null
  const saved = (tokens * base * (writeMult(info.ttlMin) - readMult)) / 1e6
  // Less than a cent shows as $0.00: not worth a scene.
  if (saved < 0.005) return null
  const totals = await readTotals($, at)
  const today = totals.saved + saved
  const streak = totals.streak + 1
  const left = info.at + info.ttlMin * 60_000 - at
  const crossed = MILESTONES.filter(m => totals.saved < m && today >= m).pop()
  const milestone = crossed !== undefined ? `$${crossed} saved today` : streak % 25 === 0 ? `${streak} in a row` : undefined
  const spare = left < alertLead(info.ttlMin) ? left : undefined
  const variant: RewardVariant = milestone ? 'guitar' : spare !== undefined ? 'hourglass' : REWARD_EVERYDAY[streak % REWARD_EVERYDAY.length]!
  const r: Reward = { at, variant, saved, today, streak, ...(spare !== undefined ? { spare } : {}), ...(milestone ? { milestone } : {}) }
  await playReward($, s, flags, r)
  return r
}

async function maybeRefresh($: EngineInterface, s: Settings, flags: Flags): Promise<void> {
  const kw = await read($, keepWarm)
  if (!(kw.isOn ?? s.keepWarm) || kw.stopped || flags.isRunning || flags.isForking) return
  const info = await read($, cache)
  const sentAt = await $.clock.now()
  const left = liveLeft(info, await read($, model), sentAt)
  if (info === null || left === null || left > refreshLead(info.ttlMin)) return
  const work = await pendingWork($, flags, sentAt)
  if (kw.refreshes >= refreshLimit(s, info.ttlMin, info.model, work.count > 0)) return
  await refresh($, flags, sentAt)
}

// Once keep-warm has spent its refreshes, the conversation is compacted at
// the point it would have refreshed again: the compaction reads the history
// while it is still cached, and the next message writes only the summary.
async function maybeCompact($: EngineInterface, s: Settings, flags: Flags): Promise<void> {
  const kw = await read($, keepWarm)
  if (!(kw.isOn ?? s.keepWarm) || kw.stopped || flags.isRunning || flags.isForking) return
  const info = await read($, cache)
  const now = await $.clock.now()
  const left = liveLeft(info, await read($, model), now)
  if (info === null || left === null || left > refreshLead(info.ttlMin)) return
  const work = await pendingWork($, flags, now)
  const limit = refreshLimit(s, info.ttlMin, info.model, work.count > 0)
  if (kw.refreshes < limit || flags.isRunning || flags.isForking) return

  flags.isForking = true
  let outcome: string
  try {
    const r = await $.session.compact()
    outcome = r.skip !== undefined ? `compaction skipped (${r.skip})` : `compacted after ${kw.refreshes}/${limit} refreshes`
    if (r.skip === undefined) {
      await update($, cache, prev => ({ at: now, ttlMin: prev?.ttlMin ?? info.ttlMin, model: prev?.model, isCompacted: true }))
      if (s.alert !== 'off') $.ui.toast(`Compacted ${flags.label ? `"${short(flags.label, 40)}"` : 'this chat'} before its cache went cold`, { timeoutMs: 10_000 })
    } else {
      // Not again for this cache entry: keep-warm is done with it.
      await update($, keepWarm, prev => ({ ...prev, stopped: outcome }))
    }
  } catch (err) {
    outcome = `compaction failed (${err instanceof Error ? err.message : String(err)})`
    await update($, keepWarm, prev => ({ ...prev, stopped: outcome }))
  } finally {
    flags.isForking = false
  }
  await logLine($, flags, now, outcome)
}

// A toast (and a sound) when the cache is about to expire and keep-warm is
// off or paused (on, it refreshes or compacts); once per cache entry.
async function maybeAlert($: EngineInterface, s: Settings, flags: Flags): Promise<void> {
  if (s.alert === 'off' || flags.isRunning) return
  const info = await read($, cache)
  const left = liveLeft(info, await read($, model), await $.clock.now())
  if (info === null || left === null || left > alertLead(info.ttlMin)) return
  if ((await read($, alertedAt)) === info.at) return
  const kw = await read($, keepWarm)
  if ((kw.isOn ?? s.keepWarm) && !kw.stopped) return
  const work = await pendingWork($, flags, await $.clock.now())

  await update($, alertedAt, () => info.at)
  const name = flags.label ? `"${short(flags.label, 40)}"` : 'this chat'
  const waiting = work.count > 0 ? ` while ${work.label} ${work.count === 1 ? 'is' : 'are'} still running` : ''
  const how = (kw.isOn ?? s.keepWarm) ? 'send a message' : 'send a message, or turn on keep-warm,'
  $.ui.toast(`Cache for ${name} expires in ${clock(left)}${waiting}: ${how} to keep it`, { timeoutMs: 15_000 })
  if (s.alert === 'toast+sound') await $.audio.play({ asset: 'sounds/expiring.wav' }).catch(() => {})
}

// Publishes this chat's cache for the other chats' bands and reads theirs.
async function syncChats($: EngineInterface, s: Settings, flags: Flags): Promise<void> {
  if (!flags.sessionId) return
  const now = await $.clock.now()
  flags.ticks += 1
  if (flags.ticks % 60 === 1 || !flags.label) flags.label = await chatLabel($, flags.transcript)

  const info = await read($, cache)
  if (info) {
    const entry = { label: flags.label || 'chat', at: info.at, ttlMin: info.ttlMin, tokens: info.tokens, isCompacted: info.isCompacted }
    const json = JSON.stringify(entry)
    // Rewritten when it changes, and every five minutes in case another
    // session's write lost it.
    if (json !== flags.published || flags.ticks % 30 === 0) {
      await $.store.set(CHAT_KEY + flags.sessionId, { ...entry, updatedAt: now })
      flags.published = json
    }
  }
  if (!s.otherChats) return

  const list: OtherChat[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(CHAT_KEY) || key === CHAT_KEY + flags.sessionId) continue
    const v = (await $.store.get(key)) as Partial<OtherChat> | undefined
    if (!v || typeof v.at !== 'number') continue
    if (now - v.at > DAY) {
      await $.store.delete(key)
      continue
    }
    list.push({ id: key.slice(CHAT_KEY.length), label: String(v.label ?? 'chat'), at: v.at, ttlMin: v.ttlMin === 5 ? 5 : 60, tokens: v.tokens, isCompacted: v.isCompacted })
  }
  // Unchanged, no write: a write redraws the band, restarting an animation.
  const prev = await read($, others)
  if (JSON.stringify(prev) !== JSON.stringify(list)) await update($, others, () => list)
}

// The main conversation's line: the status whole, the rest one clipped row
// that gives way to the width before the buttons do; `current` is the
// session's model since the last switch.
function mainLine({ Box, Text }: Pick<Elements['desktop'], 'Box' | 'Text'>, isWorking: boolean, info: CacheInfo, now: number, current: string | null) {
  // What the next message pays to write the conversation again, at list price.
  const base = price(info.model ?? current).base
  const cost = info.tokens && base !== null ? `≈$${((info.tokens * base * writeMult(info.ttlMin)) / 1e6).toFixed(2)}` : null
  const line = (color: 'green' | 'yellow' | 'red' | 'cyan', head: string, rest: string) => [
    <Box key="main-head" flexShrink={0}>
      <Text color={color}>{head}</Text>
    </Box>,
    <Box key="main-rest" flexShrink={1} height={1} overflow="hidden" alignItems="flex-start">
      <Text dimColor wrap="truncate-end">
        {rest}
      </Text>
    </Box>,
  ]
  const resend = info.tokens
    ? `next message re-caches ~${kTokens(info.tokens)} tokens${cost ? ` (${cost})` : ''}`
    : 'next message re-caches the conversation'
  const ttl = info.ttlMin === 60 ? '1h' : '5m'
  const size = info.tokens ? ` · ${kTokens(info.tokens)} cached` : ''

  if (info.isCompacted && !isWorking) return line('cyan', '◐ Compacted', ' · new context not cached yet; the next message caches the summary')
  if (current && info.model && current !== info.model && !isWorking) return line('red', '○ Cache cold', ` · switched to ${current}; ${resend}`)
  // Each request of the turn reads the cache and starts its timer again.
  if (isWorking) return line('green', '● Cache warm', ` · turn running (${ttl} TTL)${size}`)

  const left = info.at + info.ttlMin * 60_000 - now
  if (left <= 0) return line('red', '○ Cache cold', ` · expired ${clock(-left)} ago; ${resend}`)
  const isLow = left < alertLead(info.ttlMin)
  return line(isLow ? 'yellow' : 'green', '● Cache warm', ` · ${clock(left)} left (${ttl} TTL)${size}${cost ? ` (${cost} if it goes cold)` : ''}`)
}

// The line while a reward plays: room for Clawd and his prop, then what the
// message saved rolling up, and the totals.
const GOLD = '#e3b341'
const ROOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${REWARD_ROOM}" height="${REWARD_H}"/>`
function rewardLine({ Box, Text, Svg }: Pick<Elements['desktop'], 'Box' | 'Text'> & { Svg: NonNullable<Elements['desktop']['Svg']> }, r: Reward, now: number) {
  const odo = odometerSvg(r.at, `$${r.saved.toFixed(2)}`, catchTime(r.variant), now - r.at)
  const isStreakMilestone = r.milestone?.endsWith('in a row') ?? false
  return [
    <Box key="reward-room" flexShrink={0}>
      <Svg key={`reward-room-${r.at}`} source={ROOM_SVG} alt="Clawd" width={REWARD_ROOM} height={REWARD_H} />
    </Box>,
    <Box key="reward-saved" flexShrink={0}>
      <Text bold color={GOLD}>
        Saved{' '}
      </Text>
    </Box>,
    <Box key="reward-odo" flexShrink={0}>
      <Svg key={`reward-odo-${r.at}`} source={odo.source} alt={`$${r.saved.toFixed(2)}`} height={20} />
    </Box>,
    <Box key="reward-tail" flexShrink={0}>
      <Text>
        <Text dimColor>{`${r.spare !== undefined ? ` with ${clock(r.spare)} to spare` : ''} · `}</Text>
        {r.milestone ? <Text bold color={GOLD}>{r.milestone}</Text> : <Text dimColor>{`$${r.today.toFixed(2)} today`}</Text>}
        {isStreakMilestone ? null : <Text dimColor>{` · ${r.streak} in a row`}</Text>}
      </Text>
    </Box>,
  ]
}

// Other chats by title: the warm ones soonest to expire first, then the
// compacted ones, then the cold ones, most recent first.
function otherChatsShown(
  list: readonly OtherChat[],
  now: number,
): { id: string; title: string; status: string; isExpiring: boolean; left: number }[] {
  const rank = (c: { left: number; isCompacted?: boolean }) => (c.isCompacted ? 1 : c.left > 0 ? 0 : 2)
  return list
    .map(c => ({ ...c, left: c.at + c.ttlMin * 60_000 - now }))
    .filter(c => c.left > -COLD_SHOWN)
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.left - b.left : b.left - a.left))
    .map(c => ({
      id: c.id,
      title: short(c.label, 28),
      status: c.isCompacted ? 'compacted' : c.left > 0 ? clock(c.left) : 'cold',
      isExpiring: !c.isCompacted && c.left > 0 && c.left <= alertLead(c.ttlMin),
      left: c.left,
    }))
}

export const register: Register = (on, options) => {
  const s = settings(options)
  const flags: Flags = { isRunning: false, isForking: false, sessionId: '', transcript: '', label: '', published: '', ticks: 0, listed: null, stats: null, statsAt: 0, failures: 0, runOf: new Map(), demoUntil: 0, demoKind: 'mint', demoIndex: 0, isTyped: false, jingle: null }

  // Also runs on a mod (re)load inside an open chat: seed from its transcript so
  // the band shows before the next message.
  on('session.start', async ($, e, next) => {
    $.clock.every(1000, async () => {
      const mint = await read($, minted)
      const prize = await read($, reward)
      const now = await $.clock.now()
      if (mint !== null && now - mint.at >= 0 && now - mint.at < MINT_MS) return
      if (prize !== null && now - prize.at >= 0 && now - prize.at < REWARD_MS) return
      $.ui.invalidate('ui.render')
    })
    flags.sessionId = await $.session.id().catch(() => '')
    if (flags.sessionId) {
      flags.transcript = await $.process
        .run(['/bin/sh', '-c', 'ls "$HOME"/.claude/projects/*/"$1".jsonl 2>/dev/null | head -1', 'sh', flags.sessionId])
        .then(found => found.stdout.trim())
        .catch(() => '')
    }
    if (flags.transcript && (await read($, cache)) === null) await seed($, flags.transcript)
    refreshStats($, flags, true).catch(() => {})

    await $.command
      .register({ name: 'keep-warm', description: "Keep this chat's prompt cache warm while idle (on/off)", argumentHint: '[on|off|now]', immediate: true })
      .catch(() => {})
    await $.command
      .register({ name: 'cache-clock-demo', description: 'Replay the new-cache animation, or each reward scene, for a minute', argumentHint: '[reward]', immediate: true })
      .catch(() => {})
    $.clock.every(2000, () => {
      syncAgents($, flags).catch(() => {})
      replayDemo($, s, flags).catch(() => {})
    })
    $.clock.every(10_000, () => {
      maybeRefresh($, s, flags)
        .then(() => maybeCompact($, s, flags))
        .catch(() => {})
      maybeAlert($, s, flags).catch(() => {})
      syncChats($, s, flags).catch(() => {})
    })
    await syncChats($, s, flags).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'cache-clock-demo' }, async ($, e) => {
    flags.demoUntil = (await $.clock.now()) + 60_000
    flags.demoKind = e.args.trim().toLowerCase() === 'reward' ? 'reward' : 'mint'
    flags.demoIndex = 0
    await replayDemo($, s, flags)
    return {
      text:
        flags.demoKind === 'reward'
          ? `Playing each reward scene in turn for a minute: ${REWARD_VARIANTS.join(', ')}.`
          : 'Replaying the new-cache animation every few seconds for a minute.',
    }
  })

  // A message the person typed, as opposed to a wake-up from background
  // work, a schedule, a peer or a plugin speaking for itself: only those earn
  // the reward. One typed over a running turn joins it. The Desktop app sends
  // as the SDK host; a plugin may send the person's words (dictation) asUser.
  on('prompt.submit', async ($, e, next) => {
    const o = e.origin as PromptOrigin | undefined
    const isOwn = o === undefined || o.kind === 'composer' || o.kind === 'bridge' || o.kind === 'sdk' || (o.kind === 'plugin' && o.asUser === true)
    if (e.turnId === undefined) flags.isTyped = isOwn
    const r = await next(e)
    if ('drop' in r && r.drop !== undefined) flags.isTyped = false
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'keep-warm' }, async ($, e) => {
    const kw = await read($, keepWarm)
    const arg = e.args.trim().toLowerCase()
    // Refreshes now, to see what a refresh reads; only while the cache is warm,
    // since a cold one would be written again whole.
    if (arg === 'now') {
      const now = await $.clock.now()
      if (flags.isRunning || flags.isForking) return { text: 'A turn or a refresh is running; try again when it ends.' }
      if (liveLeft(await read($, cache), await read($, model), now) === null) return { text: 'The cache is cold: send a message first.' }
      return { text: `Keep-warm: ${await refresh($, flags, now)}.` }
    }
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(kw.isOn ?? s.keepWarm)
    await setKeepWarm($, isOn)
    return {
      text: isOn
        ? `Keep-warm on: up to ${s.keepWarmMax} refreshes after your last message, each shortly before the cache expires.`
        : 'Keep-warm off for this chat.',
    }
  })

  // A reopened chat picks up where its transcript left off. /clear, a resume
  // or a fork puts another conversation in this process: its own id, title,
  // cache and record replace the previous one's.
  on('classic.SessionStart', async ($, e, next) => {
    try {
      if (!e.agent_id) {
        flags.transcript = e.transcript_path
        if (e.session_id) flags.sessionId = e.session_id
        if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
          flags.label = e.session_title ?? ''
          flags.published = ''
          flags.stats = null
          const info = await fromTranscript($, e.transcript_path).catch(() => null)
          await update($, cache, () => info)
          await update($, model, () => null)
          await update($, miss, () => null)
          await update($, keepWarm, () => ({ isOn: null, refreshes: 0 }))
          await update($, agents, () => ({}))
          await update($, alertedAt, () => null)
          await update($, runs, () => ({}))
        } else {
          if (e.session_title) flags.label = e.session_title
          await seed($, e.transcript_path)
        }
        refreshStats($, flags, true).catch(() => {})
      }
    } catch {}
    return next(e)
  })

  // /clear starts a new conversation: nothing of it is cached yet.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, cache, () => null)
      await update($, miss, () => null)
    }
    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    try {
      const label = await agentLabel($, e.agent_id, e.agent_type, flags)
      const at = await $.clock.now()
      await touchAgent($, e.agent_id, prev => ({ at, ttlMin: prev?.ttlMin ?? AGENT_TTL, label, tokens: prev?.tokens, isRunning: true }))
    } catch {}
    return next(e)
  })

  // A subagent's run ended: its cache stays warm for a resume until the TTL.
  on('classic.SubagentStop', async ($, e, next) => {
    try {
      const info = await fromTranscript($, e.agent_transcript_path, true).catch(() => null)
      const label = await agentLabel($, e.agent_id, e.agent_type, flags)
      const now = await $.clock.now()
      await touchAgent($, e.agent_id, prev => ({
        at: Math.max(prev?.at ?? 0, info?.at ?? 0) || now,
        ttlMin: info?.ttlMin ?? prev?.ttlMin ?? AGENT_TTL,
        label: keepLabel(prev, label),
        tokens: info?.tokens ?? prev?.tokens,
        isRunning: false,
      }))
    } catch {}
    return next(e)
  })

  // Each request refreshes its loop's cache timer when it is sent: the main
  // conversation's for the model it names, or the subagent's own. The first
  // request of a turn that should have read the cache is checked against what
  // it actually read.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    const runId = agentId ? flags.runOf.get(agentId) : undefined
    if (runId) {
      await touchRun($, runId, await $.clock.now())
      const result = yield* next(e)
      const u = result.usage
      if (u) {
        const read = u.cache_read_input_tokens ?? 0
        const total = read + (u.cache_creation_input_tokens ?? 0) + (u.input_tokens ?? 0)
        await update($, runs, prev => {
          const run = prev[runId]
          return run ? { ...prev, [runId]: { ...run, read: run.read + read, total: run.total + total } } : prev
        })
      }
      return result
    }
    if (agentId) {
      const at = await $.clock.now()
      const label = await agentLabel($, agentId, undefined, flags)
      await touchAgent($, agentId, prev => ({ at, ttlMin: prev?.ttlMin ?? AGENT_TTL, label: keepLabel(prev, label), tokens: prev?.tokens, isRunning: true }))
      return yield* next(e)
    }
    // A refresh's own request; a message typed while one runs is still ours.
    if (flags.isForking && !(e.index === 0 && flags.isTyped)) return yield* next(e)

    flags.isRunning = true
    const at = await $.clock.now()
    const prev = await read($, cache)
    const expected = e.index === 0 && prev !== null && liveLeft(prev, bare(e.model), at) !== null ? prev.tokens : undefined
    await update($, cache, p => ({ at, ttlMin: p?.ttlMin ?? DEFAULT_TTL, model: bare(e.model), tokens: p?.tokens }))
    await update($, model, () => bare(e.model))
    if (e.index === 0) await update($, keepWarm, kw => ({ isOn: kw.isOn, refreshes: 0 }))
    // A turn opening with no warm cache will write a new one: mint now, as the
    // person sends, rather than when the first response ends.
    const isColdStart = e.index === 0 && expected === undefined
    if (isColdStart) await update($, minted, () => ({ at, tokens: prev?.tokens ?? 0 }))
    // A message typed onto the warm cache earns the reward; one typed onto a
    // cold one ends the run of warm returns.
    const isTyped = e.index === 0 && flags.isTyped
    if (e.index === 0) flags.isTyped = false
    let prize: Reward | null = null
    if (isTyped && prev !== null && expected !== undefined && expected >= 4096 && s.reward !== 'off') {
      prize = await startReward($, s, flags, prev, expected, at).catch(() => null)
    } else if (isTyped && prev !== null && expected === undefined && !prev.isCompacted && prev.at + prev.ttlMin * 60_000 <= at) {
      const totals = await readTotals($, at)
      if (totals.streak > 0) await $.store.set(TOTALS_KEY, { ...totals, streak: 0 }).catch(() => {})
    }

    const result = yield* next(e)
    // No response (the request failed or was cut off before one): the cache
    // is where it was.
    if (result.stopReason === null) await update($, cache, () => prev)
    const usage = result.usage
    if (usage) {
      const hit = usage.cache_read_input_tokens ?? 0
      const total = hit + (usage.cache_creation_input_tokens ?? 0) + (usage.input_tokens ?? 0)
      await update($, cache, p => p && { ...p, tokens: total })
      // What was cached before this message should have been read whole.
      let isMiss = false
      if (e.index === 0) {
        isMiss = expected !== undefined && expected >= 4096 && hit < expected / 2
        await update($, miss, () => (isMiss ? { at, read: hit, total: expected } : null))
      }
      // A new cache: the turn opened on a cold one (or missed it) and wrote
      // the prefix, or any request wrote most of its prompt.
      const write = usage.cache_creation_input_tokens ?? 0
      const isMint = write >= 1024 && ((e.index === 0 && (expected === undefined || isMiss)) || (write >= 4096 && write > total / 2))
      if (isMint && !isColdStart && (prize === null || isMiss)) {
        const mintedAt = await $.clock.now()
        await update($, minted, () => ({ at: mintedAt, tokens: write }))
      }
      // The reward stands, and goes into the totals as they stand now (another
      // chat may have added to them meanwhile); a miss takes it back.
      if (prize !== null) {
        const won = prize
        const totals = await readTotals($, won.at)
        if (isMiss) await takeBack($, flags, won)
        await $.store
          .set(TOTALS_KEY, isMiss ? { ...totals, streak: 0 } : { day: totals.day, saved: totals.saved + won.saved, streak: totals.streak + 1 })
          .catch(() => {})
      }
    } else if (prize !== null) {
      // No response: nothing was read, so nothing was saved.
      await takeBack($, flags, prize)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) flags.isRunning = false
    return next(e)
  })

  // After the turn: the TTL the writes actually used (5m once on usage credits)
  // and the prompt size a cold cache would re-send.
  on('classic.Stop', async ($, e, next) => {
    try {
      if (!e.agent_id) {
        flags.isRunning = false
        const tokens = await $.session
          .usage()
          .then(u => u.context.tokens)
          .catch(() => undefined)
        await fromTranscript($, e.transcript_path)
          .then(info =>
            update($, cache, prev =>
              prev ? { ...prev, ttlMin: info?.ttlMin ?? prev.ttlMin, tokens: tokens ?? info?.tokens ?? prev.tokens } : info,
            ),
          )
          .catch(() => {})
        refreshStats($, flags).catch(() => {})
        // The runs the turn's background-task list no longer names have ended.
        if (e.background_tasks) {
          const live = e.background_tasks.filter(t => t.type === 'workflow')
          const ids = new Set(live.map(t => t.id))
          const at = await $.clock.now()
          await update($, runs, prev => {
            let ended = prev
            for (const [id, run] of Object.entries(prev)) {
              const isLive = run.taskId ? ids.has(run.taskId) : live.some(t => t.name === run.name)
              if (!run.isDone && !isLive) ended = { ...ended, [id]: { ...run, lastAt: at, isDone: true } }
            }
            return ended
          })
        }
      }
    } catch {}
    return next(e)
  })

  // A workflow runs in the background, and its agents are not subagents the
  // engine lists: each is counted under its run.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      const r = ran.deny === undefined && ran.isError !== true ? ran.result : undefined
      if (!e.agentId && r && r.runId && r.status === 'async_launched') {
        const runId = r.runId
        const at = await $.clock.now()
        await update($, runs, prev => {
          const kept = Object.entries(prev).filter(([, run]) => at - run.lastAt < RUNS_SHOWN)
          const run = prev[runId]
          const fresh: WorkflowRun = run
            ? { ...run, taskId: r.taskId, lastAt: at, isDone: false }
            : { name: r.workflowName ?? 'workflow', taskId: r.taskId, startedAt: at, lastAt: at, agents: 0, total: 0, read: 0 }
          return { ...Object.fromEntries(kept), [runId]: fresh }
        })
      }
    } catch {}
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    try {
      if (e.workflow?.runId && spawned.agentId) {
        flags.runOf.set(spawned.agentId, e.workflow.runId)
        const at = await $.clock.now()
        const runId = e.workflow.runId
        await update($, runs, prev => {
          const run = prev[runId] ?? { name: 'workflow', startedAt: at, lastAt: at, agents: 0, total: 0, read: 0 }
          return { ...prev, [runId]: { ...run, agents: run.agents + 1, lastAt: at, isDone: false } }
        })
      }
    } catch {}
    return spawned
  }).catch(($, e, next) => next(e))

  // Compaction swaps the history for a summary: the old cache no longer
  // matters, and the new prefix is cached by the next message (a small write).
  on('classic.PostCompact', async ($, e, next) => {
    try {
      const at = await $.clock.now()
      await update($, cache, prev => ({ at, ttlMin: prev?.ttlMin ?? DEFAULT_TTL, model: prev?.model, isCompacted: true }))
    } catch {}
    return next(e)
  })

  // Each model has its own cache: a switch reads nothing until switched back.
  on('classic.PostModelSwitch', async ($, e, next) => {
    try {
      await update($, model, () => bare(e.to_model))
    } catch {}
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const now = await $.clock.now()
    const all = await read($, agents)

    // A subagent's transcript is in view: its own cache.
    const viewed = e.props.view.agentId
    if (viewed) {
      const agent = all[viewed]
      if (!agent) return next(e)
      const left = agent.at + agent.ttlMin * 60_000 - now
      const ttl = agent.ttlMin === 60 ? '1h' : '5m'
      const size = agent.tokens ? `~${kTokens(agent.tokens)} tokens` : 'its history'
      if (isAgentRunning(agent, now)) {
        return (
          <Box>
            <Text color="green">● Subagent running</Text>
            <Text dimColor> · each of its requests reads its cache and resets the {ttl} timer</Text>
          </Box>
        )
      }
      return left > 0 ? (
        <Box>
          <Text color="green">● Subagent cache warm</Text>
          <Text dimColor> · {clock(left)} left ({ttl} TTL); a message to it now reads {size} from cache</Text>
        </Box>
      ) : (
        <Box>
          <Text color="red">○ Subagent cache cold</Text>
          <Text dimColor> · expired {clock(-left)} ago; a message to it re-caches {size}</Text>
        </Box>
      )
    }

    const rows = []
    const info = await read($, cache)
    const kw = await read($, keepWarm)
    const current = await read($, model)
    // Other chats stay out of the way: a dim count on this chat's line, the
    // one about to expire named inline, and the list itself on hover.
    const chats = s.otherChats ? otherChatsShown(await read($, others), now) : []
    const expiring = chats.find(c => c.isExpiring)
    const chatList =
      chats.length > 0 ? (
        <Text key="chat-list" wrap="truncate-end">
          {chats.slice(0, 5).map((c, i) => (
            <Text key={`chat-${c.id}`} dimColor>
              {i > 0 ? '   ' : ''}
              <Text italic>{c.title}</Text>
              {` ${c.status}`}
            </Text>
          ))}
          {chats.length > 5 ? <Text dimColor>{`   +${chats.length - 5} more`}</Text> : null}
        </Text>
      ) : null
    const isStatsOn = (await read($, showStats)) ?? s.stats
    const prize = await read($, reward)
    const isRewarding = Svg !== null && e.surface !== 'terminal' && prize !== null && now - prize.at >= 0 && now - prize.at < REWARD_MS
    const mint = await read($, minted)
    const isMinting = !isRewarding && Svg !== null && e.surface !== 'terminal' && mint !== null && now - mint.at >= 0 && now - mint.at < MINT_MS
    const allStats = isStatsOn ? statLines(info, current, kw, flags.stats, now) : []
    // Where the surface draws SVG, this chat's history goes to charts, each
    // captioned with its stat line; the text row keeps what has no chart.
    const charted = Svg !== null && flags.stats !== null && flags.stats.requests.length > 1
    const caption = (key: string) => allStats.find(l => l.key === key)
    const stats = charted ? allStats.filter(l => l.key === 'cold' || l.key === 'payoff') : allStats
    const statText =
      stats.length > 0 ? (
        <Text key="stats" wrap="truncate-end">
          {stats.map((line, i) => (
            <Text key={`stat-${line.key}`}>
              <Text>{`${i > 0 ? '    ' : ''}${line.label}`}</Text>
              <Text dimColor>{line.value}</Text>
            </Text>
          ))}
        </Text>
      ) : null

    if (info !== null) {
      const isOn = kw.isOn ?? s.keepWarm
      const work = await pendingWork($, flags, now)
      const limit = refreshLimit(s, info.ttlMin, info.model, work.count > 0)
      const used =
        isOn && kw.refreshes > 0
          ? ` · refreshed ${kw.refreshes}/${Math.max(limit, kw.refreshes)}${kw.refreshes >= limit && !kw.stopped ? ', compacts before it goes cold' : ''}`
          : ''
      // While the chat waits on background work: whether keep-warm holds the
      // cache until it is back, or the cache is about to expire first.
      const left = liveLeft(info, current, now)
      const isHeld = isOn && !kw.stopped && kw.refreshes < limit
      const workText =
        work.count === 0 || e.props.isWorking ? null : left !== null && isHeld ? (
          <Text dimColor wrap="truncate-end">{` · keeping warm for ${work.label}`}</Text>
        ) : left !== null && left < alertLead(info.ttlMin) ? (
          <Text color="yellow" wrap="truncate-end">{` · ${work.label} still running; the cache expires first unless kept warm`}</Text>
        ) : (
          <Text dimColor wrap="truncate-end">{` · ${work.label} running`}</Text>
        )
      const recent = Object.entries(await read($, runs))
        .filter(([, run]) => now - run.lastAt < RUNS_SHOWN)
        .sort(([, a], [, b]) => b.startedAt - a.startedAt)
        .slice(0, 2)
      const runRows =
        isStatsOn && recent.length > 0 ? (
          <Box key="runs" flexDirection="column" marginTop={statText !== null || charted ? 1 : 0}>
            {recent.map(([id, run]) => (
              <Box key={`run-${id}`} height={1} overflow="hidden" alignItems="flex-start">
                <Box flexShrink={0}>
                  <Text>{`Workflow ${short(run.name, 40)}`}</Text>
                </Box>
                <Box flexShrink={1} overflow="hidden">
                  <Text dimColor wrap="truncate-end">
                    {` · ${run.isDone || now - run.lastAt >= WORK_STALE ? 'ended' : 'running'} · ${run.agents} ${run.agents === 1 ? 'agent' : 'agents'}` +
                      (run.total > 0 ? ` · ${Math.round((run.read / run.total) * 100)}% of ${kTokens(run.total)} prompt tokens read from cache` : '')}
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
        ) : null
      const isSwapped = chatList !== null && (statText !== null || (isStatsOn && charted))
      const tile = (key: string, label: string, value: string, source: string, alt: string) => (
        <Box key={`tile-${key}`} flexDirection="column" width="32%" overflow="hidden">
          <Box height={1} overflow="hidden" alignItems="flex-start">
            <Box flexShrink={0}>
              <Text>{label}</Text>
            </Box>
            <Box flexShrink={1} overflow="hidden">
              <Text dimColor wrap="truncate-end">
                {value}
              </Text>
            </Box>
          </Box>
          {Svg ? <Svg key={`chart-${key}`} source={source} alt={alt} height={CHART_H} /> : null}
        </Box>
      )
      const tiles =
        isStatsOn && charted && flags.stats !== null && Svg !== null ? (
          <Box key="charts" justifyContent="space-between" marginTop={1}>
            {tile('reads', 'Cache reads', readsCaption(flags.stats), chart(flags.stats, 'reads', () => readsChart(flags.stats!)), 'Share of each request read from cache')}
            {tile('pauses', 'Your pauses', caption('pace')?.value ?? ` vs the ${info.ttlMin === 60 ? '1h' : '5m'} TTL`, chart(flags.stats, `pauses-${info.ttlMin}`, () => pausesChart(flags.stats!, info.ttlMin)), 'Your pauses against the cache TTL')}
            {tile('size', 'Cached', ` ${kTokens(info.tokens ?? flags.stats.requests[flags.stats.requests.length - 1]?.total ?? 0)} now`, chart(flags.stats, 'size', () => sizeChart(flags.stats!)), 'Prompt size per request')}
          </Box>
        ) : null
      rows.push(
        // Full width, as is the band's own box: the mint overlay below spans
        // this box, which the desktop otherwise sizes to the line's text.
        <Box key="main" width="100%">
          {isRewarding && Svg !== null && prize !== null ? (
            rewardLine({ Box, Text, Svg }, prize, now)
          ) : (
            mainLine({ Box, Text }, e.props.isWorking, info, now, current)
          )}
          <Box flexShrink={0}>
            <Text dimColor>{used} </Text>
          </Box>
          <Box flexShrink={0}>
            <Button key="keep-warm" label={isOn ? 'Keep-warm: on' : 'Keep-warm: off'} onPress={() => setKeepWarm($, !isOn)} />
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Button
              key="stats-toggle"
              label={isStatsOn ? 'Stats: on' : 'Stats: off'}
              onPress={() => update($, showStats, () => !isStatsOn)}
            />
          </Box>
          {/* The extras give way first, and clipped: squeezed to nothing, a text wraps a letter a row. */}
          {workText ? (
            <Box flexShrink={1000} height={1} overflow="hidden" alignItems="flex-start">
              {workText}
            </Box>
          ) : null}
          {isSwapped || expiring ? (
            <Box flexShrink={1000} height={1} overflow="hidden" alignItems="flex-start">
              <Text wrap="truncate-end">
                {expiring ? <Text>{` · ${expiring.title} expires in ${clock(expiring.left)}`}</Text> : null}
                {isSwapped ? (
                  <Text dimColor hover={{ scope: 'others', dimColor: false }}>
                    {` · ${chats.length} other ${chats.length === 1 ? 'chat' : 'chats'}`}
                  </Text>
                ) : null}
              </Text>
            </Box>
          ) : null}
          {/* Last, so it draws over the line. */}
          {isMinting && Svg !== null && mint !== null ? (
            <Box key={`mint-${mint.at}`} position="absolute" top={0} left={0} right={0} height={1} overflow="hidden">
              <Svg key={`mint-svg-${mint.at}`} source={mintSvg(mint.at, now - mint.at)} alt="New cache minted" height={MINT_H} />
            </Box>
          ) : null}
          {isRewarding && Svg !== null && prize !== null ? (
            <Box key={`reward-${prize.at}`} position="absolute" top={0} left={0} right={0} height={1} overflow="hidden">
              <Svg key={`reward-svg-${prize.at}`} source={rewardSvg(prize.at, prize.variant, now - prize.at)} alt="Cache reused" height={REWARD_H} />
            </Box>
          ) : null}
        </Box>,
      )
      // The stats sit in a box of their own under this chat's line. Hovering
      // the chat count swaps the list in: both share one clipped row, the
      // list first, so the band never changes height.
      if (statText !== null || tiles !== null || runRows !== null) {
        rows.push(
          <Box key="detail" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
            {statText !== null || isSwapped ? (
              <Box flexDirection="column" height={1} overflow="hidden" flexGrow={1}>
                {isSwapped ? (
                  <Box display="none" hover={{ scope: 'others', display: 'flex' }}>
                    {chatList}
                  </Box>
                ) : null}
                {statText}
              </Box>
            ) : null}
            {tiles}
            {runRows}
          </Box>,
        )
      } else if (chatList !== null) {
        rows.push(
          <Box key="detail" height={1} overflow="hidden">
            {chatList}
          </Box>,
        )
      }
      if (kw.stopped) {
        rows.push(
          <Box key="stopped">
            <Text color="yellow">Keep-warm paused until your next message</Text>
            <Text dimColor> · {kw.stopped}</Text>
          </Box>,
        )
      }
    } else if (chatList !== null) {
      rows.push(
        <Box key="detail" height={1} overflow="hidden">
          {chatList}
        </Box>,
      )
    }

    const missed = await read($, miss)
    if (missed !== null) {
      rows.push(
        <Box key="miss">
          <Text color="yellow">⚠ Last message missed the cache</Text>
          <Text dimColor>
            {' '}
            · read {kTokens(missed.read)} of ~{kTokens(missed.total)} cached tokens; the rest was written again
          </Text>
        </Box>,
      )
    }

    // Only the subagents the engine lists: other loops that carry an agent id
    // (forks, the engine's own side requests) cannot be resumed.
    const subagents = Object.entries(all)
      .filter(([id]) => flags.listed === null || flags.listed.has(id))
      .map(([id, a]) => ({ id, ...a, isRunning: isAgentRunning(a, now), left: a.at + a.ttlMin * 60_000 - now }))
      .filter(a => a.isRunning || a.left > 0)
      .sort((a, b) => Number(b.isRunning) - Number(a.isRunning) || b.left - a.left)
    // The label alone gives way to the width; the status stays whole.
    const agentText = (a: (typeof subagents)[number]) => (
      <Box height={1} overflow="hidden" alignItems="flex-start">
        <Box flexShrink={0}>
          <Text dimColor>{'└ '}</Text>
        </Box>
        <Box flexShrink={1} overflow="hidden">
          <Text wrap="truncate-end">{a.label}</Text>
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>{` · ${a.isRunning ? 'running' : `${clock(a.left)} left to resume from cache`}`}</Text>
        </Box>
      </Box>
    )
    // Narrow: one per row, two rows. Wide: two per row, three rows.
    const perRow = e.props.bodyColumns >= WIDE ? 2 : 1
    const room = perRow * (perRow === 2 ? 3 : 2)
    const shown = subagents.slice(0, room)
    for (let i = 0; i < shown.length; i += perRow) {
      rows.push(
        <Box key={`agents-${i}`} columnGap={4} height={1} overflow="hidden">
          {shown.slice(i, i + perRow).map(a => (
            <Box key={`agent-${a.id}`} width={perRow === 2 ? '50%' : '100%'} overflow="hidden">
              {agentText(a)}
            </Box>
          ))}
        </Box>,
      )
    }
    if (shown.length < subagents.length) {
      rows.push(
        <Text key="agents-more" dimColor wrap="truncate-end">{`└ +${subagents.length - shown.length} more subagents`}</Text>,
      )
    }

    if (rows.length === 0) return next(e)
    return (
      <Box flexDirection="column" width="100%">
        {rows}
      </Box>
    )
  })
}
