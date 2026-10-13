export type CacheInfo = {
  /** When the last main-conversation request was sent, or the compaction ran, epoch ms. */
  at: number
  /** The TTL the last cache write used, in minutes. */
  ttlMin: 5 | 60
  /** The model whose cache that request used; each model has its own. */
  model?: string
  /** Prompt tokens the last response was answered over: what a cold cache re-sends. */
  tokens?: number
  /** A compaction replaced the conversation since; its new prefix is not cached yet. */
  isCompacted?: boolean
}

/** A subagent's own cache: what resuming it (a message to it) reads. */
export type AgentCache = {
  /** When its last request was sent, epoch ms. */
  at: number
  ttlMin: 5 | 60
  /** Its task description, or its type. */
  label: string
  /** Prompt tokens its last response was answered over. */
  tokens?: number
  /** Between its start and its stop: it sends its next request on its own. */
  isRunning?: boolean
}

/** This chat's keep-warm switch and what it has done since the last message. */
export type KeepWarm = {
  /** null follows the `keepWarm` option; true or false is this chat's own pick. */
  isOn: boolean | null
  /** Whether it compacts the chat before the cache goes cold; absent follows the `autoCompact` option. */
  isCompactOn?: boolean
  /** Refreshes sent since the last message of the person's. */
  refreshes: number
  /** Why keep-warm switched itself off, shown until the next message. */
  stopped?: string
  /** Prompt tokens the last refresh read from cache. */
  lastRead?: number
}

/** A request that was predicted warm but read little from cache. */
export type Miss = { at: number; read: number; total: number }

/** A request that wrote this chat's prefix to cache from scratch. */
export type Mint = { at: number; tokens: number }

/** The reward scene: a prop for an everyday warm return, the hourglass for a close call, the guitar for a milestone. */
export type RewardVariant = 'piggy' | 'shades' | 'mug' | 'hourglass' | 'guitar'

/** A message the person typed that reused the warm cache, as the band celebrates it. */
export type Reward = {
  at: number
  variant: RewardVariant
  /** What reading the cache saved against writing it again, at list price, USD. */
  saved: number
  /** What the prompt itself cost, at list price, USD: until its response says, the cache read alone. */
  paid: number
  /** Whether `paid` is the response's own usage rather than the estimate. */
  isPaidExact?: boolean
  /** Saved today across chats, this message included. */
  today: number
  /** Warm returns in a row across chats, this one included. */
  streak: number
  /** A close call: how long the cache had left, ms. */
  spare?: number
  /** What this message crossed: `$50 saved today`, `25 in a row`. */
  milestone?: string
}

/** A workflow run this chat started; it wakes the chat when it ends. */
export type WorkflowRun = {
  name: string
  /** The Workflow tool's task id, as a turn's background-task list names it. */
  taskId?: string
  startedAt: number
  /** When it started, one of its agents last sent a request, or it ended, epoch ms. */
  lastAt: number
  agents: number
  /** Prompt tokens over its agents' requests, and how many were read from cache. */
  total: number
  read: number
  /** The last turn's background-task list no longer named it. */
  isDone?: boolean
}

/** Another chat's cache as its own session last published it to the store. */
export type OtherChat = {
  id: string
  label: string
  at: number
  ttlMin: 5 | 60
  tokens?: number
  isCompacted?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': {
      cache: CacheInfo | null
      model: string | null
      agents: Record<string, AgentCache>
      keepWarm: KeepWarm
      miss: Miss | null
      others: OtherChat[]
      /** The `at` of the cache entry the expiry alert last fired for. */
      alertedAt: number | null
      showStats: boolean | null
      minted: Mint | null
      reward: Reward | null
      /** This chat's workflow runs by run id, the recent ones. */
      runs: Record<string, WorkflowRun>
    }
  }
}
