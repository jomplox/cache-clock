# Changelog

Each version is tagged `v<version>`; releases from 0.23.1 on are on the [Releases page](https://github.com/jomplox/cache-clock/releases).

## Unreleased

- **Windows support.** Windows has no `/bin/sh`, `tail`, `grep`, `jq` or `afplay`, so on Windows the countdown's TTL, the stats, the week's spend, the chat's title and the log were missing, and the sounds were silent. There the mod now reads the transcripts (4 MiB at a time) and `cache-clock.log` through `$.fs`, with the same results the shell scripts give, and plays its sounds through Windows PowerShell. It tells Windows by the `OS` variable. macOS is unchanged.
- The chat's name falls back to its folder's name on Windows paths too.

## 0.27.0 (2026-11-01)

- Stats: the third chart is now **Context**, how full this chat's context window is at each request, in place of the cached-size chart. Its caption gives the count, the percent full and, at this chat's pace, the turns until auto-compaction: `142k of 200k · 71% · auto in ~6 turns`. A dashed line marks where auto-compaction starts, and the graph turns orange when that's about 3 turns away. With an auto-compact window set (`CLAUDE_CODE_AUTO_COMPACT_WINDOW` or the settings), the chart, the count and the advice measure against that window, as `/context` does, not the model's full window.
- The cache reads chart shows the last 30 requests instead of 60, so its bars are as wide as the pauses chart's.
- Above the charts, a row on compacting by hand: a verdict, `Compact now` or `Wait`, with the reason, what compacting costs, how many turns it takes to pay back, and when the mod would compact if you stepped away. Hover it for what compacting costs now and once the cache is cold, and what a turn costs before and after. It says `Compact now` when auto-compaction is a few turns away, or when the window is 60% full and compacting pays back within 5 turns. It says `Wait` while a turn or a subagent is running.
- The costs are estimates. The window's contents are counted locally, with no API request. The summary is taken as about 8k tokens. A turn's growth is the average over the last 12 turns, counted once at least 3 of them grew, and the verdict says it (`auto-compaction in ~3 turns at ~46k a turn`), so a chat of long tasks and short questions can be held up against it; a turn's request count is their median.
- Beside it, keep-warm's week across all your chats, `Keep-warm, all chats`: the net (`+$1.44`, or `−$0.17` when its refreshes cost more than the returns they held saved) and a bar of the savings against a marker at what the refreshes cost. Hover it for the full sentence and this pause's refreshes. The two share two lines, each wrapping onto the second when the row is too narrow, in place of the week being cut off first. With Other chats off it counts this chat only, labelled `Keep-warm`. In the terminal the Keep-warm stat row counts all chats the same way, and the week line over the other chats no longer repeats it.
- The text rows above the charts are gone: the cold cost is on the chat's line as `· ≈$2.12 if cold`, and the pauses caption counts the pauses that went cold and those kept warm (`median 2m · 5 cold · 1 kept`). In the terminal, which draws no charts, the stats stay text rows.
- The band's switches are drawn as plain text, without a button's fill. Hover one and the chat's line says what it does.
- A **Compact now** button before them runs `/compact`, the same as typing it. Pressed during a turn, it runs once the turn ends. It's drawn as an orange pill whenever the stats' verdict is orange (auto-compaction a few turns away), with Stats off too; in the terminal it's drawn as the primary button instead. Hover it for the reason. Pressed, it drops the orange at once, so you can see the press took. Further presses do nothing until that compaction lands, instead of queuing another `/compact` that would summarize the summary.
- While this chat compacts (a `/compact`, typed or the button's, or an auto-compaction), the chat's line says so: `◐ Compacting · writing the summary, 0:12 so far`. The summary takes about a minute, and Desktop shows a compaction it didn't start only once it lands. Meanwhile the button reads `Compacting…` and the verdict is hidden.
- When the cache expired while the computer slept, which keep-warm and compacting can't prevent, the chat's line says so: `○ Cache cold · expired 47:10 ago while the computer slept (10:30–11:59)`. `~/.claude/cache-clock.log` gets a line too, once the computer has been awake for 2 minutes. The mod notices a sleep when its 10-second timer misses a minute or more; the brief wakes a sleeping Mac makes in between count as one sleep.

## 0.26.1 (2026-10-20)

- On Team and Enterprise plans, Claude Code's built-in security default runs ahead of user mods and passes the classic hooks (Stop, PostCompact, SessionStart, SubagentStart/Stop, PostModelSwitch) and the compaction hook on without them. The band now does without them where it can. A turn's TTL (5m once on usage credits), its prompt size and the stats are read from the transcript shortly after the turn ends, when no Stop arrived. A `/compact` or Claude Code's own compaction between turns shows as `Compacted` once its boundary row is in the transcript, instead of the old cache going cold.
- Still missing there: a model switch shows only once the next message is sent, Claude Code's idle compaction isn't deferred for keep-warm or the **Compact** button, and a workflow run ends only when it ages out of the list. An org Owner can seat the mod ahead of the security default with managed `prependPlugins`; see the README.
- Installed twice, from an organization's managed marketplace and from a folder of your own (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`), only the organization's copy loads; the other is refused at load, so one band shows and keep-warm refreshes once. The two keep separate records.

## 0.26.0 (2026-10-20)

- Two accounts side by side on one Mac (the Graft switcher, a second Claude app) share one Claude Code folder, so the mod's store too. Each chat now keeps its records under its account's organization, which Desktop hands every session: the other chats' list, the week's spend and savings, keep-warm's ledger and the reward's run count only that account's chats. A terminal session, which isn't told its organization, keeps the unprefixed records as before. The Sound button still applies to every chat on the Mac.
- Records from before are left out of the account-scoped lists. A chat's keep-warm ledger moves to the first account that opens the chat; the rest expire as they always did. The week's savings and the reward's run start over for each account.
- The log, and the search for a chat's transcript, follow `CLAUDE_CONFIG_DIR` when it's set, instead of always `~/.claude`.

## 0.25.1 (2026-10-16)

- With Stats off, the other chats' row under the band is just the list, labelled `Other chats` and separated by `·`; the week's figures stay with the stats.
- The charts' hover ticks are one per bar again wherever a bar is at least half a text cell wide; they took two bars each as soon as a chart held more bars than its width in cells.

## 0.25.0 (2026-10-16)

- Claude Code's own idle compaction (rolling out: about 54 minutes into an hour's cache, it compacts chats of 200k tokens or more) now follows the mod. While keep-warm still has refreshes to send, it's skipped, so keep-warm gets to refresh; with **Compact** off, it's skipped too. It's skipped quietly; the log notes each one and why. Elsewhere it runs, and the mod's own compaction covers what it doesn't (smaller chats, 5-minute caches, a pause it passed on).
- Compacting is on by default for new chats, so where keep-warm is done the chat is still compacted before it goes cold, as Claude Code would. Set **Compact before it goes cold** off to go back.
- Stats: the `Spent` line gives way to whether keep-warm pays for itself this week: what its refreshes cost, the rewrites it saved (a return after the cache's own expiry that read it warm), and the verdict, `≈$0.62 for 9 refreshes, saved ≈$4.10 on 2 returns: paid back 6.6× · 1 pause went cold anyway`. A chat's refreshes from before this version are read once from `~/.claude/cache-clock.log`, which names chats by title, so those of a chat since renamed are missed. The other chats' list opens with the same across all chats. The current pause's refreshes are now labelled `This pause`.

## 0.24.1 (2026-10-15)

- Stats: a pause longer than the cache's TTL shows green when you came back to a warm cache anyway (keep-warm held it), and orange only when the cache had to be written again. The caption counts them: `5 over 1h (all kept warm)`.
- Stats: each chart has a row of ticks to hover. A pause's says when it began, how long you were away, and what happened to the cache (`14:02 · 1h 12m away · keep-warm held the cache`); a request's, how much it read from cache and whether it rebuilt it, and the prompt it sent. Where bars are narrower than a character, a tick spans a few.

## 0.24.0 (2026-10-15)

- Keep-warm is on by default for new chats. A refresh costs a cache read, about a twentieth of re-writing the cache, so keeping it warm through a pause pays off when you come back. Set **Keep warm by default** off to go back; a chat's own pick (band button or `/keep-warm`) still wins.

## 0.23.5 (2026-10-15)

- A message sent as the chat compacts (one queued from another chat, say) is no longer flagged as a cache miss: it went out before the compaction reached the mod, so the old cache looked skipped. The mod now checks the transcript for a compaction before calling a miss.

## 0.23.4 (2026-10-14)

- With Stats off, the other chats' row stays one row: in Desktop the list wrapped and sat over the chat's line above it; it now shows its first line, clipped.

## 0.23.3 (2026-10-14)

- Stats show up in a chat another chat started: it opens on an empty transcript and its first turn can run long, so until a chat has stats the mod reads them again every minute instead of waiting for the turn to end.

## 0.23.2 (2026-10-14)

- Other chats: a side chat no longer shows as a second copy of its parent. Its transcript carries the parent's title, so each title is listed once, with its latest cache, and never under this chat's own title.

## 0.23.1 (2026-10-14)

- The band reads the Sound setting from memory, refreshed every 2 seconds, instead of from the store on every frame. A press in another chat shows within those 2 seconds.
- README: the band GIF shows the Sound button and keep-warm auto; the reward GIF adds the bubblegum and top hat scenes.

## 0.23.0 (2026-10-14)

- The other chats' hover list opens with the week across chats: what warm returns saved, and what every chat spent at list price. Each chat publishes its own weekly spend as it reads its stats.

## 0.22.0 (2026-10-14)

- Keep-warm **auto**: the button now cycles off → on → auto (`/keep-warm auto` too). Auto refreshes only when this chat's past pauses say you're likely back before the refresh runs out, weighed against what a refresh costs next to a rewrite. Where it holds off, the band says so, and the alert or compacting follows as if its refreshes were spent.

## 0.21.0 (2026-10-14)

- A miss names its cause when the mod can see one: an MCP server that connected or left, a tool added, removed or reworded, a changed section of the system prompt, or a new effort level.

## 0.20.1 (2026-10-14)

- Stats show up in a new chat: its transcript doesn't exist yet when the session starts, so the mod now takes it from the end of the first turn.

## 0.20.0 (2026-10-14)

- A tune plays when a new cache is written, alongside the LED animation.
- A **Sound** button mutes every sound of the mod, in every chat.
- Two new reward scenes: bubblegum and top hat.

## 0.19.0 (2026-10-13)

- Stats show what this chat and its subagents spent today and this week, at list price.
- More room before the band's buttons.

## 0.18.2 (2026-10-13)

- Compacting works in Desktop: where the engine refuses to compact outside a turn (SDK sessions), the mod runs `/compact` instead.

## 0.18.1 (2026-10-13)

- Drops the band's compaction hint; the Compact button and the alert already say it.

## 0.18.0 (2026-10-13)

- A per-chat **Compact** button on the band, for keep-warm on and off.

## 0.17.1 (2026-10-13)

- The band says all along when a chat will compact before it goes cold.

## 0.17.0 (2026-10-13)

- Option to compact a chat before its cache goes cold when keep-warm is off.

## 0.16.0 (2026-10-13)

- The reward shows what the prompt cost with the cache next to what it saved.

## 0.15.2 (2026-10-13)

- The band's line stays one row when it's wider than the window; long expiries show as hours or days.

## 0.15.1 (2026-10-13)

- First release: the prompt-cache countdown band, keep-warm, the expiry alert, other chats, and the warm-cache reward, for Claude Desktop's Code tab.
