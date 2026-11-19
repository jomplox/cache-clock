import { expect, mock, test } from 'claude-code/testing'

const BAND = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
})

const SWITCH = {
  from_model: 'claude-opus-5-5',
  to_model: 'claude-sonnet-5-5',
  requested_model: 'sonnet',
  source: 'sdk' as const,
  context_tokens: 0,
  prompt_cache_warm: true,
  cache_ttl: '1h' as const,
  estimated_cache_write_usd: 0,
  pricing: 'catalog' as const,
}

type On = Parameters<Parameters<typeof test>[1]>[1]
type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const usage = (read: number, write: number): Usage => ({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: read, cache_creation_input_tokens: write })

// A category of the context window's breakdown.
const part = (name: string, tokens: number, kind: string) => ({ name, tokens, kind, color: 'promptBorder', isDeferred: false })

// The color the Compact now button is drawn in, when it has one: its pill's.
const compactColor = async (ui: any) => (await ui.find({ key: 'ctl-compact-now' }))?.props.borderColor

// What the engine would answer beneath the plugin; `world` is what a test
// sets up and reads back.
function engine(on: On) {
  const world = {
    stepUsage: [] as Usage[],
    fork: { isAnswered: true, text: 'ok', usage: usage(100_000, 0) } as any,
    forks: 0,
    compactions: 0,
    isHeadless: false,
    compactCommands: 0,
    // Holds a compaction, and `/compact`, open until what it returns settles.
    holdCompaction: null as null | (() => Promise<void>),
    toasts: [] as string[],
    sounds: [] as string[],
    store: new Map<string, unknown>(),
    transcript: '',
    stats: '',
    spend: '',
    tail: '',
    log: '',
    // Lines the mod appended to its log.
    logged: [] as string[],
    rateLimits: [] as { kind: string; percentUsed: number; resetsAt?: string }[],
    context: {} as any,
    stopReason: 'end_turn' as string | null,
    agents: [] as { id: string; description: string; type: string; status: string }[],
    tools: [] as { name: string; description: string; mcp: boolean }[],
    sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }],
    soundReads: 0,
    // Every command the mod ran.
    ran: [] as string[][],
  }
  on('ui.render', ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  on('classic.PostCompact', () => ({}))
  on('session.compact', async () => {
    if (world.isHeadless) throw new Error('not available in a headless (-p / SDK) session yet')
    await world.holdCompaction?.()
    world.compactions += 1
    return { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }
  })
  on('classic.Stop', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('agent.list', () => ({ value: world.agents }))
  on('tool.list', () => ({ value: world.tools }))
  on('prompt.compose', () => ({ sections: world.sections }))
  on('turn.step', async function* (_$, e) {
    const u = world.stepUsage.shift() ?? null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: world.stopReason as any, usage: u && { ...u, model: e.model } }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/work/innomed-erp' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: world.context, rateLimits: world.rateLimits } }))
  on('process.run', (_$, e) => {
    world.ran.push([...e.argv])
    if (e.argv.join(' ').includes('cache-clock.log')) {
      if (e.argv[2]?.includes('>>')) world.logged.push(e.argv[4] ?? '')
      return { value: { exitCode: 0, stdout: world.log, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv.join(' ').includes('--argjson since')) {
      return { value: { exitCode: 0, stdout: world.spend, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv.join(' ').includes('jq ')) {
      return { value: { exitCode: 0, stdout: world.stats, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === 'tail' && world.tail) {
      return { value: { exitCode: 0, stdout: world.tail, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const found = world.transcript && e.argv.join(' ').includes('ls ')
    return { value: { exitCode: found ? 0 : 1, stdout: found ? `${world.transcript}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'compact' }, async () => {
    world.compactCommands += 1
    await world.holdCompaction?.()
    return { text: 'Compacted' }
  })
  on('model.fork', () => {
    world.forks += 1
    return { value: world.fork }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('audio.play', (_$, e) => {
    world.sounds.push('asset' in e.clip ? e.clip.asset : '')
    return { value: undefined }
  })
  on('store.get', (_$, e) => {
    if (e.key === 'sound') world.soundReads += 1
    return { value: world.store.get(e.key) }
  })
  on('store.set', (_$, e) => {
    world.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    world.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...world.store.keys()] }))
  return world
}

async function send($: any, agentId?: string) {
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1, agentId })
  for await (const _ of step) {
  }
  if (!agentId) await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
}

const start = ($: any) => $.session.start({ cwd: '/work/innomed-erp', surface: 'desktop', isInteractive: true })

test('counts down from the last main request, then goes cold', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)

  for (const surface of ['desktop', 'terminal'] as const) {
    const before = await $.ui.mount({ plugin: 'cache-clock', surface, ...BAND(false) })
    expect(await before.find({ text: /Cache/ })).toBeUndefined()
  }

  await send($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const running = await $.ui.mount({ plugin: 'cache-clock', surface, ...BAND(true) })
    expect(await running.find({ text: /turn running/ })).toBeDefined()
  }

  await clock.advance(10 * 60_000)
  const warm = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await warm.find({ text: /50:00 left \(1h TTL\)/ })).toBeDefined()

  await clock.advance(51 * 60_000)
  const cold = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await cold.find({ text: /Cache cold/ })).toBeDefined()
  expect(await cold.find({ text: /expired 1:00 ago/ })).toBeDefined()
})

test('a subagent request starts its own 5m clock, not the main one', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  await send($, 'a1')

  const running = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await running.find({ text: /Cache warm/ })).toBeUndefined()
  expect(await running.find({ text: /running/ })).toBeDefined()
  await clock.advance(10 * 60_000)
  const stillRunning = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await stillRunning.find({ text: /running/ })).toBeDefined()

  await send($, 'a1')
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'lean', agent_transcript_path: '/none.jsonl', stop_hook_active: false })
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /5:00 left to resume/ })).toBeDefined()

  const viewed = await $.ui.mount({
    plugin: 'cache-clock',
    surface: 'desktop',
    ...BAND(false),
    props: { ...BAND(false).props, view: { agentId: 'a1' } },
  })
  expect(await viewed.find({ text: /Subagent cache warm/ })).toBeDefined()

  await clock.advance(6 * 60_000)
  const later = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await later.find({ text: /resume/ })).toBeUndefined()
  const viewedLater = await $.ui.mount({
    plugin: 'cache-clock',
    surface: 'desktop',
    ...BAND(false),
    props: { ...BAND(false).props, view: { agentId: 'a1' } },
  })
  expect(await viewedLater.find({ text: /Subagent cache cold/ })).toBeDefined()
})

test('compaction shows the new context as uncached until the next message', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  await send($)
  await clock.advance(2 * 3_600_000)

  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 'summary' })
  const compacted = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await compacted.find({ text: /Compacted/ })).toBeDefined()

  await send($)
  const warm = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await warm.find({ text: /60:00 left/ })).toBeDefined()
})

test("a subagent's own compaction leaves the main chat's cache as it was", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  await send($)
  await clock.advance(60_000)

  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary', agent_id: 'a1', agent_type: 'mt-port' } as any)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /Compacted/ })).toBeUndefined()
  expect(await band.find({ text: /59:00 left/ })).toBeDefined()
})

test("a background subagent's compaction, reported without its agent_id, leaves the chat's cache as it was", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  const at = new Date(1_000_000).toISOString()
  const row = (o: object) => JSON.stringify({ timestamp: at, isSidechain: false, ...o })
  world.tail = [
    row({ type: 'user', message: { role: 'user', content: 'go' } }),
    row({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { ...usage(100_000, 0), cache_creation: { ephemeral_1h_input_tokens: 0 } } } }),
  ].join('\n')
  await $.classic.SessionStart({ session_id: 'self', transcript_path: '/p/self.jsonl', cwd: '/work', hook_event_name: 'SessionStart', source: 'startup' } as any)

  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' } as any)
  await clock.advance(20_000)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /Compacted/ })).toBeUndefined()

  world.tail += '\n' + row({ type: 'system', subtype: 'compact_boundary' })
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 'summary' } as any)
  const compacted = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await compacted.find({ text: /Compacted/ })).toBeDefined()
})

test("on a Team plan the security default passes Stop and PostCompact on past the mod: the turn's TTL and a /compact still show", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  let mtimeMs = 1
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs } }))
  const at = new Date(1_000_000).toISOString()
  const row = (o: object) => JSON.stringify({ timestamp: at, isSidechain: false, ...o })
  await start($)
  // A new chat: its transcript is written with the first message, on usage credits' 5m.
  world.transcript = '/p/self.jsonl'
  world.tail = [
    row({ type: 'user', message: { role: 'user', content: 'go' } }),
    row({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { ...usage(0, 100_000), cache_creation: { ephemeral_5m_input_tokens: 100_000 } } } }),
  ].join('\n')
  await send($)
  await clock.advance(4_000)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /\(5m TTL\)/ })).toBeDefined()

  world.tail += '\n' + row({ type: 'system', subtype: 'compact_boundary' })
  mtimeMs = 2
  await clock.advance(2_000)
  const compacted = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await compacted.find({ text: /Compacted/ })).toBeDefined()
})

test('a model switch reads cold until switched back', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on)
  await send($)

  await $.classic.PostModelSwitch(SWITCH)
  const switched = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await switched.find({ text: /switched to claude-sonnet-5-5/ })).toBeDefined()

  await $.classic.PostModelSwitch({ ...SWITCH, from_model: 'claude-sonnet-5-5', to_model: 'claude-opus-5-5' })
  const back = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await back.find({ text: /Cache warm/ })).toBeDefined()
})

// Claude Code's own idle compaction arrives as an `auto` compaction between turns.
const idleCompact = ($: any) => $.session.compact({ trigger: 'auto', messages: [] })

test('Claude Code\'s idle compaction waits while keep-warm will refresh, and follows the Compact button after', { options: { keepWarm: true, keepWarmMax: 1 } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await start($)
  world.stepUsage.push(usage(0, 250_000))
  await send($)
  await clock.advance(54 * 60_000)

  // Keep-warm has its refresh to send: the chat is not compacted.
  expect((await idleCompact($)).skip).toMatch(/keep-warm is holding/)
  expect(world.compactions).toBe(0)

  // A subagent's turn is not this chat's.
  await $.turn.start({ text: 'sub', turnId: 's1', agentId: 'a1' } as any)
  expect((await idleCompact($)).skip).toMatch(/keep-warm is holding/)

  // Inside a turn it is the engine's compaction at the context threshold: never held.
  await $.turn.start({ text: 'go', turnId: 't2' })
  expect((await idleCompact($)).skip).toBeUndefined()
  expect(world.compactions).toBe(1)
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  // Nor once a prompt is in, before its turn.start arrives.
  await $.prompt.submit({ text: 'next', asUser: true })
  expect((await idleCompact($)).skip).toBeUndefined()
  expect(world.compactions).toBe(2)
  await $.turn.complete({ turnId: 't3', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })

  // Keep-warm off: compacting is on by default, so it goes ahead.
  await $.command.run({ command: 'keep-warm', args: 'off' })
  expect((await idleCompact($)).skip).toBeUndefined()
  expect(world.compactions).toBe(3)
})

test('with compacting off, Claude Code\'s idle compaction is skipped', { options: { keepWarm: false, autoCompact: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await start($)
  world.stepUsage.push(usage(0, 250_000))
  await send($)
  await clock.advance(54 * 60_000)
  expect((await idleCompact($)).skip).toMatch(/compacting is off/)
  expect(world.compactions).toBe(0)
  // The person's own /compact is theirs.
  expect((await $.session.compact({ trigger: 'manual', messages: [] })).skip).toBeUndefined()
  expect(world.compactions).toBe(1)
})

test('keep-warm refreshes before expiry, up to its limit, then compacts', { options: { keepWarm: true, keepWarmMax: 2, autoCompact: true }, timeoutMs: 15_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await start($)
  await send($)

  await clock.advance(57 * 60_000)
  expect(world.forks).toBe(0)
  await clock.advance(90_000)
  expect(world.forks).toBe(1)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /refreshed 1\/2/ })).toBeDefined()
  expect(await band.find({ text: /5\d:\d\d left/ })).toBeDefined()
  await band.unmount()

  await clock.advance(60 * 60_000)
  expect(world.forks).toBe(2)
  expect(world.toasts.length).toBe(0)

  const spent = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await spent.find({ text: /refreshed 2\/2, compacts before it goes cold/ })).toBeDefined()
  await spent.unmount()

  // The limit is reached: the next approach to expiry compacts instead of
  // alerting, once, while the cache is still warm.
  await clock.advance(54 * 60_000)
  expect(world.compactions).toBe(0)
  expect(world.toasts.length).toBe(0)
  await clock.advance(2 * 60_000)
  expect(world.forks).toBe(2)
  expect(world.compactions).toBe(1)
  expect(world.toasts).toEqual([expect.stringMatching(/^Compacted .* before its cache went cold$/)])
  expect(world.sounds.includes('sounds/expiring.wav')).toBe(false)
  await clock.advance(10 * 60_000)
  expect(world.compactions).toBe(1)
  const compacted = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await compacted.find({ text: /Compacted/ })).toBeDefined()

  // A message starts a new idle stretch.
  await send($)
  const after = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await after.find({ text: /refreshed/ })).toBeUndefined()
})

test('a cache that expires while the computer sleeps says so, in the band and the log', { options: { keepWarm: true, autoCompact: true }, timeoutMs: 15_000 }, async ($, on) => {
  // Asleep, the computer's timers stop while its clock runs on: the
  // 10-second tick waits the sleep out, then comes due once, at the wake.
  let isAsleep = false
  on('clock.every', { ms: 10_000 }, async (_$, e, next) => {
    let due = await next(e)
    while (isAsleep) due = await next(e)
    return due
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  const sleep = async (ms: number) => {
    isAsleep = true
    await clock.advance(ms)
    isAsleep = false
    await clock.advance(10_000)
  }
  const hm = (at: number) => `(\\w+ \\d+ )?${new Date(at).getHours()}:${String(new Date(at).getMinutes()).padStart(2, '0')}`
  await start($)
  await send($)

  // A nap the cache outlasts: nothing to say.
  await clock.advance(10 * 60_000)
  await sleep(5 * 60_000)
  const napped = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await napped.find({ text: /Cache warm/ })).toBeDefined()
  expect(await napped.find({ text: /slept/ })).toBeUndefined()

  // Asleep past the refresh, with a brief wake in between: one sleep, from
  // the last tick before it to the first after.
  await clock.advance(10 * 60_000)
  const from = clock.now()
  await sleep(60 * 60_000)
  await clock.advance(10_000)
  await sleep(20 * 60_000)
  const to = clock.now()
  expect(world.forks).toBe(0)
  expect(world.compactions).toBe(0)
  const woke = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await woke.find({ text: new RegExp(`expired 45:40 ago while the computer slept \\(${hm(from)}–${hm(to)}\\); next message`) })).toBeDefined()

  // Awake a while, the log says it, once.
  expect(world.logged).toEqual([])
  await clock.advance(3 * 60_000)
  await clock.advance(3 * 60_000)
  expect(world.logged).toEqual([expect.stringMatching(new RegExp(`cache expired at ${hm(1_000_000 + 3_600_000)} while the computer slept \\(${hm(from)}–${hm(to)}\\)$`))])

  await send($)
  const after = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await after.find({ text: /slept/ })).toBeUndefined()
})

test('with keep-warm off, compacting on compacts a big chat before it goes cold, a small one not', { options: { keepWarm: false, autoCompact: true }, timeoutMs: 15_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000), usage(0, 10_000))
  await start($)
  await send($)

  // The alert says it will compact.
  await clock.advance(55.5 * 60_000)
  expect(world.toasts).toEqual([expect.stringMatching(/otherwise it compacts with 2:00 left$/)])
  expect(world.compactions).toBe(0)

  // Then it compacts, once, without refreshing.
  await clock.advance(3 * 60_000)
  expect(world.compactions).toBe(1)
  expect(world.forks).toBe(0)
  expect(world.toasts[1]).toMatch(/^Compacted .* before its cache went cold$/)
  await clock.advance(10 * 60_000)
  expect(world.compactions).toBe(1)

  // Where the engine refuses the call (Desktop, an SDK host), `/compact` runs instead.
  world.isHeadless = true
  world.stepUsage.unshift(usage(0, 100_000))
  await send($)
  await clock.advance(59 * 60_000)
  expect(world.compactCommands).toBe(1)
  expect(world.toasts.at(-1)).toMatch(/^Compacted .* before its cache went cold$/)
  await clock.advance(10 * 60_000)
  expect(world.compactCommands).toBe(1)

  // A small chat is left to go cold.
  await send($)
  await clock.advance(70 * 60_000)
  expect(world.compactions).toBe(1)
})

test('keep-warm with compacting off lets a spent cache go cold with the alert; the band button turns compacting on', { options: { keepWarm: true, keepWarmMax: 1, autoCompact: false }, timeoutMs: 15_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000))
  await start($)
  await send($)
  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(1)

  // Spent: the alert comes, nothing compacts.
  await clock.advance(55 * 60_000)
  expect(world.compactions).toBe(0)
  expect(world.toasts).toEqual([expect.stringMatching(/expires in \d:\d\d: send a message to keep it$/)])
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /Compact: off/ })).toBeDefined()

  // Switched on for this chat: it compacts before the cache goes cold.
  await band.press({ key: 'compact-toggle' })
  await clock.advance(3 * 60_000)
  expect(world.compactions).toBe(1)
  expect(world.forks).toBe(1)
})

test('keep-warm stops itself when a refresh reads little from cache', { options: { keepWarm: true }, timeoutMs: 15_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.fork = { isAnswered: true, text: 'ok', usage: usage(0, 100_000) }
  await start($)
  await send($)

  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(1)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /Keep-warm paused until your next message/ })).toBeDefined()
  expect(await band.find({ text: /Keep-warm: on/ })).toBeDefined()
  await clock.advance(30 * 60_000)
  expect(world.forks).toBe(1)

  // The next message lifts the pause.
  world.fork = { isAnswered: true, text: 'ok', usage: usage(100_000, 0) }
  await send($)
  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(2)
})

// A transcript's requests with the person's pauses between them, in minutes.
const paused = (minutes: number[]) => {
  const rows: (string | number)[][] = [[1_000, 10, 0, 50_000]]
  let t = 1_000
  for (const m of minutes) {
    t += m * 60
    rows.push([t - 1, 'U'], [t, 10, 50_000, 100])
  }
  return rows.map(r => r.join('\t')).join('\n')
}

test('the keep-warm button goes off, on, auto; auto refreshes only while this chat\'s pauses say you are likely back in time', { options: { keepWarm: false, keepWarmMax: 3, autoCompact: false }, timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 100_000_000 })
  const world = engine(on)
  world.stats = paused([70, 75, 80, 90, 100])
  await start($)
  await send($)
  await $.classic.Stop({ transcript_path: '/p/self.jsonl' } as any)

  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  // One glyph a state; hovering it names the state.
  const glyph = async () => (await band.find({ key: 'keep-warm' }))?.props.label
  expect(await glyph()).toBe('Keep-warm: off')
  expect(await band.find({ text: /^ · Keep-warm: off, / })).toBeDefined()
  await band.press({ key: 'keep-warm' })
  expect(await glyph()).toBe('Keep-warm: on')
  await band.press({ key: 'keep-warm' })
  expect(await glyph()).toBe('Keep-warm: auto')
  // A mounted band is drawn again at every second of the hours below.
  await band.unmount()

  // Every past pause past an hour ended within the next: one refresh.
  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(1)
  // None lasted past two hours and ended in the third: no second one, and
  // the expiry alert goes out as it would with keep-warm spent.
  await clock.advance(60 * 60_000)
  expect(world.forks).toBe(1)
  const declined = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await declined.find({ text: ' · auto: no refresh, you are seldom back in time' })).toBeDefined()
  expect(world.toasts).toEqual([expect.stringMatching(/expires in \d:\d\d: send a message to keep it$/)])

  // The next message starts over, auto kept.
  await send($)
  const again = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await again.find({ text: 'Keep-warm: auto' })).toBeDefined()
  expect(await again.find({ text: / · auto: no refresh/ })).toBeUndefined()

  await (await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })).press({ key: 'keep-warm' })
  expect(await (await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })).find({ text: 'Keep-warm: off' })).toBeDefined()
})

test('auto keep-warm does not refresh a chat whose pauses run long', { options: { keepWarm: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 100_000_000 })
  const world = engine(on)
  world.stats = paused([600, 700, 800, 900, 30])
  await start($)
  await send($)
  await $.classic.Stop({ transcript_path: '/p/self.jsonl' } as any)
  expect((await $.command.run({ command: 'keep-warm', args: 'auto' })).text).toMatch(/^Keep-warm auto: /)
  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(0)
})

test('keep-warm switched off by option, then on per chat', { options: { keepWarm: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await start($)
  await send($)
  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(0)
  expect(world.toasts.length).toBe(1)
  expect(world.compactions).toBe(0)

  const out = await $.command.run({ command: 'keep-warm', args: 'on' })
  expect(out.text).toMatch(/Keep-warm on/)
  await send($)
  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(1)
})

test('a message that should have read the cache but did not is flagged', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000), usage(1_000, 100_000), usage(101_000, 500))
  await send($)
  const first = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await first.find({ text: /missed the cache/ })).toBeUndefined()

  await clock.advance(10 * 60_000)
  await send($)
  const missed = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await missed.find({ text: /missed the cache/ })).toBeDefined()
  expect(await missed.find({ text: /read 1k of ~100k/ })).toBeDefined()

  await send($)
  const hit = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await hit.find({ text: /missed the cache/ })).toBeUndefined()
})

test('a message sent as the chat compacts, before the mod has seen the compaction, is no miss', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await $.classic.SessionStart({ session_id: 'self', transcript_path: '/p/self.jsonl', cwd: '/work', hook_event_name: 'SessionStart', source: 'startup' } as any)
  world.stepUsage.push(usage(0, 250_000), usage(54_000, 25_000))
  await send($)

  // The chat compacted and a queued message went out at once: the boundary
  // row is in the transcript, the compaction not yet in the mod's record.
  await clock.advance(60_000)
  world.tail = JSON.stringify({ timestamp: new Date(1_050_000).toISOString(), isSidechain: false, type: 'system', subtype: 'compact_boundary' })
  await send($)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /missed the cache/i })).toBeUndefined()
  expect(await band.find({ text: /79k cached/ })).toBeDefined()
})

test('a miss names what changed ahead of the conversation since the request before', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  const tool = (name: string, description = name) => ({ name, description, mcp: name.startsWith('mcp__') })
  world.tools = [tool('Bash'), tool('Read')]
  world.stepUsage.push(usage(0, 100_000), usage(1_000, 100_000), usage(1_000, 100_000), usage(1_000, 100_000))
  await send($)

  // An MCP server connected between the two messages.
  world.tools = [tool('Bash'), tool('Read'), tool('mcp__github__search'), tool('mcp__github__pr')]
  await clock.advance(60_000)
  await send($)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: '⚠ Missed the cache: MCP github connected' })).toBeDefined()

  // A section of the system prompt changed, and a tool's description.
  world.sections = [...world.sections, { id: 'memory', text: 'Remember this.', scope: 'shared' }]
  world.tools = world.tools.map(t => (t.name === 'Read' ? tool('Read', 'Reads files.') : t))
  await clock.advance(60_000)
  await send($)
  const again = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await again.find({ text: '⚠ Missed the cache: Read tool description changed; system prompt changed (memory)' })).toBeDefined()

  // Nothing this side can see changed: no cause is guessed.
  await clock.advance(60_000)
  await send($)
  const plain = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await plain.find({ text: '⚠ Last message missed the cache' })).toBeDefined()
})

test("other chats' caches show in the band, this chat's is published", async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const world = engine(on)
  world.store.set('chat:erp', { label: 'ERP', at: 10_000_000 - 20 * 60_000, ttlMin: 60 })
  world.store.set('chat:kiosk', { label: 'Kiosk', at: 10_000_000 - 57 * 60_000, ttlMin: 60 })
  // Side chats carry their parent's title: listed once, the latest cache.
  world.store.set('chat:erp-side', { label: 'ERP', at: 10_000_000 - 50 * 60_000, ttlMin: 60 })
  world.store.set('chat:self-side', { label: 'innomed-erp', at: 10_000_000 - 5 * 60_000, ttlMin: 60 })
  world.store.set('chat:old', { label: 'Old', at: 10_000_000 - 3 * 3_600_000, ttlMin: 60 })
  world.store.set('chat:stale', { label: 'Stale', at: 10_000_000 - 2 * 86_400_000, ttlMin: 60 })
  await start($)
  world.stepUsage.push(usage(127_000, 0))
  await send($)
  await clock.advance(10_000)

  expect((world.store.get('chat:self') as any)?.label).toBe('innomed-erp')
  expect(world.store.has('chat:stale')).toBe(false)
  for (const surface of ['desktop', 'terminal'] as const) {
    const band = await $.ui.mount({ plugin: 'cache-clock', surface, ...BAND(false) })
    expect(await band.find({ text: /2 other chats$/ })).toBeDefined()
    expect(await band.find({ text: /expires in/ })).toBeUndefined()
    expect(await band.find({ text: /^Kiosk$/ })).toBeDefined()
    expect(await band.find({ text: /^ERP$/ })).toBeDefined()
    expect(await band.find({ text: /39:5\d/ })).toBeDefined()
    expect(await band.find({ text: /Old/ })).toBeUndefined()
  }

  // Stats off, the list has the row to itself: one row, its top line shown,
  // where the desktop otherwise centres the wrapped list over the line above.
  await (await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })).press({ key: 'stats-toggle' })
  const off = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await off.find({ text: /^Kiosk$/ })).toBeDefined()
  expect((await off.find({ key: 'detail' }))?.props).toMatchObject({ height: 1, overflow: 'hidden', alignItems: 'flex-start' })
})

test("the other chats' hover opens with the week across chats: what warm returns saved, what every chat spent", async ($, on) => {
  const now = 10_000_000_000
  const clock = mock.clock(on, { now })
  const world = engine(on)
  const day = (at: number) => {
    const d = new Date(at)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  world.transcript = '/p/self.jsonl'
  world.rateLimits = [{ kind: 'seven_day', percentUsed: 36, resetsAt: new Date(now + 86_400_000).toISOString() }]
  const since = now + 86_400_000 - 7 * 86_400_000
  // This chat: $1.30 this week, as the stats test has it.
  world.spend = ['claude-opus-5-5\t0\t1000000\t0\t0\t10000', 'claude-opus-5-5\t0\t2000000\t100000\t0\t0'].join('\n')
  // Another chat's week; one from last week's window is left out.
  world.store.set('spend:erp', { since, total: 8.7, at: now - 3_600_000 })
  world.store.set('spend:older', { since: since - 7 * 86_400_000, total: 99, at: now - 6 * 86_400_000 })
  world.store.set('reward-days', { [day(now)]: 2.5, [day(now - 10 * 86_400_000)]: 100 })
  world.store.set('chat:erp', { label: 'ERP', at: now - 20 * 60_000, ttlMin: 60 })
  world.store.set('keep-warm:erp', { at: now - 3_600_000, days: { [day(now)]: { paid: 1, saved: 3, refreshes: 10, held: 2, lost: 1 }, [day(now - 10 * 86_400_000)]: { paid: 50 } } })
  await start($)
  world.stepUsage.push(usage(127_000, 0))
  await send($)
  await clock.advance(10_000)
  await clock.advance(10_000)

  expect(Math.round((world.store.get('spend:self') as any)?.total * 100)).toBe(130)
  for (const surface of ['desktop', 'terminal'] as const) {
    const band = await $.ui.mount({ plugin: 'cache-clock', surface, ...BAND(false) })
    expect(
      await band.find({ text: 'This week, all chats: saved $2.50 · spent $10.00   ' }),
    ).toBeDefined()
    // Keep-warm's week counts every chat's ledger, this one's and ERP's.
    expect(await band.find({ text: /Keep-warm, all chats/ })).toBeDefined()
    expect(await band.find({ text: ' this week ≈$1.00 for 10 refreshes, saved ≈$3.00 on 2 returns: paid back 3.0× · 1 pause went cold anyway' })).toBeDefined()
    expect(await band.find({ text: /^ERP$/ })).toBeDefined()
  }

  // Stats off, the week's figures go with them; the list is labelled instead.
  await (await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })).press({ key: 'stats-toggle' })
  const off = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await off.find({ text: /This week/ })).toBeUndefined()
  expect(await off.find({ text: 'Other chats  ' })).toBeDefined()
  expect(await off.find({ text: /^ERP$/ })).toBeDefined()
})

test("two accounts sharing the store (Graft) keep their own chats and week; a chat's old ledger moves to its account", async ($, on) => {
  const now = 10_000_000_000
  const clock = mock.clock(on, { now })
  mock.env(on, { CLAUDE_CODE_ORGANIZATION_UUID: 'org-a' })
  const world = engine(on)
  const day = (at: number) => {
    const d = new Date(at)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  world.transcript = '/p/self.jsonl'
  world.rateLimits = [{ kind: 'seven_day', percentUsed: 36, resetsAt: new Date(now + 86_400_000).toISOString() }]
  const since = now + 86_400_000 - 7 * 86_400_000
  world.spend = ['claude-opus-5-5\t0\t1000000\t0\t0\t10000', 'claude-opus-5-5\t0\t2000000\t100000\t0\t0'].join('\n')
  const kwDay = { paid: 1, saved: 3, refreshes: 10, held: 2, lost: 1 }
  // This account's.
  world.store.set('org:org-a/chat:kiosk', { label: 'Kiosk', at: now - 20 * 60_000, ttlMin: 60 })
  world.store.set('org:org-a/spend:kiosk', { since, total: 2, at: now - 3_600_000 })
  world.store.set('org:org-a/reward-days', { [day(now)]: 1 })
  // The other account's: neither shown nor counted, nor touched.
  world.store.set('org:org-b/chat:erp', { label: 'ERP', at: now - 20 * 60_000, ttlMin: 60 })
  world.store.set('org:org-b/spend:erp', { since, total: 8.7, at: now - 3_600_000 })
  world.store.set('org:org-b/keep-warm:erp', { at: now - 3_600_000, days: { [day(now)]: { ...kwDay, paid: 50 } } })
  // From before accounts were told apart: this chat's ledger moves over; the
  // rest is neither shown nor counted, and goes once stale.
  world.store.set('keep-warm:self', { at: now - 3_600_000, days: { [day(now)]: kwDay } })
  world.store.set('chat:legacy', { label: 'Legacy', at: now - 20 * 60_000, ttlMin: 60 })
  world.store.set('chat:stale', { label: 'Stale', at: now - 2 * 86_400_000, ttlMin: 60 })
  world.store.set('spend:legacy', { since, total: 50, at: now - 3_600_000 })
  world.store.set('reward-days', { [day(now)]: 2.5 })
  await start($)
  world.stepUsage.push(usage(127_000, 0))
  await send($)
  await clock.advance(10_000)
  await clock.advance(10_000)

  expect((world.store.get('org:org-a/chat:self') as any)?.label).toBe('innomed-erp')
  expect(Math.round((world.store.get('org:org-a/spend:self') as any)?.total * 100)).toBe(130)
  expect(world.store.has('chat:self')).toBe(false)
  expect(world.store.has('spend:self')).toBe(false)
  expect(world.store.has('keep-warm:self')).toBe(false)
  expect((world.store.get('org:org-a/keep-warm:self') as any)?.days?.[day(now)]?.refreshes).toBe(10)
  expect(world.store.has('chat:stale')).toBe(false)
  expect(world.store.has('chat:legacy')).toBe(true)
  expect((world.store.get('org:org-b/spend:erp') as any)?.total).toBe(8.7)
  for (const surface of ['desktop', 'terminal'] as const) {
    const band = await $.ui.mount({ plugin: 'cache-clock', surface, ...BAND(false) })
    expect(
      await band.find({ text: 'This week, all chats: saved $1.00 · spent $3.30   ' }),
    ).toBeDefined()
    expect(await band.find({ text: ' this week ≈$1.00 for 10 refreshes, saved ≈$3.00 on 2 returns: paid back 3.0× · 1 pause went cold anyway' })).toBeDefined()
    expect(await band.find({ text: /^Kiosk$/ })).toBeDefined()
    expect(await band.find({ text: /^ERP$/ })).toBeUndefined()
    expect(await band.find({ text: /Legacy/ })).toBeUndefined()
  }
})

test('/keep-warm now refreshes at once while warm, and refuses when cold', { options: { keepWarm: false }, timeoutMs: 15_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await start($)
  await send($)
  await clock.advance(10 * 60_000)

  const out = await $.command.run({ command: 'keep-warm', args: 'now' })
  expect(out.text).toMatch(/refresh read 100k of 100k tokens from cache/)
  expect(world.forks).toBe(1)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /60:00 left/ })).toBeDefined()

  for (let i = 0; i < 12; i++) await clock.advance(10 * 60_000)
  const cold = await $.command.run({ command: 'keep-warm', args: 'now' })
  expect(cold.text).toMatch(/cold/)
  expect(world.forks).toBe(1)
})

test("a finished subagent keeps its task name from the meta file beside its transcript", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  on('fs.read', (_$, e) => ({
    value: e.path === '/p/self/subagents/agent-a1.meta.json' ? JSON.stringify({ agentType: 'lean', description: 'Match 46 services to paper forms' }) : '',
  }))
  await start($)
  await send($, 'a1')
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'lean', agent_transcript_path: '/p/self/subagents/agent-a1.jsonl', stop_hook_active: false })

  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /^Match 46 services to paper/ })).toBeDefined()
})

test("a background subagent the engine lists as running shows as running, then counts down once idle", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await start($)
  world.agents = [{ id: 'bg1', description: 'Port rows 304/387 Tusell', type: 'mt-port', status: 'running' }]
  await clock.advance(20 * 60_000)

  const running = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await running.find({ text: /^Port rows 304\/387 Tusell$/ })).toBeDefined()
  expect(await running.find({ text: /running/ })).toBeDefined()

  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(3000)
  const stopped = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await stopped.find({ text: /running/ })).toBeUndefined()
  expect(await stopped.find({ text: /4:5\d left to resume/ })).toBeDefined()
})

test('an agent id the engine does not list (a fork, a side request) is not shown', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await start($)
  world.agents = [{ id: 'real', description: 'Match 46 services to paper forms', type: 'lean', status: 'running' }]
  await send($, 'side-loop')
  await clock.advance(3000)

  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /^Match 46 services to paper/ })).toBeDefined()
  expect(await band.find({ text: /^subagent$/ })).toBeUndefined()
})

test('a pause past the TTL whose return still read the cache counts as kept warm', async ($, on) => {
  const clock = mock.clock(on, { now: 20_000_000 })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  // A first write; 2h later a read (keep-warm held it); 2h later a rebuild;
  // 4m later a read.
  const sec = (ms: number) => Math.floor(ms / 1000)
  world.stats = [
    [sec(1_000_000), 10, 0, 50_000],
    [sec(8_190_000), 'U'],
    [sec(8_200_000), 10, 50_000, 500],
    [sec(15_390_000), 'U'],
    [sec(15_400_000), 10, 0, 51_000],
    [sec(15_630_000), 'U'],
    [sec(15_640_000), 10, 51_000, 500],
  ]
    .map(r => r.join('\t'))
    .join('\n')
  await start($)
  world.stepUsage.push(usage(51_500, 0))
  await send($)
  await clock.advance(10_000)

  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: / · 1 cold · 1 kept$/ })).toBeDefined()
  // Each bar's hover card says when the pause began, how long, and how it ended.
  expect(await band.find({ text: /^\d+:\d\d · 2h away · keep-warm held the cache$/ })).toBeDefined()
  expect(await band.find({ text: /^\d+:\d\d · 2h away · cache went cold$/ })).toBeDefined()
  expect(await band.find({ text: /^\d+:\d\d · 4m away · cache still warm$/ })).toBeDefined()
  // At 60 columns a tick on the context chart spans two requests; the reads
  // chart, with fewer and wider bars, still has one each.
  const narrow = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false), props: { ...BAND(false).props, bodyColumns: 60 } })
  expect(await narrow.find({ text: /^\d+:\d\d · 0% read from cache · cache rebuilt$/ })).toBeDefined()
  expect(await narrow.find({ text: /^\d+:\d\d · 51k → 52k · \+1k$/ })).toBeDefined()
  // At 100, as the desktop counts its band, one each.
  const wide = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await wide.find({ text: /^\d+:\d\d · 0% read from cache · cache rebuilt$/ })).toBeDefined()
  expect(await wide.find({ text: /^\d+:\d\d · 99% read from cache$/ })).toBeDefined()
  expect(await wide.find({ text: /^\d+:\d\d · 52k · \+500$/ })).toBeDefined()
})

test('the context tile counts the window in tokens, and the stats say whether to compact now', async ($, on) => {
  const clock = mock.clock(on, { now: 20_000_000 })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  // Four turns of one request each, every one 20k more than the last.
  const sec = (ms: number) => Math.floor(ms / 1000)
  world.stats = [100_000, 120_000, 140_000, 160_000]
    .flatMap((size, i) => [[sec(1_000_000 + i * 60_000), 'U'], [sec(1_010_000 + i * 60_000), 10, size, 0]])
    .map(r => r.join('\t'))
    .join('\n')
  // A 1M model with a 200k compaction window set: the band counts the latter.
  world.context = {
    tokens: 160_010,
    window: 1_000_000,
    percent: 16,
    breakdown: {
      categories: [part('System prompt', 10_000, 'used'), part('Messages', 150_000, 'used'), part('Free space', 7_000, 'free'), part('Autocompact buffer', 33_000, 'buffer')],
      totalTokens: 160_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
    },
  }
  await start($)
  world.stepUsage.push(usage(160_000, 0))
  await send($)
  await clock.advance(10_000)

  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: 'Context' })).toBeDefined()
  expect(await band.find({ text: ' 160k of 200k · 80% · auto in ~1 turn' })).toBeDefined()
  // A turn from auto-compaction: compact at a break of your choosing, at
  // what it costs, and when the mod would; on hover, what it costs warm and
  // cold, and what it saves a turn.
  // The verdict, and the button wearing its orange.
  expect(await band.findAll({ type: 'Text', text: /^Compact now$/ })).toHaveLength(1)
  expect(await compactColor(band)).toBe('warning')
  expect(await band.find({ text: /^ auto-compaction in ~1 turn at ~20k a turn · compacting ≈\$0\.34 · pays back in ~12 turns · mod compacts by \d+:\d\d if away$/ })).toBeDefined()
  expect(await band.find({ text: ' ≈$0.34 now, ≈$1.58 once cold' })).toBeDefined()
  expect(await band.find({ text: ' ≈$0.03 now, <$0.01 after compacting' })).toBeDefined()
  expect(await band.find({ text: 'On its own' })).toBeUndefined()
  // Each request's card on hover; no bar of what fills the window.
  expect(await band.find({ text: /^\d+:\d\d · 160k \(80%\) · \+20k$/ })).toBeDefined()
  expect(await band.find({ text: 'Messages' })).toBeUndefined()

  await band.press({ key: 'stats-toggle' })
  const off = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  // With Stats off the verdict is gone; the button still turns orange.
  expect(await off.findAll({ type: 'Text', text: /^Compact now$/ })).toHaveLength(0)
  expect(await compactColor(off)).toBe('warning')
  expect(await off.find({ text: 'Context' })).toBeUndefined()

  // Pressed, it drops the orange at once; with no compaction landed after
  // `/compact` returned, it wears it again.
  await off.press({ key: 'compact-now' })
  expect(world.compactCommands).toBe(1)
  const pressed = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await compactColor(pressed)).toBeUndefined()
  await clock.advance(15_000)
  const again = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await compactColor(again)).toBe('warning')
})

test('a chat of long tasks and short questions counts its turns at their average, and the verdict says it', async ($, on) => {
  const clock = mock.clock(on, { now: 20_000_000 })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  // Two long tasks (+70k, +110k), an auto-compaction, two short questions
  // (+1k, +2k): the median would count every turn as a long task.
  const sec = (ms: number) => Math.floor(ms / 1000)
  world.stats = [80_000, 150_000, 260_000, 110_000, 111_000, 113_000]
    .flatMap((size, i) => [[sec(1_000_000 + i * 60_000), 'U'], [sec(1_010_000 + i * 60_000), 10, size, 0]])
    .map(r => r.join('\t'))
    .join('\n')
  world.context = {
    tokens: 114_010,
    window: 300_000,
    percent: 38,
    breakdown: {
      categories: [part('System prompt', 54_000, 'used'), part('Messages', 60_000, 'used'), part('Free space', 156_000, 'free'), part('Autocompact buffer', 30_000, 'buffer')],
      totalTokens: 114_000,
      maxTokens: 300_000,
      rawMaxTokens: 300_000,
      autoCompactThreshold: 270_000,
      isAutoCompactEnabled: true,
    },
  }
  await start($)
  world.stepUsage.push(usage(114_000, 0))
  await send($)
  await clock.advance(10_000)

  // At ~46k a turn, auto-compaction at 270k is 4 turns off: not orange yet.
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /^ room for ~4 turns at ~46k a turn · / })).toBeDefined()
  expect(await compactColor(band)).toBeUndefined()
})

test('the band shows cache stats under this chat, and a wide band two subagents to a row', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  // A first write; a prompt and a read 1m later; a prompt and a rebuild 2h
  // later; a tool round; a prompt and a read 4m after that.
  const sec = (ms: number) => Math.floor(ms / 1000)
  world.stats = [
    [sec(1_000_000), 10, 0, 50_000],
    [sec(1_050_000), 'U'],
    [sec(1_060_000), 10, 50_000, 1_000],
    [sec(8_250_000), 'U'],
    [sec(8_260_000), 10, 0, 60_000],
    [sec(8_560_000), 10, 60_000, 500],
    [sec(8_790_000), 'U'],
    [sec(8_800_000), 10, 60_500, 500],
  ]
    .map(r => r.join('\t'))
    .join('\n')
  const wide = { ...BAND(false), props: { ...BAND(false).props, bodyColumns: 160 } }

  await start($)
  world.stepUsage.push(usage(127_000, 0))
  await send($)
  await clock.advance(10_000)

  const lone = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...wide })
  // What going cold costs is on the chat's line; no row repeats it.
  expect(await lone.find({ text: /127k cached · ≈\$\d+\.\d\d if cold$/ })).toBeDefined()
  expect(await lone.find({ text: /≈40×/ })).toBeUndefined()
  expect(await lone.find({ text: /^ \d+% · 1 rebuild$/ })).toBeDefined()
  expect(await lone.find({ text: ' median 4m · 1 cold' })).toBeDefined()
  // No refresh this week: nothing spent on keep-warm.
  expect(await lone.find({ text: ' nothing spent in 7 days' })).toBeDefined()

  // The band's stats button switches them off for this chat, and back on.
  await lone.press({ key: 'stats-toggle' })
  const off = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...wide })
  expect(await off.find({ text: / median 4m/ })).toBeUndefined()
  expect(await off.find({ text: 'Stats: off' })).toBeDefined()
  await off.press({ key: 'stats-toggle' })

  world.agents = [1, 2, 3, 4, 5].map(n => ({ id: `a${n}`, description: `Task ${n}`, type: 'general-purpose', status: 'running' }))
  await clock.advance(2_000)
  const busy = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...wide })
  for (const n of [1, 2, 3, 4, 5]) expect(await busy.find({ text: `Task ${n}` })).toBeDefined()
  expect(await busy.find({ text: /more subagents/ })).toBeUndefined()
  expect(await busy.find({ text: / median 4m/ })).toBeDefined()

  const narrow = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await narrow.find({ text: /\+3 more subagents/ })).toBeDefined()
  expect(await narrow.find({ text: / median 4m/ })).toBeDefined()
})

test("a new chat, whose transcript did not exist yet when it started, shows its stats once a turn names it", async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const world = engine(on)
  world.stats = [[1_000, 10, 0, 50_000], [1_060, 'U'], [1_070, 10, 50_000, 1_000]].map(r => r.join('\t')).join('\n')
  await start($)
  world.stepUsage.push(usage(0, 50_000))
  await send($)
  await $.classic.Stop({ transcript_path: '/p/self.jsonl' } as any)
  await clock.advance(1_000)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', ...BAND(false) })
  expect(await band.find({ text: /^ 49% · no rebuilds$/ })).toBeDefined()
})

test("a chat another started, on an empty transcript, shows its stats within a minute of its long first turn", async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  await start($)
  world.stepUsage.push(usage(0, 50_000))
  await send($)
  world.stats = [[1_000, 10, 0, 50_000], [1_060, 'U'], [1_070, 10, 50_000, 1_000]].map(r => r.join('\t')).join('\n')
  await clock.advance(70_000)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', ...BAND(false) })
  expect(await band.find({ text: /^ 49% · no rebuilds$/ })).toBeDefined()
})

test('a request that got no response leaves the timer where it was', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await send($)
  await clock.advance(30 * 60_000)
  world.stopReason = null
  await send($)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /30:00 left/ })).toBeDefined()
})

test('/clear starts the band over for the new conversation', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  await start($)
  await send($)
  await clock.advance(60_000)
  await $.classic.SessionStart({ session_id: 'new', transcript_path: '/p/new.jsonl', cwd: '/work', hook_event_name: 'SessionStart', source: 'clear' } as any)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /Cache warm/ })).toBeUndefined()
})

test('a new cache plays the mint ripple once, a warm read does not', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000), usage(100_000, 800), usage(1_000, 100_000))
  await send($)
  const minted = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await minted.find({ key: 'mint-1000000' })).toBeDefined()
  const terminal = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', ...BAND(false) })
  expect(await terminal.find({ key: 'mint-1000000' })).toBeUndefined()

  await clock.advance(5_000)
  const after = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await after.find({ key: 'mint-1000000' })).toBeUndefined()

  await clock.advance(60_000)
  await send($)
  const warm = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await warm.find({ key: 'mint-1065000' })).toBeUndefined()
  expect(await warm.find({ key: 'mint-1000000' })).toBeUndefined()

  await clock.advance(60_000)
  await send($)
  const rebuilt = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await rebuilt.find({ key: 'mint-1125000' })).toBeDefined()
})

test('a typed message on the warm cache plays a reward and counts it; a miss takes it back', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000), usage(100_000, 800), usage(1_000, 100_000))
  await send($)

  // Typed onto the warm cache.
  await clock.advance(60_000)
  await $.prompt.submit({ text: 'next', asUser: true })
  await send($)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(true) })
  expect(await band.find({ key: 'reward-1060000' })).toBeDefined()
  expect(await band.find({ text: /Saved/ })).toBeDefined()
  expect(await band.find({ text: / · 1 in a row/ })).toBeDefined()
  // Once the response says: the read, the 800 written and the 10 uncached, at $4/M.
  expect(await band.find({ text: / · prompt \$0\.03 · / })).toBeDefined()
  expect(world.sounds).toEqual(['sounds/mint.wav', 'sounds/reward-shades.wav'])
  const terminal = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', ...BAND(true) })
  expect(await terminal.find({ key: 'reward-1060000' })).toBeUndefined()
  const totals = world.store.get('reward-totals') as { saved: number; streak: number }
  expect(totals.streak).toBe(1)
  // 100k tokens read at Opus 5.5's $4/M (0.05x) instead of written again (2x).
  expect(Math.round(totals.saved * 100) / 100).toBe(0.78)
  // And into the day's total, for the week across chats.
  expect(Object.values(world.store.get('reward-days') as Record<string, number>).map(v => Math.round(v * 100) / 100)).toEqual([0.78])

  await clock.advance(5_000)
  const after = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await after.find({ key: 'reward-1060000' })).toBeUndefined()
  expect(await after.find({ text: /Cache warm/ })).toBeDefined()

  // Typed, predicted warm, but the response read little: the reward played
  // as it was sent is taken back, and the run ends.
  await clock.advance(60_000)
  await $.prompt.submit({ text: 'again', asUser: true })
  await send($)
  expect(world.sounds).toEqual(['sounds/mint.wav', 'sounds/reward-shades.wav', 'sounds/reward-mug.wav', 'sounds/mint.wav'])
  const missed = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await missed.find({ key: 'reward-1125000' })).toBeUndefined()
  expect((world.store.get('reward-totals') as { streak: number }).streak).toBe(0)
})

test('a turn nobody typed (a wake-up) plays no reward', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000), usage(100_000, 800))
  await send($)
  await clock.advance(60_000)
  await send($)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ key: 'reward-1060000' })).toBeUndefined()
  expect(world.sounds).toEqual(['sounds/mint.wav'])
})

test('Compact now runs /compact, as typing it does', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000))
  await start($)
  await send($)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await compactColor(band)).toBeUndefined()
  await band.press({ key: 'compact-now' })
  expect(world.compactCommands).toBe(1)
})

test('while a compaction runs the band says so, and Compact now does not queue another', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000))
  await start($)
  await send($)
  let release = () => {}
  const hold = () => {
    let entered = () => {}
    const isHeld = new Promise<void>(r => (entered = r))
    world.holdCompaction = () => {
      entered()
      return new Promise<void>(r => (release = r))
    }
    return isHeld
  }
  const mount = () => $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })

  // A compaction the engine runs (a `/compact`, the button's or typed) takes
  // a while, and the chat shows it only once it lands.
  let isHeld = hold()
  const compacting = $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hello', toolUses: [] }] })
  await isHeld
  await clock.advance(12_000)
  const running = await mount()
  expect(await running.find({ text: '◐ Compacting' })).toBeDefined()
  expect(await running.find({ text: ' · writing the summary, 0:12 so far; the chat shows it when done' })).toBeDefined()
  expect((await running.find({ key: 'compact-now' }))?.props.label).toBe('Compacting…')
  await running.press({ key: 'compact-now' })
  expect(world.compactCommands).toBe(0)
  release()
  await compacting
  const done = await mount()
  expect(await done.find({ text: '◐ Compacting' })).toBeUndefined()
  expect((await done.find({ key: 'compact-now' }))?.props.label).toBe('Compact now')

  // Pressed, until its `/compact` returns, a second press queues nothing.
  isHeld = hold()
  const pressed = done.press({ key: 'compact-now' })
  await isHeld
  await (await mount()).press({ key: 'compact-now' })
  release()
  await pressed
  expect(world.compactCommands).toBe(1)
})

test('the Sound button mutes every sound of the mod, in every chat, until pressed again', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000), usage(100_000, 800), usage(0, 100_000), usage(100_000, 800))
  await send($)
  expect(world.sounds).toEqual(['sounds/mint.wav'])
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  await band.press({ key: 'sound-toggle' })
  expect(world.store.get('sound')).toBe(false)
  const muted = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect((await muted.find({ key: 'sound-toggle' }))?.props.label).toBe('Sound: off')

  // A reward, and then a new cache, play their scenes silently.
  world.sounds.length = 0
  await clock.advance(60_000)
  await $.prompt.submit({ text: 'next', asUser: true })
  await send($)
  const quiet = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(true) })
  expect(await quiet.find({ key: 'reward-1060000' })).toBeDefined()
  await clock.advance(2 * 3_600_000)
  await send($)
  expect(world.sounds).toEqual([])

  await quiet.press({ key: 'sound-toggle' })
  expect(world.store.get('sound')).toBe(true)
  await clock.advance(2 * 3_600_000)
  await send($)
  expect(world.sounds).toEqual(['sounds/mint.wav'])
})

test("drawing the band reads the Sound setting from memory; another chat's press shows within 2s", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  await start($)
  await send($)
  await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  const reads = world.soundReads
  for (let i = 0; i < 5; i++) await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(world.soundReads).toBe(reads)
  world.store.set('sound', false)
  await clock.advance(2_000)
  const elsewhere = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await elsewhere.find({ text: 'Sound: off' })).toBeDefined()
})

test('a reward goes into the totals as another chat left them; no response takes it back', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  world.stepUsage.push(usage(0, 100_000), usage(100_000, 800))
  await send($)
  await clock.advance(60_000)
  await $.prompt.submit({ text: 'next', asUser: true })
  // Another chat adds to today's totals while this message runs.
  world.store.set('reward-totals', { day: new Date(1_060_000).toDateString(), saved: 5, streak: 3 })
  await send($)
  const totals = world.store.get('reward-totals') as { saved: number; streak: number }
  expect(Math.round(totals.saved * 100) / 100).toBe(5.78)
  expect(totals.streak).toBe(4)

  // Typed, but the request got no response: nothing was saved.
  await clock.advance(60_000)
  world.stopReason = null
  await $.prompt.submit({ text: 'again', asUser: true })
  await send($)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ key: 'reward-1120000' })).toBeUndefined()
  expect((world.store.get('reward-totals') as { streak: number }).streak).toBe(4)
})

const WORKFLOW = { status: 'async_launched', taskId: 'task-wf', workflowName: 'mint-animation', runId: 'wf_1' }
const RUNNING = [{ id: 'task-wf', type: 'workflow', status: 'running', description: 'mint', name: 'mint-animation' }]

test('keep-warm holds the cache while a workflow runs, then goes back to its limit', { options: { keepWarm: true, keepWarmMax: 1, autoCompact: true }, timeoutMs: 15_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  on('tool.call', () => ({ result: WORKFLOW as any }))
  await start($)
  await send($)
  await $.tool.call({ tool: 'Workflow', script: 'export const meta = {}' } as any)
  await $.classic.Stop({ background_tasks: RUNNING } as any)

  await clock.advance(58 * 60_000)
  expect(world.forks).toBe(1)
  // Past keepWarmMax: the run is still going, so it holds.
  await clock.advance(60 * 60_000)
  expect(world.forks).toBe(2)
  const held = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await held.find({ text: /keeping warm/ })).toBeUndefined()
  expect(await held.find({ text: /refreshed 2\/40/ })).toBeDefined()

  // The run ended: back to keepWarmMax, which is spent, so it compacts.
  await $.classic.Stop({ background_tasks: [] } as any)
  await clock.advance(60 * 60_000)
  expect(world.forks).toBe(2)
  expect(world.compactions).toBe(1)
  const after = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await after.find({ text: /keeping warm/ })).toBeUndefined()
  expect(await after.find({ text: /Workflow mint-animation/ })).toBeDefined()
  expect(await after.find({ text: /ended/ })).toBeDefined()
})

test('without keep-warm a running workflow is named in the expiry toast, not the band; its run stats and the cold cost show', { options: { keepWarm: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  on('tool.call', () => ({ result: WORKFLOW as any }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'wf-agent-1' }))
  world.stepUsage.push(usage(0, 100_000), usage(30_000, 10_000))
  await start($)
  await send($)
  await $.tool.call({ tool: 'Workflow', script: 'export const meta = {}' } as any)
  await $.agent.spawn({ prompt: 'design', description: 'design:pulse', workflow: { runId: 'wf_1', index: 1 } } as any)
  for await (const _ of $.turn.step({ turnId: 'w1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'wf-agent-1' })) {
  }
  await $.classic.Stop({ background_tasks: RUNNING } as any)

  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: /≈\$0\.80 if cold/ })).toBeDefined()
  expect(await band.find({ text: / · workflow mint-animation running/ })).toBeUndefined()
  expect(await band.find({ text: /1 agent · 75% of 40k prompt tokens read from cache/ })).toBeDefined()
  // Its agents are not this chat's subagents.
  expect(await band.find({ text: /left to resume/ })).toBeUndefined()

  await clock.advance(56 * 60_000)
  const low = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await low.find({ text: /still running/ })).toBeUndefined()
  expect(world.toasts[0]).toMatch(/while workflow mint-animation is still running/)
})

test('the stats weigh what keep-warm paid this week against the rewrites its held returns avoided', { options: { keepWarm: true, keepWarmMax: 1, autoCompact: false }, timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  await start($)
  world.stepUsage.push(usage(0, 250_000))
  await send($)
  // One refresh ($0.02 at list price), then a return past the cache's own
  // expiry that read it: a 250k rewrite avoided ($1.95).
  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(1)
  await clock.advance(4 * 60_000)
  world.stepUsage.push(usage(250_000, 0))
  await send($)
  const held = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await held.find({ text: ' in 7 days ≈$0.02 for 1 refresh, saved ≈$1.95 on 1 return: paid back 96.8×' })).toBeDefined()

  // The next pause outlasts the refresh: it went cold anyway.
  await clock.advance(59 * 60_000)
  expect(world.forks).toBe(2)
  await clock.advance(70 * 60_000)
  world.stepUsage.push(usage(0, 250_000))
  await send($)
  const lost = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await lost.find({ text: ' in 7 days ≈$0.04 for 2 refreshes, saved ≈$1.95 on 1 return: paid back 48.4× · 1 pause went cold anyway' })).toBeDefined()
  expect((world.store.get('keep-warm:self') as any)?.days).toBeDefined()
})

test("a chat's keep-warm from before the ledger comes from the log, counting only refreshes sent while it sat idle", { timeoutMs: 30_000 }, async ($, on) => {
  const now = 10_000_000_000
  const clock = mock.clock(on, { now })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  const sec = (ms: number) => Math.floor(ms / 1000)
  const t1 = now - 6 * 3_600_000
  const back1 = t1 + 70 * 60_000
  const t2 = now - 3 * 3_600_000
  const back2 = t2 + 130 * 60_000
  // A pause past the TTL that came back to the cache, and one that rebuilt it.
  world.stats = [
    [sec(t1), 10, 0, 200_000],
    [sec(back1) - 1, 'U'],
    [sec(back1), 10, 200_000, 500],
    [sec(t2), 10, 200_000, 500],
    [sec(back2) - 1, 'U'],
    [sec(back2), 10, 0, 210_000],
  ]
    .map(r => r.join('\t'))
    .join('\n')
  // $0.04 each; the first was sent before this chat ran, so another chat of the same name sent it.
  const line = (at: number) => `${new Date(at).toISOString()} innomed-erp · refresh read 200k of 200k tokens from cache (read 200000, write 0, input 47)`
  world.log = [t1 - 10 * 60_000, t1 + 58 * 60_000, t2 + 58 * 60_000, t2 + 116 * 60_000].map(line).join('\n')
  await start($)
  world.stepUsage.push(usage(200_000, 0))
  await send($)
  await clock.advance(6 * 60_000)
  const text = ' in 7 days ≈$0.12 for 3 refreshes, saved ≈$1.56 on 1 return: paid back 12.9× · 1 pause went cold anyway'
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  // Over the charts the week's net shows; that sentence is its hover.
  expect(await band.find({ text })).toBeDefined()
  expect(await band.find({ text: /^\+\$1\.4\d$/ })).toBeDefined()
  // Once: the next read of the stats adds nothing.
  await clock.advance(6 * 60_000)
  expect(await (await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })).find({ text })).toBeDefined()
})

// Windows has no /bin/sh, tail, grep, jq or afplay. The files the mod reads
// and writes through $.fs, every command it runs, and every child it starts.
function windows(on: On) {
  const files = new Map<string, string>()
  const spawned: { argv: readonly string[]; env?: Record<string, string> }[] = []
  const norm = (path: string) => path.replace(/\\/g, '/')
  const text = (path: string) => {
    const found = files.get(norm(path))
    if (found === undefined) throw new Error(`ENOENT: ${path}`)
    return found
  }
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: text(e.path).length, mtimeMs: 2_000_000_000_000, isLink: false } }))
  on('fs.read', (_$, e) => {
    const from = e.offset ?? 0
    return { value: text(e.path).slice(from, e.length === undefined ? undefined : from + e.length) }
  })
  on('fs.exists', (_$, e) => ({ value: files.has(norm(e.path)) }))
  on('fs.list', (_$, e) => {
    const dir = `${norm(e.path).replace(/\/$/, '')}/`
    const entries = new Map<string, 'file' | 'dir'>()
    for (const path of files.keys()) {
      if (!path.startsWith(dir)) continue
      const [name, ...more] = path.slice(dir.length).split('/')
      entries.set(name!, more.length ? 'dir' : 'file')
    }
    return { value: [...entries].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.write', (_$, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('env.get', (_$, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }))
  on('process.spawn', async function* (_$, e) {
    spawned.push({ argv: e.argv, env: e.env })
    return { value: { code: 0, signal: null } }
  })
  return { files, spawned }
}

test('on Windows the transcript is read through $.fs, with no shell: the TTL and the stats', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const world = engine(on)
  const win = windows(on)
  world.transcript = 'C:\\Users\\me\\.claude\\projects\\C--work\\self.jsonl'
  const row = (sec: number, o: object) => JSON.stringify({ timestamp: new Date(sec * 1000).toISOString(), isSidechain: false, ...o })
  const reply = (sec: number, id: string, read: number, write: number) =>
    row(sec, { type: 'assistant', requestId: id, message: { id, model: 'claude-opus-5-5', usage: { ...usage(read, write), cache_creation: { ephemeral_5m_input_tokens: write } } } })
  win.files.set(
    'C:/Users/me/.claude/projects/C--work/self.jsonl',
    [
      row(990, { type: 'user', message: { role: 'user', content: 'go' } }),
      // A response's rows repeat its usage; it counts once.
      reply(1_000, 'm1', 0, 50_000),
      reply(1_000, 'm1', 0, 50_000),
      // A tool's result is no prompt of the person's.
      row(1_001, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
      row(1_060, { type: 'user', message: { role: 'user', content: 'and now?' } }),
      reply(1_070, 'm2', 50_000, 1_000),
      row(1_071, { type: 'custom-title', customTitle: 'Windows chat' }),
    ].join('\n') + '\n',
  )
  await start($)
  world.stepUsage.push(usage(0, 50_000))
  await send($)
  await $.classic.Stop({ transcript_path: world.transcript } as any)
  await clock.advance(1_000)
  const terminal = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', ...BAND(false) })
  expect(await terminal.find({ text: /^ 49% · no rebuilds$/ })).toBeDefined()
  const desktop = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await desktop.find({ text: /\(5m TTL\)/ })).toBeDefined()
  expect(world.ran).toEqual([])
})

test('on Windows the sounds play through PowerShell, and keep-warm keeps its log through $.fs', { options: { keepWarm: true, keepWarmMax: 2, autoCompact: true }, timeoutMs: 15_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = engine(on)
  const win = windows(on)
  win.files.set('C:/Users/me/.claude/cache-clock.log', 'earlier line\n')
  world.stepUsage.push(usage(0, 100_000))
  await start($)
  await send($)
  await clock.advance(1_000)
  expect(world.sounds).toEqual([])
  expect(win.spawned[0]?.argv[0]).toBe('powershell.exe')
  expect(win.spawned[0]?.env?.CACHE_CLOCK_SOUND).toMatch(/[\\/]sounds\/mint\.wav$/)

  await clock.advance(57 * 60_000 + 90_000)
  expect(world.forks).toBe(1)
  expect(win.files.get('C:/Users/me/.claude/cache-clock.log')).toMatch(/^earlier line\n\S+ .* · refresh read .*\(read 100000, write 0, input 10\)\n$/)
  expect(world.ran).toEqual([])
})
