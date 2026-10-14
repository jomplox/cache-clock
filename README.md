# cache-clock

A mod for the **Code tab of the Claude Desktop app** that puts a countdown for each chat's **prompt cache** above the prompt, so you know when to come back before it goes cold, and what it costs if you don't.

> **Made for Claude Desktop, not the `claude` CLI.** The band, its buttons, the charts and every animation are drawn for Desktop's Code tab. In a terminal session the mod still loads, but you get a plain text line and none of the visuals; it isn't designed or tested there.

<img src="docs/band.gif" alt="The band above the prompt: Cache warm, turn running (1h TTL), 222k cached, with the Keep-warm (auto), Compact, Stats and Sound buttons, and an LED panel sweeping across as a new cache is written" width="880">

When a message you send reuses the warm cache, a little pixel Clawd celebrates what it saved:

<img src="docs/reward.gif" alt="Clawd catching a coin into a piggy bank, putting on sunglasses, sipping from a mug, blowing a bubblegum bubble that pops on his face, tipping a top hat as his monocle falls, flipping an hourglass and strumming a guitar, while 'Saved $12.36' rolls up beside him, next to what the prompt cost" width="560">

## Why

Claude Code caches your conversation so each new message only pays full price for what's new. The cache expires after a while (1 hour or 5 minutes, depending on your plan and the request; subagents use 5 minutes). A message sent after that re-writes the whole conversation at the cache-write price, which on a long chat is a real cost and a slower response. Nothing in the Desktop app tells you how long you have. This mod does.

## What it shows

- **The countdown.** `● Cache warm · 41:20 left (1h TTL) · 248k cached (≈$0.80 if it goes cold)`. It turns yellow near the end, and becomes `○ Cache cold · expired 3:10 ago` after. It knows the cache's real TTL from the transcript, and that switching models, `/compact` or `/clear` starts a new one.
- **A new cache.** When a message writes a new cache, an LED panel lights up across the band and breaks away, to a little tune of its own (mallets and bells, in step with the lights).
- **A miss.** If a message expected to read the cache didn't, the band says so, and why when it can see it: an MCP server that connected or left, a tool added, removed or reworded, a changed section of the system prompt, or a new effort level.
- **Other chats.** How many other chats have a cache; hover the count for how long each has left, soonest first (with Stats off, the list shows under the band). The list opens with the week across chats: what warm returns saved and what every chat spent at list price. It counts the chats whose session ran this week with the mod; each publishes its own total as it reads its stats.
- **Stats** (toggle in the band). What going cold would cost compared with reading the cache warm, how much of this chat was read from cache, how often it was rebuilt, and charts of both. And what this chat and its subagents spent today and this week (your plan's weekly window, else the last 7 days), at list price.
- **Subagents and workflows.** Their caches, and what a running workflow has read from cache.

### Keep-warm

Turn on keep-warm for a chat (band button, or `/keep-warm on`) and, shortly before the cache expires, the mod sends one small request that reads it and resets its timer. That costs a cache read, about a twentieth of re-writing it. After a set number of refreshes (3 by default), it stops, and the cache goes cold with the alert below, unless compacting is on. While a workflow or background agent of the chat is still running, it keeps refreshing for as long as that's cheaper than re-caching.

Press the button again for **auto** (or `/keep-warm auto`): it refreshes only when your past pauses in this chat say you're likely back before the refresh runs out. Of the pauses that lasted at least as long as this one has so far, enough must have ended in time to pay for the refresh (a read costs a small fraction of a rewrite). With fewer than 4 such pauses on record, it doesn't refresh. Where it holds off, the band says so, and the alert or compacting follows as if its refreshes were spent. The button goes off → on → auto → off.

If keep-warm is off (or has spent its refreshes), you get a toast (and a sound) about 5 minutes before the cache expires (1 minute for a 5-minute cache).

### Compact

Turn on compacting for a chat (the **Compact** band button) and, about 2 minutes before the cache expires (1 minute for a 5-minute cache), the mod **compacts the chat while the cache is still warm**, so your next message writes only the summary instead of the whole history. With keep-warm on, that happens once its refreshes are spent; with it off, right away, for chats of 30k tokens or more (a smaller one costs about as much to summarize as to re-cache). The expiry alert says it will. Sending a message first keeps the full history.

### Sound

The **Sound** button in the band mutes every sound the mod makes (the new-cache sound, the reward's, the expiry alert's) in every chat, until you press it again.

### The reward

A message **you typed** that reuses a warm cache plays a 4-second scene in the band, and `Saved $x` rolls up like an odometer beside it, with what the prompt itself cost, what you've saved today and how many warm returns in a row:

| When | Scene |
|---|---|
| Most messages, in turn | A **piggy bank** swallowing the coin, **sunglasses** dropping onto Clawd, a **mug** whose steam turns into a heart, a **bubblegum** bubble that pops all over his face, a **top hat** and a monocle that pops out when he sees the total |
| Close call (under 5 minutes left) | Clawd sprints in and flips a nearly empty **hourglass**: `with 0:41 to spare` |
| Milestone ($10, $25, $50 … saved today, or every 25 in a row) | Clawd plays the **guitar** |

The saving is real: what reading the cache cost compared with writing it all again, at list price. `prompt $y` is what the message's prompt actually cost with the cache: `≈` the cache read until the first response reports its usage, then the exact figure (input only; the reply's output isn't counted). Wake-ups from background work, scheduled prompts and other plugins' messages don't count. If the response shows the cache was missed after all, the scene is taken back and the run of warm returns ends. Under a cent, nothing plays.

## Install

Desktop's Code tab can't run `/plugin`, so install it once from a terminal (this needs the `claude` CLI on your machine; it installs for your user, and Desktop picks it up):

```
claude plugin marketplace add jomplox/cache-clock
claude plugin install cache-clock@cache-clock
```

Then open a chat in the Claude Desktop app's **Code** tab (or run `/reload-plugins` in one that's already open). The band appears above the prompt.

