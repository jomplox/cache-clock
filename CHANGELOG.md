# Changelog

Each version is tagged `v<version>`; releases from 0.23.1 on are on the [Releases page](https://github.com/jomplox/cache-clock/releases).

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
