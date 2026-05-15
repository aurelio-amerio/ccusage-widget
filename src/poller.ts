import type { RunResult } from "./ccusage";
import {
  parseDaily,
  parseMonthly,
  parseBlocksActive,
  pickTodayEntry,
  pickThisMonthEntry,
  pickActiveBlock,
} from "./ccusage";
import { emptyCache, todayYMD, thisMonthYM } from "./cache";
import type { CacheState, SectionState } from "./cache";
import type { DailyEntry, MonthlyEntry, ActiveBlock } from "./types";

export type Subcommand = "daily" | "monthly" | "blocks";
export type Runner = (subcommand: Subcommand) => Promise<RunResult>;

export interface PollerOptions {
  intervalMs: number;
  runner: Runner;
}

type Listener = (cache: CacheState) => void;

export class Poller {
  private cache: CacheState = emptyCache();
  private listeners: Listener[] = [];
  private inflight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: PollerOptions) {}

  getCache(): CacheState { return this.cache; }

  onUpdate(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((l) => l !== cb); };
  }

  start(): void {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => { void this.refresh(); }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  setInterval(ms: number): void {
    this.opts.intervalMs = ms;
    if (this.timer) this.start();
  }

  setRunner(runner: Runner): void {
    this.opts.runner = runner;
  }

  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doRefresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async doRefresh(): Promise<void> {
    const [daily, monthly, blocks] = await Promise.allSettled([
      this.opts.runner("daily"),
      this.opts.runner("monthly"),
      this.opts.runner("blocks"),
    ]);
    const now = new Date();

    this.cache.today = mergeDaily(this.cache.today, daily, now);
    this.cache.thisMonth = mergeMonthly(this.cache.thisMonth, monthly, now);
    this.cache.activeBlock = mergeBlock(this.cache.activeBlock, blocks, now);
    this.cache.lastUpdated = now;

    for (const l of this.listeners) l(this.cache);
  }
}

function settledToResult<T>(
  s: PromiseSettledResult<RunResult>,
  parse: (raw: string) => T,
): { ok: true; data: T } | { ok: false; error: string } {
  if (s.status === "rejected") return { ok: false, error: String(s.reason) };
  const r = s.value;
  if (!r.ok) {
    const msg = r.error ?? r.stderr ?? `exit ${r.exitCode}`;
    return { ok: false, error: msg.trim() || `exit ${r.exitCode}` };
  }
  try { return { ok: true, data: parse(r.stdout ?? "") }; }
  catch (e) { return { ok: false, error: String(e) }; }
}

function mergeDaily(
  prev: SectionState<DailyEntry>,
  settled: PromiseSettledResult<RunResult>,
  now: Date,
): SectionState<DailyEntry> {
  const r = settledToResult(settled, parseDaily);
  if (!r.ok) return { data: prev.data, error: r.error, fetchedAt: now };
  const entry = pickTodayEntry(r.data, todayYMD(now));
  return { data: entry, error: null, fetchedAt: now };
}

function mergeMonthly(
  prev: SectionState<MonthlyEntry>,
  settled: PromiseSettledResult<RunResult>,
  now: Date,
): SectionState<MonthlyEntry> {
  const r = settledToResult(settled, parseMonthly);
  if (!r.ok) return { data: prev.data, error: r.error, fetchedAt: now };
  const entry = pickThisMonthEntry(r.data, thisMonthYM(now));
  return { data: entry, error: null, fetchedAt: now };
}

function mergeBlock(
  prev: SectionState<ActiveBlock | null>,
  settled: PromiseSettledResult<RunResult>,
  now: Date,
): SectionState<ActiveBlock | null> {
  const r = settledToResult(settled, parseBlocksActive);
  if (!r.ok) return { data: prev.data, error: r.error, fetchedAt: now };
  return { data: pickActiveBlock(r.data), error: null, fetchedAt: now };
}
