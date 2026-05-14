import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Poller } from "./poller";
import type { RunResult } from "./ccusage";

function makeRunner(responses: Record<string, RunResult>) {
  const calls: string[] = [];
  const runner = vi.fn(async (subcommand: string): Promise<RunResult> => {
    calls.push(subcommand);
    return responses[subcommand] ?? { ok: false, exitCode: 1, stderr: "no fixture" };
  });
  return { runner, calls };
}

const dailyOk: RunResult = {
  ok: true,
  stdout: JSON.stringify({
    daily: [{
      date: "2026-05-14", inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      totalTokens: 100, totalCost: 1.0, modelsUsed: [], modelBreakdowns: [],
    }],
    totals: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 100, totalCost: 1.0 },
  }),
};

const monthlyOk: RunResult = {
  ok: true,
  stdout: JSON.stringify({
    monthly: [{
      month: "2026-05", inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      totalTokens: 500, totalCost: 5.0, modelsUsed: [], modelBreakdowns: [],
    }],
    totals: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 500, totalCost: 5.0 },
  }),
};

const blocksEmpty: RunResult = { ok: true, stdout: JSON.stringify({ blocks: [] }) };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 14, 12, 0)); });
afterEach(() => { vi.useRealTimers(); });

describe("Poller", () => {
  it("populates the cache on first refresh", async () => {
    const { runner } = makeRunner({ daily: dailyOk, monthly: monthlyOk, blocks: blocksEmpty });
    const updates: number[] = [];
    const p = new Poller({ intervalMs: 60_000, runner });
    p.onUpdate(() => updates.push(Date.now()));

    await p.refresh();

    const c = p.getCache();
    expect(c.today.data?.totalCost).toBe(1.0);
    expect(c.thisMonth.data?.totalCost).toBe(5.0);
    expect(c.activeBlock.data).toBeNull();
    expect(updates).toHaveLength(1);
  });

  it("coalesces concurrent refreshes into one fetch set", async () => {
    const { runner } = makeRunner({ daily: dailyOk, monthly: monthlyOk, blocks: blocksEmpty });
    const p = new Poller({ intervalMs: 60_000, runner });

    const [a, b, c] = [p.refresh(), p.refresh(), p.refresh()];
    await Promise.all([a, b, c]);

    expect(runner).toHaveBeenCalledTimes(3); // 3 subcommands, not 9
  });

  it("preserves last-good data when a subsequent fetch fails", async () => {
    const responses: Record<string, RunResult> = { daily: dailyOk, monthly: monthlyOk, blocks: blocksEmpty };
    const runner = vi.fn(async (sub: string) => responses[sub]);
    const p = new Poller({ intervalMs: 60_000, runner });

    await p.refresh();
    expect(p.getCache().today.data?.totalCost).toBe(1.0);

    responses.daily = { ok: false, exitCode: 1, stderr: "boom" };
    await p.refresh();

    const c = p.getCache();
    expect(c.today.data?.totalCost).toBe(1.0); // last-good preserved
    expect(c.today.error).toContain("boom");
  });

  it("auto-refreshes on the configured interval", async () => {
    const { runner } = makeRunner({ daily: dailyOk, monthly: monthlyOk, blocks: blocksEmpty });
    const p = new Poller({ intervalMs: 60_000, runner });
    p.start();
    await Promise.resolve(); // let start's initial refresh fire

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    // initial + 2 intervals = 3 refreshes × 3 subcommands = 9 calls
    expect(runner).toHaveBeenCalledTimes(9);
    p.stop();
  });
});
