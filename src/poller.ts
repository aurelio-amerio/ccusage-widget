import { fetchToday, fetchMonth, fetchActiveBlock } from "./ccusage";
import type { LoadOpts } from "./ccusage";
import { emptyCache } from "./cache";
import type { CacheState } from "./cache";

export interface PollerOptions {
  intervalMs: number;
  loadOpts: LoadOpts;
}

type Listener = (cache: CacheState) => void;

export class Poller {
  private cache: CacheState = emptyCache();
  private listeners: Listener[] = [];
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: PollerOptions;

  constructor(opts: PollerOptions) {
    this.opts = opts;
  }

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

  setLoadOpts(opts: LoadOpts): void {
    this.opts.loadOpts = opts;
  }

  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doRefresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async doRefresh(): Promise<void> {
    const opts = this.opts.loadOpts;
    const now = new Date();

    const [daily, monthly, blocks] = await Promise.allSettled([
      fetchToday(opts),
      fetchMonth(opts),
      fetchActiveBlock(opts),
    ]);

    this.cache.today = merge(this.cache.today, daily, now);
    this.cache.thisMonth = merge(this.cache.thisMonth, monthly, now);
    this.cache.activeBlock = merge(this.cache.activeBlock, blocks, now);
    this.cache.lastUpdated = now;

    for (const l of this.listeners) l(this.cache);
  }
}

function merge<T>(
  prev: CacheState["today"],
  settled: PromiseSettledResult<T | null>,
  now: Date,
): { data: T | null; error: string | null; fetchedAt: Date } {
  if (settled.status === "rejected") {
    return { data: prev.data as T | null, error: String(settled.reason), fetchedAt: now };
  }
  return { data: settled.value as T | null, error: null, fetchedAt: now };
}
