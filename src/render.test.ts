import { describe, it, expect } from "vitest";
import { renderStatusBarText, renderTooltip, formatCost, formatTokens } from "./render";
import { emptyCache } from "./cache";
import type { CacheState } from "./cache";
import type { DailyData, MonthlyData, BlockData } from "./types";

const sampleToday: DailyData = {
  totalCost: 15.7746,
  totalTokens: 23592543,
  modelBreakdowns: [
    { modelName: "claude-sonnet-4-6", cost: 9.73 },
    { modelName: "claude-opus-4-7", cost: 6.04 },
  ],
};

const sampleMonth: MonthlyData = {
  totalCost: 44.1275,
  totalTokens: 79668676,
};

const sampleBlock: BlockData = {
  costUSD: 15.87,
  remainingMinutes: 51,
};

function withData(): CacheState {
  return {
    today: { data: sampleToday, error: null, fetchedAt: new Date(2026, 4, 14, 14, 32) },
    thisMonth: { data: sampleMonth, error: null, fetchedAt: new Date(2026, 4, 14, 14, 32) },
    activeBlock: { data: sampleBlock, error: null, fetchedAt: new Date(2026, 4, 14, 14, 32) },
    lastUpdated: new Date(2026, 4, 14, 14, 32),
  };
}

describe("formatCost", () => {
  it("formats with two decimals and dollar sign", () => {
    expect(formatCost(15.7746)).toBe("$15.77");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(1234.5)).toBe("$1234.50");
  });
});

describe("formatTokens", () => {
  it("uses k/M suffixes", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(23592543)).toBe("23.6M");
  });
});

describe("renderStatusBarText", () => {
  it("shows today's cost and a search icon when data is present", () => {
    expect(renderStatusBarText(withData())).toBe("$15.77 $(clippy)");
  });

  it("shows Loading when there is no data and no error", () => {
    expect(renderStatusBarText(emptyCache())).toBe("Loading… $(clippy)");
  });

  it("shows a question mark when there is an error and no prior data", () => {
    const c = emptyCache();
    c.today = { data: null, error: "boom", fetchedAt: new Date() };
    expect(renderStatusBarText(c)).toBe("$? $(clippy)");
  });
});

describe("renderTooltip", () => {
  it("renders all three sections when data is present", () => {
    const md = renderTooltip(withData()).value;
    expect(md).toContain("Claude Code Usage");
    expect(md).toContain("Today");
    expect(md).toContain("$15.77");
    expect(md).toContain("This month");
    expect(md).toContain("$44.13");
    expect(md).toContain("Active session block");
    expect(md).toContain("Refresh");
    expect(md).toContain("command:ccusageWidget.refresh");
  });

  it("omits the block section when activeBlock data is null", () => {
    const c = withData();
    c.activeBlock = { data: null, error: null, fetchedAt: new Date() };
    const md = renderTooltip(c).value;
    expect(md).not.toContain("Active session block");
  });

  it("respects showSessionBlock=false", () => {
    const md = renderTooltip(withData(), { showSessionBlock: false }).value;
    expect(md).not.toContain("Active session block");
  });

  it("renders error placeholder for failed sections", () => {
    const c = withData();
    c.thisMonth = { data: null, error: "load failed", fetchedAt: new Date(2026, 4, 14, 14, 32) };
    const md = renderTooltip(c).value;
    expect(md).toContain("This month");
    expect(md).toMatch(/load failed|unavailable/i);
  });

  it("shows initial fetching message when nothing has loaded yet", () => {
    const md = renderTooltip(emptyCache()).value;
    expect(md).toMatch(/Fetching|Loading/i);
  });
});