Requirements: the Claude Desktop app on macOS (sounds play through `afplay`), and `jq` on the `PATH` (it reads the transcript for the TTL and the stats).

## Settings

Asked when you install. To change one later, from a terminal: `echo '{"reward":"animation"}' | claude plugin configure cache-clock@cache-clock --values-stdin` (keys: `keepWarm`, `keepWarmMax`, `autoCompact`, `alert`, `otherChats`, `reward`, `stats`), then `/reload-plugins` in Desktop.

| Setting | Default | |
|---|---|---|
| Keep warm by default | off | New chats start with keep-warm on |
| Keep-warm refreshes per idle stretch | 3 | Refreshes after your last message before it stops (and compacts, if compacting is on) |
| Compact before it goes cold | off | New chats start with compacting on |
| Expiry alert | toast+sound | `toast+sound`, `toast` or `off`, when keep-warm is off |
| Show other chats | on | List your other chats' caches in the band |
| Warm-cache reward | animation+sound | `animation+sound`, `animation` or `off` |
| Show cache stats | on | New chats show the stats box |

## Commands

- `/keep-warm [on|auto|off|now]`: turn keep-warm on, auto or off for this chat, or refresh the cache right away.
- `/cache-clock-demo [reward]`: replay the new-cache animation, or each reward scene, for a minute.

## What it keeps

- Per-chat state lives in the session; other chats' caches, each chat's weekly spend and the reward totals in the mod's store, under `~/.claude/plugins/store/`.
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

`hooks/register.tsx` is the band, keep-warm and the bookkeeping. `hooks/reward.ts` draws the reward scenes (pixel-art SVG, animated with SMIL) and synthesizes their sounds on the same timeline. To try a change, copy the folder to `~/.claude/mods/cache-clock` and run `/reload-plugins` in a Desktop Code chat.

## License

[Apache 2.0](LICENSE). Clawd is Anthropic's mascot, drawn here in homage. This is a community mod, not an Anthropic product.
