import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DailyData, MonthlyData, BlockData } from "./types";

const mockFetchToday = vi.fn<() => Promise<DailyData>>();
const mockFetchMonth = vi.fn<() => Promise<MonthlyData>>();
const mockFetchActiveBlock = vi.fn<() => Promise<BlockData | null>>();

vi.mock("./ccusage", () => ({
  fetchToday: (...args: unknown[]) => mockFetchToday(...args as []),
  fetchMonth: (...args: unknown[]) => mockFetchMonth(...args as []),
  fetchActiveBlock: (...args: unknown[]) => mockFetchActiveBlock(...args as []),
}));

import { Poller } from "./poller";

const dailyData: DailyData = { totalCost: 1.0, totalTokens: 100, modelBreakdowns: [] };
const monthlyData: MonthlyData = { totalCost: 5.0, totalTokens: 500 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 14, 12, 0));
  mockFetchToday.mockResolvedValue(dailyData);
  mockFetchMonth.mockResolvedValue(monthlyData);
  mockFetchActiveBlock.mockResolvedValue(null);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("Poller", () => {
  it("populates the cache on first refresh", async () => {
    const updates: number[] = [];
    const p = new Poller({ intervalMs: 60_000, loadOpts: {} });
    p.onUpdate(() => updates.push(Date.now()));

    await p.refresh();

    const c = p.getCache();
    expect(c.today.data?.totalCost).toBe(1.0);
    expect(c.thisMonth.data?.totalCost).toBe(5.0);
    expect(c.activeBlock.data).toBeNull();
    expect(updates).toHaveLength(1);
  });

  it("coalesces concurrent refreshes into one fetch set", async () => {
    const p = new Poller({ intervalMs: 60_000, loadOpts: {} });

    const [a, b, c] = [p.refresh(), p.refresh(), p.refresh()];
    await Promise.all([a, b, c]);

    expect(mockFetchToday).toHaveBeenCalledTimes(1);
  });

  it("preserves last-good data when a subsequent fetch fails", async () => {
    const p = new Poller({ intervalMs: 60_000, loadOpts: {} });

    await p.refresh();
    expect(p.getCache().today.data?.totalCost).toBe(1.0);

    mockFetchToday.mockRejectedValueOnce(new Error("boom"));
    await vi.advanceTimersByTimeAsync(20_000); // clear the refresh throttle
    await p.refresh();

    const c = p.getCache();
    expect(c.today.data?.totalCost).toBe(1.0);
    expect(c.today.error).toContain("boom");
  });

  it("throttles refreshes that arrive within the minimum interval", async () => {
    const p = new Poller({ intervalMs: 60_000, loadOpts: {}, minRefreshMs: 20_000 });

    await p.refresh();
    expect(mockFetchToday).toHaveBeenCalledTimes(1);

    // Too soon — skipped, no extra fetch.
    await p.refresh();
    expect(mockFetchToday).toHaveBeenCalledTimes(1);

    // Past the window — allowed again.
    await vi.advanceTimersByTimeAsync(20_000);
    await p.refresh();
    expect(mockFetchToday).toHaveBeenCalledTimes(2);
  });

  it("auto-refreshes on the configured interval", async () => {
    const p = new Poller({ intervalMs: 60_000, loadOpts: {} });
    p.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    // initial + 2 intervals = 3 refreshes
    expect(mockFetchToday).toHaveBeenCalledTimes(3);
    p.stop();
  });
});
