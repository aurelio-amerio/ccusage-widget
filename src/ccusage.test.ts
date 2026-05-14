import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ccusage/data-loader", () => ({
  loadDailyUsageData: vi.fn(),
  loadMonthlyUsageData: vi.fn(),
  loadSessionBlockData: vi.fn(),
}));

vi.mock("ccusage/calculate-cost", () => ({
  getTotalTokens: vi.fn((entry: Record<string, number>) =>
    (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0) +
    (entry.cacheCreationTokens ?? 0) + (entry.cacheReadTokens ?? 0)),
}));

import { loadDailyUsageData, loadMonthlyUsageData, loadSessionBlockData } from "ccusage/data-loader";
import { fetchToday, fetchMonth, fetchActiveBlock } from "./ccusage";

beforeEach(() => { vi.clearAllMocks(); });

describe("fetchToday", () => {
  it("returns today's data when present", async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    vi.mocked(loadDailyUsageData).mockResolvedValue([{
      date: todayStr,
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 50,
      cacheReadTokens: 50,
      totalCost: 1.5,
      modelsUsed: ["claude-sonnet-4-6"],
      modelBreakdowns: [{ modelName: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 200, cacheCreationTokens: 50, cacheReadTokens: 50, cost: 1.5 }],
    } as any]);

    const result = await fetchToday({});
    expect(result).not.toBeNull();
    expect(result!.totalCost).toBe(1.5);
    expect(result!.totalTokens).toBe(400);
    expect(result!.modelBreakdowns).toHaveLength(1);
  });

  it("returns zero data when no entry for today", async () => {
    vi.mocked(loadDailyUsageData).mockResolvedValue([]);
    const result = await fetchToday({});
    expect(result.totalCost).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.modelBreakdowns).toHaveLength(0);
  });
});

describe("fetchMonth", () => {
  it("returns this month's data when present", async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const monthStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

    vi.mocked(loadMonthlyUsageData).mockResolvedValue([{
      month: monthStr,
      inputTokens: 1000,
      outputTokens: 2000,
      cacheCreationTokens: 500,
      cacheReadTokens: 500,
      totalCost: 10.0,
      modelsUsed: [],
      modelBreakdowns: [],
    } as any]);

    const result = await fetchMonth({});
    expect(result).not.toBeNull();
    expect(result!.totalCost).toBe(10.0);
    expect(result!.totalTokens).toBe(4000);
  });

  it("returns zero data when no entry for this month", async () => {
    vi.mocked(loadMonthlyUsageData).mockResolvedValue([]);
    const result = await fetchMonth({});
    expect(result.totalCost).toBe(0);
    expect(result.totalTokens).toBe(0);
  });
});

describe("fetchActiveBlock", () => {
  it("returns active block data with remaining time", async () => {
    const now = Date.now();
    vi.mocked(loadSessionBlockData).mockResolvedValue([{
      id: "block-1",
      startTime: new Date(now - 3600_000),
      endTime: new Date(now + 3600_000),
      isActive: true,
      isGap: false,
      entries: [],
      tokenCounts: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      costUSD: 5.0,
      models: [],
    }]);

    const result = await fetchActiveBlock({});
    expect(result).not.toBeNull();
    expect(result!.costUSD).toBe(5.0);
    expect(result!.remainingMinutes).toBeGreaterThan(0);
  });

  it("returns null when no active block", async () => {
    vi.mocked(loadSessionBlockData).mockResolvedValue([]);
    const result = await fetchActiveBlock({});
    expect(result).toBeNull();
  });

  it("skips gap blocks", async () => {
    vi.mocked(loadSessionBlockData).mockResolvedValue([{
      id: "gap-1",
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600_000),
      isActive: true,
      isGap: true,
      entries: [],
      tokenCounts: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      costUSD: 0,
      models: [],
    }]);

    const result = await fetchActiveBlock({});
    expect(result).toBeNull();
  });
});
