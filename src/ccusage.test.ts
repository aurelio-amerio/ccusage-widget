import { describe, it, expect, vi, beforeEach } from "vitest";

// ccusage v20 is CLI-only, so we shell out and parse `--json`. Mock the
// child_process layer that promisify(execFile) drives.
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => execFileMock(_cmd, _args, _opts, cb),
}));

import {
  fetchToday,
  fetchMonth,
  fetchActiveBlock,
  CcusageError,
  CCUSAGE_NOT_FOUND_MARKER,
} from "./ccusage";

const pad = (n: number) => String(n).padStart(2, "0");
function ymd(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function ym(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Make the mocked CLI return `payload` as JSON on stdout. */
function cliReturns(payload: unknown) {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
    cb(null, { stdout: JSON.stringify(payload), stderr: "" }),
  );
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe("fetchToday", () => {
  it("returns today's data when present", async () => {
    cliReturns({
      daily: [
        {
          period: ymd(),
          totalCost: 1.5,
          totalTokens: 400,
          modelBreakdowns: [{ modelName: "claude-sonnet-4-6", cost: 1.5 }],
        },
      ],
    });

    const result = await fetchToday({});
    expect(result.totalCost).toBe(1.5);
    expect(result.totalTokens).toBe(400);
    expect(result.modelBreakdowns).toHaveLength(1);
    expect(result.modelBreakdowns[0]).toEqual({ modelName: "claude-sonnet-4-6", cost: 1.5 });
  });

  it("returns zero data when no entry for today", async () => {
    cliReturns({ daily: [] });
    const result = await fetchToday({});
    expect(result.totalCost).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.modelBreakdowns).toHaveLength(0);
  });

  it("invokes `ccusage daily --json` and passes timezone", async () => {
    cliReturns({ daily: [] });
    await fetchToday({ timezone: "Europe/Rome" });
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe("ccusage");
    expect(args).toEqual(["daily", "--json", "--timezone", "Europe/Rome"]);
  });
});

describe("fetchMonth", () => {
  it("returns this month's data when present", async () => {
    cliReturns({
      monthly: [{ period: ym(), totalCost: 10.0, totalTokens: 4000 }],
    });

    const result = await fetchMonth({});
    expect(result.totalCost).toBe(10.0);
    expect(result.totalTokens).toBe(4000);
  });

  it("returns zero data when no entry for this month", async () => {
    cliReturns({ monthly: [] });
    const result = await fetchMonth({});
    expect(result.totalCost).toBe(0);
    expect(result.totalTokens).toBe(0);
  });
});

describe("error handling", () => {
  it("throws a not-found CcusageError when the binary is missing (ENOENT)", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error("spawn ccusage ENOENT"), { code: "ENOENT" });
      cb(err, { stdout: "", stderr: "" });
    });

    await expect(fetchToday({})).rejects.toMatchObject({
      name: "CcusageError",
      kind: "not-found",
    });
    await expect(fetchToday({})).rejects.toThrow(CCUSAGE_NOT_FOUND_MARKER);
  });

  it("detects a missing command from Windows shell stderr", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error("Command failed"), {
        code: 1,
        stderr: "'ccusage' is not recognized as an internal or external command",
      });
      cb(err, { stdout: "", stderr: "" });
    });

    await expect(fetchMonth({})).rejects.toMatchObject({ kind: "not-found" });
  });

  it("wraps other failures as a generic CcusageError", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: "not json", stderr: "" }),
    );

    const err = await fetchToday({}).catch((e) => e);
    expect(err).toBeInstanceOf(CcusageError);
    expect(err.kind).toBe("failed");
  });
});

describe("fetchActiveBlock", () => {
  it("returns active block data with remaining time", async () => {
    const endTime = new Date(Date.now() + 3600_000).toISOString();
    cliReturns({
      blocks: [{ id: "block-1", isActive: true, isGap: false, costUSD: 5.0, endTime }],
    });

    const result = await fetchActiveBlock({});
    expect(result).not.toBeNull();
    expect(result!.costUSD).toBe(5.0);
    expect(result!.remainingMinutes).toBeGreaterThan(0);
  });

  it("returns null when no active block", async () => {
    cliReturns({ blocks: [] });
    const result = await fetchActiveBlock({});
    expect(result).toBeNull();
  });

  it("skips gap blocks", async () => {
    const endTime = new Date(Date.now() + 3600_000).toISOString();
    cliReturns({
      blocks: [{ id: "gap-1", isActive: true, isGap: true, costUSD: 0, endTime }],
    });

    const result = await fetchActiveBlock({});
    expect(result).toBeNull();
  });
});
