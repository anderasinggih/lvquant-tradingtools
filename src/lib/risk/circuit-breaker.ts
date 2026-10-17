/* Daily max-loss circuit breaker (Fase 5.3, PRD §4.3). Tracks realized PnL over a rolling 24h window
   and, the moment the accumulated loss reaches the daily safety limit (a USD cap and/or a % of
   capital — whichever is tighter), latches the bot into `CIRCUIT_BREAKER_TRIPPED` and blocks new BUY
   orders for a full cooldown. Sells / exits are never blocked: the breaker only ever prevents adding
   risk, it never traps an open position. Pure and deterministic — the same entries, clock and config
   always yield the same decision; time is injected so the window is testable (Rules §1). */

/** Rolling window length for realized PnL (24h). */
export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000

/** How long trading stays frozen after the breaker trips (24h). */
export const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** The bot's trading status as far as the daily loss guard is concerned. */
export type CircuitBreakerStatus = "ACTIVE" | "CIRCUIT_BREAKER_TRIPPED"

/** Why the breaker is (or was) tripped. */
export type CircuitBreakerReason = "daily_loss_limit" | "manual"

/** One realized trade result, timestamped so it can age out of the rolling window. */
export interface RealizedPnlEntry {
  /** unique id (e.g. the trade / exit id) so a retried record is never counted twice */
  id: string
  /** realized PnL in USD (negative = loss) */
  pnlUsd: number
  /** epoch ms when the PnL was realized */
  at: number
}

export interface CircuitBreakerConfig {
  /** rolling window length in ms; defaults to {@link DEFAULT_WINDOW_MS} (24h). */
  windowMs?: number
  /** how long trading stays frozen once tripped; defaults to {@link DEFAULT_COOLDOWN_MS} (24h). */
  cooldownMs?: number
  /** hard USD loss cap within the window; a loss at or beyond this trips the breaker. */
  maxLossUsd?: number
  /** loss cap as a % of `capitalUsd`; the tighter of this and `maxLossUsd` wins. */
  maxLossPct?: number
  /** capital / equity in USD, required when `maxLossPct` is set. */
  capitalUsd?: number
}

/** Conservative default: −$15 or −5% of capital over a rolling 24h window (PRD §4.3). */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  windowMs: DEFAULT_WINDOW_MS,
  cooldownMs: DEFAULT_COOLDOWN_MS,
  maxLossUsd: 15,
}

/** A point-in-time view of the breaker. */
export interface CircuitBreakerState {
  status: CircuitBreakerStatus
  /** why it tripped, or null while active */
  reason: CircuitBreakerReason | null
  /** epoch ms the breaker tripped, or null while active */
  trippedAt: number | null
  /** epoch ms new buys stay blocked until, or null while active */
  lockedUntil: number | null
  /** ms left on the lockout (0 while active) */
  remainingMs: number
  /** realized PnL over the rolling window (USD, negative = net loss) */
  rollingPnlUsd: number
  /** realized loss over the rolling window (USD, >= 0) */
  rollingLossUsd: number
  /** the window length used, in ms */
  windowMs: number
  /** the effective loss threshold applied, in USD (>= 0) */
  thresholdUsd: number
  /** how many realized entries fall inside the window */
  entryCount: number
}

export interface BuyGate {
  /** true when a new buy may proceed */
  allowed: boolean
  /** "ok" when allowed, otherwise the block reason */
  reason: "ok" | "circuit_breaker_tripped"
  state: CircuitBreakerState
}

/** Thrown by {@link DailyLossCircuitBreaker.assertCanOpenBuy} when a new buy is blocked. */
export class CircuitBreakerError extends Error {
  readonly state: CircuitBreakerState
  constructor(state: CircuitBreakerState) {
    super(
      `buy blocked: ${state.status}${state.lockedUntil ? ` until ${new Date(state.lockedUntil).toISOString()}` : ""}`,
    )
    this.name = "CircuitBreakerError"
    this.state = state
  }
}

