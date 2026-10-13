# cache-clock

A [Claude Code](https://claude.com/claude-code) mod that puts a countdown for each chat's **prompt cache** above the prompt, so you know when to come back before it goes cold, and what it costs if you don't.

<img src="docs/band.gif" alt="The band above the prompt: Cache warm, turn running (1h TTL), 222k cached, with an LED panel sweeping across as a new cache is written" width="664">

When a message you send reuses the warm cache, a little pixel Clawd celebrates what it saved:

<img src="docs/reward.gif" alt="Clawd catching a coin into a piggy bank, putting on sunglasses, sipping from a mug, flipping an hourglass and strumming a guitar, while 'Saved $12.36' rolls up beside him" width="560">

## Why

Claude Code caches your conversation so each new message only pays full price for what's new. The cache expires after a while (1 hour or 5 minutes, depending on your plan and the request; subagents use 5 minutes). A message sent after that re-writes the whole conversation at the cache-write price, which on a long chat is a real cost and a slower response. Nothing in the app tells you how long you have. This mod does.

## What it shows

- **The countdown.** `● Cache warm · 41:20 left (1h TTL) · 248k cached (≈$0.80 if it goes cold)`. It turns yellow near the end, and becomes `○ Cache cold · expired 3:10 ago` after. It knows the cache's real TTL from the transcript, and that switching models, `/compact` or `/clear` starts a new one.
- **A new cache.** When a message writes a new cache, an LED panel lights up across the band and breaks away.
- **A miss.** If a message expected to read the cache didn't, the band says so.
- **Other chats.** How long each of your other chats' caches has left, and which one expires next.
- **Stats** (toggle in the band). What going cold would cost compared with reading the cache warm, how much of this chat was read from cache, how often it was rebuilt, and charts of both.
- **Subagents and workflows.** Their caches, and what a running workflow has read from cache.

### Keep-warm

Turn on keep-warm for a chat (band button, or `/keep-warm on`) and, shortly before the cache expires, the mod sends one small request that reads it and resets its timer. That costs a cache read, about a twentieth of re-writing it. After a set number of refreshes (3 by default), it **compacts the chat while the cache is still warm**, so your next message writes only the summary instead of the whole history. While a workflow or background agent of the chat is still running, it keeps refreshing for as long as that's cheaper than re-caching.

If keep-warm is off, you get a toast (and a sound) about 5 minutes before the cache expires (1 minute for a 5-minute cache).

### The reward

A message **you typed** that reuses a warm cache plays a 4-second scene in the band, and `Saved $x` rolls up like an odometer beside it, with what you've saved today and how many warm returns in a row:

| When | Scene |
|---|---|
| Most messages, in turn | A **piggy bank** swallowing the coin, **sunglasses** dropping onto Clawd, a **mug** whose steam turns into a heart |
| Close call (under 5 minutes left) | Clawd sprints in and flips a nearly empty **hourglass**: `with 0:41 to spare` |
| Milestone ($10, $25, $50 … saved today, or every 25 in a row) | Clawd plays the **guitar** |

The saving is real: what reading the cache cost compared with writing it all again, at list price. Wake-ups from background work, scheduled prompts and other plugins' messages don't count. If the response shows the cache was missed after all, the scene is taken back and the run of warm returns ends. Under a cent, nothing plays.

## Install

In a terminal:

```
claude plugin marketplace add jomplox/cache-clock
claude plugin install cache-clock@cache-clock
```

Or inside a `claude` session: `/plugin install cache-clock --marketplace jomplox/cache-clock`, answer `y` to add the marketplace, then pick the user scope. It loads in the CLI and in the Claude Desktop app's Code tab. The animations need a surface that draws images (Desktop); the terminal gets the text band.

Requirements: macOS or Linux, with `jq` on the `PATH` (it reads the transcript for the TTL and the stats). Sounds play through `afplay` on macOS.

## Settings

Under `/config` (or the app's plugin settings):

| Setting | Default | |
|---|---|---|
| Keep warm by default | off | New chats start with keep-warm on |
| Keep-warm refreshes per idle stretch | 3 | Refreshes after your last message before it compacts instead |
| Expiry alert | toast+sound | `toast+sound`, `toast` or `off`, when keep-warm is off |
| Show other chats | on | List your other chats' caches in the band |
| Warm-cache reward | animation+sound | `animation+sound`, `animation` or `off` |
| Show cache stats | on | New chats show the stats box |

## Commands

- `/keep-warm [on|off|now]`: turn keep-warm on or off for this chat, or refresh the cache right away.
- `/cache-clock-demo [reward]`: replay the new-cache animation, or each reward scene, for a minute.

## What it keeps

- Per-chat state lives in the session; other chats' caches and the reward totals in the mod's store, under `~/.claude/plugins/store/`.
- Keep-warm refreshes and compactions are logged, one line each, to `~/.claude/cache-clock.log` (trimmed to its last 500 lines once it passes 1000).
- Nothing is sent anywhere. The only requests it makes are keep-warm's own refreshes, on your account, when you turn it on.

## Prices

Savings and cold costs use list prices per million input tokens and the cache multipliers (writes 2× for a 1-hour cache, 1.25× for 5 minutes; reads 0.05× to 0.1× depending on the model). They're estimates of list-price cost, not your bill: a subscription doesn't charge per token, but a cold cache still costs usage and time.

## Development

```
claude plugin validate .
claude plugin test .
node scripts/sounds.mjs   # re-render sounds/*.wav from the scenes' timelines
```

`hooks/register.tsx` is the band, keep-warm and the bookkeeping. `hooks/reward.ts` draws the reward scenes (pixel-art SVG, animated with SMIL) and synthesizes their sounds on the same timeline. To try a change, run `claude --plugin-dir .`, or copy the folder to `~/.claude/mods/cache-clock` and run `/reload-plugins`.

## License

[Apache 2.0](LICENSE). Clawd is Anthropic's mascot, drawn here in homage. This is a community mod, not an Anthropic product.
