import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDaily,
  parseMonthly,
  parseBlocksActive,
  pickTodayEntry,
  pickThisMonthEntry,
  pickActiveBlock,
} from "./ccusage";
import { runCcusage } from "./ccusage";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

describe("parseDaily", () => {
  it("parses real ccusage output", () => {
    const report = parseDaily(fixture("daily.json"));
    expect(report.daily.length).toBeGreaterThan(0);
    expect(report.totals.totalCost).toBeGreaterThan(0);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseDaily("{not json")).toThrow(/parse/i);
  });

  it("throws when shape is wrong", () => {
    expect(() => parseDaily('{"wrong": []}')).toThrow(/daily/i);
  });
});

describe("parseMonthly", () => {
  it("parses real ccusage output", () => {
    const report = parseMonthly(fixture("monthly.json"));
    expect(report.monthly.length).toBeGreaterThan(0);
  });
});

describe("parseBlocksActive", () => {
  it("parses a populated blocks response", () => {
    const report = parseBlocksActive(fixture("blocks-active.json"));
    expect(report.blocks).toHaveLength(1);
    expect(report.blocks[0].isActive).toBe(true);
  });

  it("parses an empty blocks response", () => {
    const report = parseBlocksActive(fixture("blocks-empty.json"));
    expect(report.blocks).toHaveLength(0);
  });
});

describe("pickTodayEntry", () => {
  it("returns the entry matching today's YYYY-MM-DD", () => {
    const report = parseDaily(fixture("daily.json"));
    const today = report.daily[0].date;
    expect(pickTodayEntry(report, today)?.date).toBe(today);
  });

  it("returns null when today has no entry", () => {
    const report = parseDaily(fixture("daily.json"));
    expect(pickTodayEntry(report, "1999-01-01")).toBeNull();
  });
});

describe("pickThisMonthEntry", () => {
  it("returns the entry matching this YYYY-MM", () => {
    const report = parseMonthly(fixture("monthly.json"));
    const month = report.monthly[0].month;
    expect(pickThisMonthEntry(report, month)?.month).toBe(month);
  });
});

describe("pickActiveBlock", () => {
  it("returns the active block when present", () => {
    const report = parseBlocksActive(fixture("blocks-active.json"));
    expect(pickActiveBlock(report)?.isActive).toBe(true);
  });

  it("returns null when no blocks", () => {
    const report = parseBlocksActive(fixture("blocks-empty.json"));
    expect(pickActiveBlock(report)).toBeNull();
  });
});

describe("runCcusage", () => {
  it("returns parsed stdout when the process exits 0", async () => {
    const result = await runCcusage({
      command: "node",
      args: ["-e", "process.stdout.write('{\"daily\":[],\"totals\":{}}')"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stdout).toContain('"daily"');
  });

  it("returns an error result when the process exits non-zero", async () => {
    const result = await runCcusage({
      command: "node",
      args: ["-e", "process.stderr.write('boom'); process.exit(2)"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("boom");
    }
  });

  it("returns an error result when the binary is missing", async () => {
    const result = await runCcusage({
      command: "definitely-not-a-real-binary-xyzzy",
      args: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ENOENT|not found|spawn/i);
  });

  it("kills the child and returns an error when it exceeds timeoutMs", async () => {
    const start = Date.now();
    const result = await runCcusage({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 60_000)"],
      timeoutMs: 200,
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/timeout/i);
    }
    // Must not have waited for the full 60s child sleep.
    expect(elapsed).toBeLessThan(5_000);
  });

  it("does not time out fast-completing children", async () => {
    const result = await runCcusage({
      command: "node",
      args: ["-e", "process.stdout.write('ok')"],
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stdout).toBe("ok");
  });
});
