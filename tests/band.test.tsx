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
    toasts: [] as string[],
    sounds: 0,
    store: new Map<string, unknown>(),
    transcript: '',
    stats: '',
    spend: '',
    rateLimits: [] as { kind: string; percentUsed: number; resetsAt?: string }[],
    stopReason: 'end_turn' as string | null,
    agents: [] as { id: string; description: string; type: string; status: string }[],
  }
  on('ui.render', ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  on('classic.PostCompact', () => ({}))
  on('session.compact', () => {
    if (world.isHeadless) throw new Error('not available in a headless (-p / SDK) session yet')
    world.compactions += 1
    return { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }
  })
  on('classic.Stop', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('agent.list', () => ({ value: world.agents }))
  on('turn.step', async function* (_$, e) {
    const u = world.stepUsage.shift() ?? null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: world.stopReason as any, usage: u && { ...u, model: e.model } }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/work/innomed-erp' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {} as any, rateLimits: world.rateLimits } }))
  on('process.run', (_$, e) => {
    if (e.argv.join(' ').includes('--argjson since')) {
      return { value: { exitCode: 0, stdout: world.spend, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv.join(' ').includes('jq ')) {
      return { value: { exitCode: 0, stdout: world.stats, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const found = world.transcript && e.argv.join(' ').includes('ls ')
    return { value: { exitCode: found ? 0 : 1, stdout: found ? `${world.transcript}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'compact' }, () => {
    world.compactCommands += 1
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
  on('audio.play', () => {
    world.sounds += 1
    return { value: undefined }
  })
  on('store.get', (_$, e) => ({ value: world.store.get(e.key) }))
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

  await clock.advance(60 * 60_000)
  expect(world.forks).toBe(2)
  expect(world.toasts.length).toBe(0)

  const spent = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await spent.find({ text: /refreshed 2\/2, compacts before it goes cold/ })).toBeDefined()

  // The limit is reached: the next approach to expiry compacts instead of
  // alerting, once, while the cache is still warm.
  await clock.advance(54 * 60_000)
  expect(world.compactions).toBe(0)
  expect(world.toasts.length).toBe(0)
  await clock.advance(2 * 60_000)
  expect(world.forks).toBe(2)
  expect(world.compactions).toBe(1)
  expect(world.toasts).toEqual([expect.stringMatching(/^Compacted .* before its cache went cold$/)])
  expect(world.sounds).toBe(0)
  await clock.advance(10 * 60_000)
  expect(world.compactions).toBe(1)
  const compacted = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await compacted.find({ text: /Compacted/ })).toBeDefined()

  // A message starts a new idle stretch.
  await send($)
  const after = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await after.find({ text: /refreshed/ })).toBeUndefined()
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

test('keep-warm with compacting off lets a spent cache go cold with the alert; the band button turns compacting on', { options: { keepWarm: true, keepWarmMax: 1 }, timeoutMs: 15_000 }, async ($, on) => {
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

test("other chats' caches show in the band, this chat's is published", async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const world = engine(on)
  world.store.set('chat:erp', { label: 'ERP', at: 10_000_000 - 20 * 60_000, ttlMin: 60 })
  world.store.set('chat:kiosk', { label: 'Kiosk', at: 10_000_000 - 57 * 60_000, ttlMin: 60 })
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
    expect(await band.find({ text: /Kiosk expires in 2:5\d/ })).toBeDefined()
    expect(await band.find({ text: /^ERP$/ })).toBeDefined()
    expect(await band.find({ text: /39:5\d/ })).toBeDefined()
    expect(await band.find({ text: /Old/ })).toBeUndefined()
  }
})

test('/keep-warm now refreshes at once while warm, and refuses when cold', { options: { keepWarm: false } }, async ($, on) => {
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
  expect(await lone.find({ text: /≈40× reading it warm/ })).toBeDefined()
  expect(await lone.find({ text: /re-caching 127k/ })).toBeDefined()
  expect(await lone.find({ text: /^ \d+% · 1 rebuild$/ })).toBeDefined()
  expect(await lone.find({ text: /typically 4m · 1 over 1h/ })).toBeDefined()
  // Nothing spent shows no spend line.
  expect(await lone.find({ text: /at list price/ })).toBeUndefined()

  // The band's stats button switches them off for this chat, and back on.
  await lone.press({ key: 'stats-toggle' })
  const off = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...wide })
  expect(await off.find({ text: /≈40×/ })).toBeUndefined()
  expect(await off.find({ text: 'Stats: off' })).toBeDefined()
  await off.press({ key: 'stats-toggle' })

  world.agents = [1, 2, 3, 4, 5].map(n => ({ id: `a${n}`, description: `Task ${n}`, type: 'general-purpose', status: 'running' }))
  await clock.advance(2_000)
  const busy = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...wide })
  for (const n of [1, 2, 3, 4, 5]) expect(await busy.find({ text: `Task ${n}` })).toBeDefined()
  expect(await busy.find({ text: /more subagents/ })).toBeUndefined()
  expect(await busy.find({ text: /≈40×/ })).toBeDefined()

  const narrow = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await narrow.find({ text: /\+3 more subagents/ })).toBeDefined()
  expect(await narrow.find({ text: /≈40×/ })).toBeDefined()
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
  expect(world.sounds).toBe(1)
  const terminal = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', ...BAND(true) })
  expect(await terminal.find({ key: 'reward-1060000' })).toBeUndefined()
  const totals = world.store.get('reward-totals') as { saved: number; streak: number }
  expect(totals.streak).toBe(1)
  // 100k tokens read at Opus 5.5's $4/M (0.05x) instead of written again (2x).
  expect(Math.round(totals.saved * 100) / 100).toBe(0.78)

  await clock.advance(5_000)
  const after = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await after.find({ key: 'reward-1060000' })).toBeUndefined()
  expect(await after.find({ text: /Cache warm/ })).toBeDefined()

  // Typed, predicted warm, but the response read little: the reward played
  // as it was sent is taken back, and the run ends.
  await clock.advance(60_000)
  await $.prompt.submit({ text: 'again', asUser: true })
  await send($)
  expect(world.sounds).toBe(2)
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
  expect(world.sounds).toBe(0)
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
  expect(await held.find({ text: /keeping warm for workflow mint-animation/ })).toBeDefined()
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

test('without keep-warm a running workflow turns amber near expiry; its run stats and the cold cost show', async ($, on) => {
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
  expect(await band.find({ text: /≈\$0\.80 if it goes cold/ })).toBeDefined()
  expect(await band.find({ text: / · workflow mint-animation running/ })).toBeDefined()
  expect(await band.find({ text: /1 agent · 75% of 40k prompt tokens read from cache/ })).toBeDefined()
  // Its agents are not this chat's subagents.
  expect(await band.find({ text: /left to resume/ })).toBeUndefined()

  await clock.advance(56 * 60_000)
  const low = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await low.find({ text: /still running; the cache expires first unless kept warm/ })).toBeDefined()
  expect(world.toasts[0]).toMatch(/while workflow mint-animation is still running/)
})

test("the stats show what this chat and its subagents spent today and this week, at list price", async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const world = engine(on)
  world.transcript = '/p/self.jsonl'
  // This week: main 1M read, 10k out ($0.40); subagents 2M read, 100k 5m
  // writes ($0.90), today. Today but before the window: main again ($0.40).
  world.spend = [
    'claude-opus-5-5\tfalse\ttrue\tfalse\t0\t1000000\t0\t0\t10000',
    'claude-opus-5-5\ttrue\ttrue\ttrue\t0\t2000000\t100000\t0\t0',
    'claude-opus-5-5\tfalse\tfalse\ttrue\t0\t1000000\t0\t0\t10000',
  ].join('\n')
  await start($)
  world.stepUsage.push(usage(127_000, 0))
  await send($)
  await clock.advance(10_000)
  const band = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await band.find({ text: ' ≈$1.30 today · ≈$1.30 in 7 days ($0.90 subagents), at list price' })).toBeDefined()

  // With a weekly rate-limit window it counts from that window's start.
  world.rateLimits = [{ kind: 'seven_day', percentUsed: 36, resetsAt: new Date(10_000_000 + 86_400_000).toISOString() }]
  await start($)
  await clock.advance(10_000)
  const later = await $.ui.mount({ plugin: 'cache-clock', surface: 'desktop', ...BAND(false) })
  expect(await later.find({ text: /≈\$1\.30 this week/ })).toBeDefined()
})
