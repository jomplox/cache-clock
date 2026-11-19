<div align="center">

# ⏱️ cache-clock

**Never let a prompt cache go cold by accident.**

A mod for the **Code tab of the Claude Desktop app**. It shows each chat's prompt cache counting down above the prompt, keeps the cache warm while you're away, and puts a little pixel Clawd to work celebrating every dollar it saves.

[![Release](https://img.shields.io/github/v/release/jomplox/cache-clock?color=d97757&label=release)](https://github.com/jomplox/cache-clock/releases)
[![License](https://img.shields.io/github/license/jomplox/cache-clock?color=555)](LICENSE)
![Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Code_tab-d97757)
![macOS | Windows](https://img.shields.io/badge/macOS_%7C_Windows-555)

[Install](#-install) · [What it does](#-what-it-does) · [Keep-warm](#-keep-warm) · [The reward](#-the-reward) · [Settings](#%EF%B8%8F-settings)

<img src="docs/band.gif" alt="The band above the prompt: Cache warm, turn running (1h TTL), 222k cached, with the Keep-warm (auto), Compact, Stats and Sound buttons, and an LED panel sweeping across as a new cache is written" width="880">

</div>

## 💸 Why

Claude Code caches your conversation, so each new message pays full price only for what's new. The cache **expires**: after 1 hour or 5 minutes, depending on your plan and the request (subagents get 5 minutes). Send a message after that and the whole conversation is written to the cache again, at the cache-write price. On a long chat that costs real money, and the response is slower too.

Here's the difference for a 250k-token chat on Opus 5.5, at list price:

| | You come back while it's warm | You come back after it went cold |
|---|---|---|
| The cache | read: **≈ $0.05** | rewritten: **≈ $2.00** |

That's 40× more for the same message. Nothing in the Desktop app tells you how long you have left. **cache-clock does**, and by default it keeps the cache warm for you.

## 🚀 Install

Desktop's Code tab can't run `/plugin`, so you install it once from a terminal. That needs the `claude` CLI on your machine; it installs for your user, and Desktop picks it up.

```bash
claude plugin marketplace add jomplox/cache-clock
claude plugin install cache-clock@cache-clock
```

Then open a chat in the **Code** tab, or run `/reload-plugins` in a chat that's already open. The band appears above the prompt.

**You need:** the Claude Desktop app on macOS or Windows.

- **macOS:** `jq` on your `PATH` (the mod uses it to read the transcript for the TTL and the stats). Sounds play through `afplay`.
- **Windows:** nothing more. The mod reads the transcript and its log with Claude Code's own file access, so it needs no `sh`, `tail`, `grep` or `jq`. Sounds play through Windows PowerShell's `Media.SoundPlayer`. Ranged file reads need Claude Code 2.1.326 or later: on older versions the stats skip chats whose transcript is over 4 MiB.

> [!NOTE]
> **Made for Claude Desktop, not the `claude` CLI.** The band, its buttons, the charts and every animation are drawn for Desktop's Code tab. In a terminal session the mod still loads, but you get a plain text line and none of the visuals. It isn't designed or tested there.

> [!NOTE]
> **On a Team or Enterprise plan**, the band works but misses a few things unless an org Owner sets it up for the organization. See [Team and Enterprise plans](#-team-and-enterprise-plans).

## 🏢 Team and Enterprise plans

On these plans Claude Code runs its built-in security default (`sec-default@builtin`) ahead of user mods, and it passes the classic hooks on without them. You'll see `cache-clock` named in "skipped" notices. The band still works from the transcript: the TTL, prompt size and stats appear a few seconds after each reply, and a `/compact` shows as `Compacted`. What it can't do from there:

- A model switch shows only once you send the next message.
- Claude Code's own idle compaction isn't held back for keep-warm or the **Compact** button.
- A workflow run leaves the list only when it ages out.

An org Owner can run the mod ahead of the security default for the whole organization. Claude Code allows that only for a plugin the organization provides from a folder on each Mac, so the GitHub install above doesn't qualify.

<details>
<summary><b>Set it up for your organization</b> (Owner or Primary Owner)</summary>

**1. Put the mod in a root-owned folder on each Mac.** Only an admin can then change what runs for the organization.

```bash
git clone https://github.com/jomplox/cache-clock.git ~/cache-clock
```

```bash
sudo mkdir -p "/Library/Application Support/ClaudeCode/marketplaces"
```

```bash
sudo rsync -a --no-owner --no-group --delete --exclude .git ~/cache-clock/ "/Library/Application Support/ClaudeCode/marketplaces/cache-clock/"
```

Keep `--no-owner --no-group`: without them `sudo rsync -a` copies your own user onto the files.

**2. Add these keys to the managed settings** on claude.ai: **Organization settings → Claude Code → Managed settings**. Merge them with any settings already there.

```json
{
  "extraKnownMarketplaces": {
    "cache-clock": {
      "source": { "source": "directory", "path": "/Library/Application Support/ClaudeCode/marketplaces/cache-clock" }
    }
  },
  "enabledPlugins": { "cache-clock@cache-clock": true },
  "prependPlugins": ["cache-clock@cache-clock", "sec-default@builtin"]
}
```

> [!WARNING]
> Keep `sec-default@builtin` in `prependPlugins`. The list replaces the default order, and leaving it out removes the security default for everyone in the organization.

**3. Quit the Claude app fully and reopen it.** Claude Code reads managed settings at startup and then about hourly. In a new chat, no "skipped" notices name `cache-clock`.

**To update**, pull and run the same `rsync` again:

```bash
git -C ~/cache-clock pull
```

```bash
sudo rsync -a --no-owner --no-group --delete --exclude .git ~/cache-clock/ "/Library/Application Support/ClaudeCode/marketplaces/cache-clock/"
```

**Also installed for yourself?** In the organization's chats Claude Code loads only the organization's copy and ignores yours. Desktop shows that as one plugin error, which you can ignore. A personal account on the same Mac (for example a second Claude app via Graft) keeps using your own install. The two copies keep separate records, so the organization's starts with an empty week.

</details>

## ✨ What it does

| | |
|---|---|
| ⏳ **Countdown** | `● Cache warm · 41:20 left (1h TTL) · 248k cached · ≈$0.80 if cold`. It turns yellow near the end, then reads `○ Cache cold · expired 3:10 ago`. The mod knows the cache's real TTL from the transcript, and knows that switching models, `/compact` or `/clear` starts a new cache. |
| 🔥 **Keep-warm** | Shortly before the cache expires, the mod refreshes it with one small request, for about a twentieth of what a rewrite costs. [More below.](#-keep-warm) |
| 🗜️ **Compact** | Compacts the chat while its cache is still warm, so your next message writes only the summary instead of the whole history. The band's **Compact now** button runs `/compact` whenever you want it, and turns orange when auto-compaction is a few turns away, even with Stats off. While a compaction runs, the chat's line says so (`◐ Compacting · writing the summary, 0:12 so far`), and pressing again does nothing until it lands. [More below.](#%EF%B8%8F-compact) |
| 💡 **New cache** | An LED panel lights up across the band and breaks away, to a little tune of its own (mallets and bells, in step with the lights). |
| ⚠️ **Misses** | When a message should have read the cache and didn't, the band says so. If it can see why, it names the cause: an MCP server that connected or left, a tool that was added, removed or reworded, a changed section of the system prompt, or a new effort level. |
| 🗂️ **Other chats** | How many of your other chats have a cache. Hover the count to see how long each one has left, soonest first (with Stats off, the list shows under the band). With Stats on, the list opens with the week across all chats: what warm returns saved, and what every chat spent at list price, counting the chats that ran this week with the mod. |
| 📊 **Stats** | Charts of how much of this chat was read from cache (each rebuild in orange), your pauses against the TTL, and how full the context window is (`142k of 200k · 71% · auto in ~6 turns`, with a dashed line where auto-compaction starts); hover the ticks under a chart for each request or pause. Above the charts, two lines: `Compact now` or `Wait` says whether to compact by hand and why (`auto-compaction in ~3 turns at ~46k a turn`, at this chat's average turn), with what it costs, how many turns it takes to pay back, and when the mod would compact if you're away; hover it for the cost once cold and per turn. Beside it, whether keep-warm paid for itself this week across all your chats (your plan's weekly window, else the last 7 days; this chat only with Other chats off): the net, and a bar of what its held returns saved against what its refreshes cost, at list price; hover it for the details. In the terminal, the same stats are text rows. |
| 🤖 **Subagents & workflows** | Their caches, and how much a running workflow has read from cache. |
| 🔇 **Sound** | One button mutes every sound the mod makes, in every chat. |
| 🎉 **Reward** | Each time you come back to a warm cache, Clawd celebrates what you saved. [See it below.](#-the-reward) |

Hover one of the band's switches and the chat's line says what it does.

## 🔥 Keep-warm

**Keep-warm is on by default.** Shortly before the cache expires, the mod sends one small request that reads the cache and resets its timer. It costs a cache read, about a twentieth of writing the cache again.

- **It stops on its own.** After a set number of refreshes (3 by default), the cache is allowed to go cold, with an expiry alert, unless compacting is on.
- **It holds while work runs.** If a workflow or background agent of the chat is still running, keep-warm keeps refreshing for as long as that's cheaper than caching again.
- **You switch it per chat.** Use the band button or `/keep-warm`. The button cycles **off → on → auto**.
- **It can't run while the computer sleeps.** Close a laptop's lid and nothing refreshes or compacts until it wakes. If the cache expired meanwhile, the band says so (`○ Cache cold · expired 47:10 ago while the computer slept (10:30–11:59)`), and so does the log.

<details>
<summary><b>Auto mode</b>: refresh only when you're likely to come back in time</summary>

<br>

In **auto** (or after `/keep-warm auto`), the mod looks at your past pauses in this chat and refreshes only when they say you're likely back before the refresh runs out.

It weighs the pauses that lasted at least as long as this one has so far. Enough of them must have ended in time to pay for the refresh, which costs a small fraction of a rewrite. With fewer than 4 such pauses on record, auto doesn't refresh.

Where auto holds off, the band says so, and the alert or compacting follows as if the refreshes had been spent.

</details>

When keep-warm is off, or has spent its refreshes, you get a toast and a sound about 5 minutes before the cache expires (1 minute for a 5-minute cache).

## 🗜️ Compact

**Compacting is on by default** (switch it per chat with the **Compact** band button). About 2 minutes before the cache expires (1 minute for a 5-minute cache), the mod **compacts the chat while the cache is still warm**, so your next message writes only the summary instead of the whole history.

- **With keep-warm on**, compacting happens once keep-warm's refreshes are spent.
- **With keep-warm off**, it happens right away, for chats of 30k tokens or more. Summarizing a smaller chat costs about as much as caching it again.

The expiry alert tells you a compaction is coming. If you send a message first, the full history is kept.

**Claude Code's own idle compaction.** Claude Code is rolling out a compaction of its own: about 54 minutes into an hour's cache, while you're away, it compacts chats of 200k tokens or more. The mod lets it run only where the mod would compact too. While keep-warm still has refreshes to send, or with **Compact** off, it's skipped quietly; `~/.claude/cache-clock.log` notes each one and why. To turn it off everywhere instead, set `"idleCompaction": false` in `~/.claude/settings.json`.

## 🎉 The reward

<div align="center">
<img src="docs/reward.gif" alt="Clawd catching a coin into a piggy bank, putting on sunglasses, sipping from a mug, blowing a bubblegum bubble that pops on his face, tipping a top hat as his monocle falls, flipping an hourglass and strumming a guitar, while 'Saved $12.36' rolls up beside him, next to what the prompt cost" width="560">
</div>

When a message **you typed** reuses a warm cache, a 4-second scene plays in the band. `Saved $x` rolls up beside it like an odometer, along with what the prompt itself cost, what you've saved today, and how many warm returns you've made in a row.

| When | Scene |
|---|---|
| 🪙 Most messages, taking turns | A **piggy bank** swallowing the coin. **Sunglasses** dropping onto Clawd. A **mug** whose steam turns into a heart. A **bubblegum** bubble that pops all over his face. A **top hat**, with a monocle that pops out when he sees the total. |
| ⌛ Close call (under 5 minutes left) | Clawd sprints in and flips a nearly empty **hourglass**: `with 0:41 to spare` |
| 🎸 Milestone ($10, $25, $50 … saved today, or every 25 warm returns in a row) | Clawd plays the **guitar** |

<details>
<summary>How the saving is counted</summary>

<br>

- **The saving is real.** It's what reading the cache cost compared with writing it all again, at list price.
- **`prompt $y`** is what the message's prompt actually cost with the cache. Until the first response reports its usage, it shows `≈` the cache read; then it shows the exact figure. It counts input only, not the reply's output.
- **Only your messages count.** Wake-ups from background work, scheduled prompts and other plugins' messages don't.
- **A miss takes it back.** If the response shows the cache was missed after all, the scene is withdrawn and your run of warm returns ends.
- **Under a cent, nothing plays.**

</details>

Try it without waiting: `/cache-clock-demo reward` plays each scene in turn.

## ⚙️ Settings

You're asked for these when you install. To change one later, run this from a terminal, then `/reload-plugins` in Desktop:

```bash
echo '{"reward":"animation"}' | claude plugin configure cache-clock@cache-clock --values-stdin
```

| Setting | Key | Default | What it does |
|---|---|---|---|
| Keep warm by default | `keepWarm` | on | New chats start with keep-warm on |
| Keep-warm refreshes per idle stretch | `keepWarmMax` | 3 | How many refreshes after your last message before keep-warm stops (and compacts, if compacting is on) |
| Compact before it goes cold | `autoCompact` | on | New chats start with compacting on; off also skips Claude Code's idle compaction |
| Expiry alert | `alert` | toast+sound | `toast+sound`, `toast` or `off`; used when keep-warm is off |
| Show other chats | `otherChats` | on | Lists your other chats' caches in the band |
| Warm-cache reward | `reward` | animation+sound | `animation+sound`, `animation` or `off` |
| Show cache stats | `stats` | on | New chats show the stats box |

## ⌨️ Commands

| Command | |
|---|---|
| `/keep-warm [on\|auto\|off\|now]` | Turns keep-warm on, auto or off for this chat. `now` refreshes the cache right away. |
| `/cache-clock-demo [reward]` | Replays the new-cache animation for a minute. With `reward`, plays each reward scene instead. |

## 🔒 What it keeps

- **Stays on your machine.** Per-chat state lives in the session. Other chats' caches, each chat's weekly spend and the reward totals are in the mod's store, under `~/.claude/plugins/store/`.
- **Logged.** Each keep-warm refresh and each compaction writes one line to `~/.claude/cache-clock.log`, and so does a cache that expired while the computer slept. Once the log passes 1000 lines, it's trimmed to the last 500.
- **Nothing is sent anywhere.** The only requests the mod makes are keep-warm's own refreshes, on your account.

<details>
<summary>💲 About the prices</summary>

<br>

Savings and cold costs use list prices per million input tokens, with the cache multipliers: writes cost 2× for a 1-hour cache and 1.25× for a 5-minute one, and reads cost 0.025× to 0.1× depending on the model. These are estimates of list-price cost, not your bill. A subscription doesn't charge per token, but a cold cache still costs you usage and time.

</details>

<details>
<summary>🛠️ Development</summary>

<br>

```bash
claude plugin validate .
claude plugin test .
node scripts/sounds.mjs   # re-render sounds/*.wav from the scenes' timelines
```

`hooks/register.tsx` is the band, keep-warm and the bookkeeping. `hooks/reward.ts` draws the reward scenes (pixel-art SVG, animated with SMIL) and synthesizes their sounds on the same timeline. To try a change, copy the folder to `~/.claude/mods/cache-clock` and run `/reload-plugins` in a Desktop Code chat.

</details>

## 📜 Changes & license

See the [CHANGELOG](CHANGELOG.md) and the [Releases page](https://github.com/jomplox/cache-clock/releases).

[Apache 2.0](LICENSE). Clawd is Anthropic's mascot, drawn here in homage. This is a community mod, not an Anthropic product.