interface ResolvedConfig {
  windowMs: number
  cooldownMs: number
  thresholdUsd: number
}

function positiveOrThrow(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

/** Merge config with the defaults, validate it and compute the effective USD loss threshold. When
 *  `requireThreshold` is set, at least one loss limit must be configured; otherwise the threshold
 *  falls back to 0 (no auto-trip), which manual paths such as a panic trip do not need. */
function resolveConfig(config: CircuitBreakerConfig, requireThreshold: boolean): ResolvedConfig {
  const windowMs = positiveOrThrow(config.windowMs ?? DEFAULT_WINDOW_MS, "windowMs")
  const cooldownMs = positiveOrThrow(config.cooldownMs ?? DEFAULT_COOLDOWN_MS, "cooldownMs")

  const limits: number[] = []
  if (config.maxLossUsd !== undefined) limits.push(positiveOrThrow(config.maxLossUsd, "maxLossUsd"))
  if (config.maxLossPct !== undefined) {
    const pct = positiveOrThrow(config.maxLossPct, "maxLossPct")
    if (pct > 100) throw new Error("maxLossPct must be at most 100")
    const capital = positiveOrThrow(config.capitalUsd ?? Number.NaN, "capitalUsd (required with maxLossPct)")
    limits.push((capital * pct) / 100)
  }
  if (requireThreshold && limits.length === 0) {
    throw new Error("circuit breaker needs at least one of maxLossUsd or maxLossPct")
  }

  return { windowMs, cooldownMs, thresholdUsd: limits.length > 0 ? Math.min(...limits) : 0 }
}

/**
 * Rolling-window realized-PnL tracker + daily loss circuit breaker. Feed it each realized trade
 * result as it closes; call {@link evaluate} (or {@link canOpenBuy}) on every loop tick. Once the
 * accumulated loss within the window reaches the threshold the breaker latches `CIRCUIT_BREAKER_TRIPPED`
 * and blocks new buys until the cooldown elapses.
 */
export class DailyLossCircuitBreaker {
  private readonly entries: RealizedPnlEntry[] = []
  private readonly ids = new Set<string>()
  private trippedAt: number | null = null
  private lockedUntil: number | null = null
  private reason: CircuitBreakerReason | null = null

  constructor(initialEntries?: Iterable<RealizedPnlEntry>) {
    for (const entry of initialEntries ?? []) this.record(entry)
  }

  /**
   * Record a realized PnL entry. Entries are idempotent by `id` — a duplicate is ignored (returns
   * false) so a retried close can never be counted twice. Returns true when it was added.
   */
  record(entry: RealizedPnlEntry): boolean {
    if (!entry.id?.trim()) throw new Error("entry.id is required")
    if (!Number.isFinite(entry.pnlUsd)) throw new Error("entry.pnlUsd must be a finite number")
    if (!Number.isFinite(entry.at)) throw new Error("entry.at must be a finite epoch ms")
    if (this.ids.has(entry.id)) return false
    this.ids.add(entry.id)
    this.entries.push({ id: entry.id, pnlUsd: entry.pnlUsd, at: entry.at })
    return true
  }

  /** Convenience wrapper around {@link record} taking the raw PnL. */
  recordRealizedPnl(pnlUsd: number, id: string, at: number = Date.now()): boolean {
    return this.record({ id, pnlUsd, at })
  }

  /** Entries currently held (all of them; call {@link evaluate} to age old ones out). */
  listEntries(): RealizedPnlEntry[] {
    return this.entries.map((entry) => ({ ...entry }))
  }

  /** Drop realized entries older than the rolling window at `now`. Returns how many were removed. */
  prune(now: number = Date.now(), config: CircuitBreakerConfig = {}): number {
    const { windowMs } = resolveConfig(config, false)
    return this.pruneTo(now - windowMs)
  }

  /** Latch the breaker manually (e.g. operator panic); blocks buys for `cooldownMs`. */
  tripManually(now: number = Date.now(), config: CircuitBreakerConfig = {}): CircuitBreakerState {
    const { windowMs, cooldownMs, thresholdUsd } = resolveConfig(config, false)
    this.trippedAt = now
    this.lockedUntil = now + cooldownMs
    this.reason = "manual"
    this.pruneTo(now - windowMs)
    return this.buildState(now, windowMs, thresholdUsd)
  }

  /** Clear a trip (operator override) without discarding the realized history. */
  reset(): void {
    this.trippedAt = null
    this.lockedUntil = null
    this.reason = null
  }

  /** Discard all realized entries and clear any trip. */
  clearAll(): void {
    this.entries.length = 0
    this.ids.clear()
    this.reset()
  }

  /**
   * Age out stale entries, latch a new trip when the rolling loss hits the threshold, and lift an
   * expired lockout — then return the resulting state. Idempotent for a given `now`.
   */
  evaluate(now: number = Date.now(), config: CircuitBreakerConfig = {}): CircuitBreakerState {
    const { windowMs, cooldownMs, thresholdUsd } = resolveConfig(config, true)
    this.pruneTo(now - windowMs)

    if (this.trippedAt !== null && this.lockedUntil !== null && now >= this.lockedUntil) {
      this.reset()
    }
    if (this.trippedAt === null && this.rollingLossUsd() >= thresholdUsd) {
      this.trippedAt = now
      this.lockedUntil = now + cooldownMs
      this.reason = "daily_loss_limit"
    }

    return this.buildState(now, windowMs, thresholdUsd)
  }

  /** Read-only alias of {@link evaluate} (still ages out stale entries). */
  state(now: number = Date.now(), config: CircuitBreakerConfig = {}): CircuitBreakerState {
    return this.evaluate(now, config)
  }

  /** The current breaker status only. */
  status(now: number = Date.now(), config: CircuitBreakerConfig = {}): CircuitBreakerState["status"] {
    return this.evaluate(now, config).status
  }

  /** Whether a new buy may proceed right now, with the full state for logging. */
  canOpenBuy(now: number = Date.now(), config: CircuitBreakerConfig = {}): BuyGate {
    const state = this.evaluate(now, config)
    const allowed = state.status === "ACTIVE"
    return { allowed, reason: allowed ? "ok" : "circuit_breaker_tripped", state }
  }

  /** Like {@link canOpenBuy} but throws {@link CircuitBreakerError} when a buy is blocked. */
  assertCanOpenBuy(now: number = Date.now(), config: CircuitBreakerConfig = {}): CircuitBreakerState {
    const gate = this.canOpenBuy(now, config)
    if (!gate.allowed) throw new CircuitBreakerError(gate.state)
    return gate.state
  }

  private pruneTo(cutoff: number): number {
    let removed = 0
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].at <= cutoff) {
        this.ids.delete(this.entries[i].id)
        this.entries.splice(i, 1)
        removed++
      }
    }
    return removed
  }

  /** Realized loss over the entries currently held (all in-window after pruning), as a magnitude. */
  private rollingLossUsd(): number {
    const pnl = this.entries.reduce((sum, entry) => sum + entry.pnlUsd, 0)
    return pnl < 0 ? -pnl : 0
  }

  /** Build the point-in-time state from the current latch flags and held entries. */
  private buildState(now: number, windowMs: number, thresholdUsd: number): CircuitBreakerState {
    const rollingPnlUsd = this.entries.reduce((sum, entry) => sum + entry.pnlUsd, 0)
    const tripped = this.trippedAt !== null
    return {
      status: tripped ? "CIRCUIT_BREAKER_TRIPPED" : "ACTIVE",
      reason: tripped ? this.reason : null,
      trippedAt: this.trippedAt,
      lockedUntil: this.lockedUntil,
      remainingMs: this.lockedUntil !== null ? Math.max(0, this.lockedUntil - now) : 0,
      rollingPnlUsd,
      rollingLossUsd: rollingPnlUsd < 0 ? -rollingPnlUsd : 0,
      windowMs,
      thresholdUsd,
      entryCount: this.entries.length,
    }
  }
}
