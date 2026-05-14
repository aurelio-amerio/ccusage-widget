# ccusage-widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code extension that shows today's Claude Code spend in the right-side status bar and reveals a daily/monthly/active-5h-block breakdown on hover, sourced from `npx ccusage@latest`.

**Architecture:** Single extension with five focused modules: a typed wrapper around the ccusage CLI (`ccusage.ts`), a coalescing background poller (`poller.ts`), pure renderers (`render.ts`), a settings reader (`config.ts`), and the activation entry point (`extension.ts`). No webview, no HTTP, no persistent storage. All ccusage calls go through `child_process.spawn`. Pure-function modules are unit-tested with Vitest using captured JSON fixtures.

**Tech Stack:** TypeScript 5, VS Code Extension API (engine `^1.80.0`), Vitest, esbuild for bundling, Node's `child_process` (no extra runtime deps).

**Reference:** `reference-mhelbich/` (cloned in repo root) for VS Code extension layout — quota integration deferred, do not copy auth code.

**Spec:** `docs/superpowers/specs/2026-05-14-ccusage-widget-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `package.json` | Extension manifest, scripts, dev deps |
| `tsconfig.json` | TS compiler config (CommonJS, target ES2022) |
| `vitest.config.ts` | Vitest config (node env, fixtures path) |
| `esbuild.mjs` | Bundle script — produces `dist/extension.js` |
| `.vscodeignore` | Excludes sources, fixtures, reference repo from VSIX |
| `.gitignore` | Add `node_modules/`, `dist/`, `*.vsix` |
| `src/extension.ts` | Activation, status bar item, command registration |
| `src/ccusage.ts` | Spawn + parse `daily/monthly/blocks --json` |
| `src/poller.ts` | Interval scheduler with coalescing + `Promise.allSettled` |
| `src/render.ts` | Pure: `CacheState → {statusBarText, tooltip}` |
| `src/cache.ts` | Cache type + builder helpers |
| `src/config.ts` | Settings reader |
| `src/output.ts` | OutputChannel wrapper |
| `src/types.ts` | Shared types: `DailyReport`, `MonthlyReport`, `ActiveBlock` |
| `src/__fixtures__/daily.json` | Captured `ccusage daily --json --breakdown` output |
| `src/__fixtures__/monthly.json` | Captured `ccusage monthly --json --breakdown` |
| `src/__fixtures__/blocks-active.json` | Captured `ccusage blocks --json --active` |
| `src/__fixtures__/blocks-empty.json` | `{ "blocks": [] }` — no active block case |
| `src/ccusage.test.ts` | Parser unit tests |
| `src/render.test.ts` | Renderer unit tests |
| `src/poller.test.ts` | Poller behavior tests |

---

## Task 1: Scaffold the extension project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.mjs`, `.vscodeignore`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "ccusage-widget",
  "displayName": "ccusage Widget",
  "description": "Status-bar widget showing today's Claude Code spend via ccusage.",
  "version": "0.1.0",
  "publisher": "aurelio-amerio",
  "repository": { "type": "git", "url": "https://github.com/aurelio-amerio/ccusage-widget" },
  "license": "MIT",
  "engines": { "vscode": "^1.80.0", "node": ">=18" },
  "main": "./dist/extension.js",
  "activationEvents": ["onStartupFinished"],
  "categories": ["Other"],
  "contributes": {
    "commands": [
      { "command": "ccusageWidget.refresh", "title": "ccusage Widget: Refresh now" },
      { "command": "ccusageWidget.showOutput", "title": "ccusage Widget: Show output log" }
    ],
    "configuration": {
      "title": "ccusage Widget",
      "properties": {
        "ccusageWidget.refreshIntervalMinutes": {
          "type": "number", "default": 5, "minimum": 1,
          "description": "How often to poll ccusage for fresh data."
        },
        "ccusageWidget.ccusageCommand": {
          "type": "string", "default": "npx ccusage@latest",
          "description": "Command used to invoke ccusage. Override to 'ccusage' if installed globally."
        },
        "ccusageWidget.timezone": {
          "type": ["string", "null"], "default": null,
          "description": "Optional IANA timezone forwarded to ccusage --timezone."
        },
        "ccusageWidget.showSessionBlock": {
          "type": "boolean", "default": true,
          "description": "Show the active 5h session block section in the tooltip."
        }
      }
    }
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "vscode:prepublish": "node esbuild.mjs --production",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.80.0",
    "@vscode/vsce": "^3.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "reference-mhelbich", "**/*.test.ts"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write `esbuild.mjs`**

```javascript
import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  outfile: "dist/extension.js",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- [ ] **Step 5: Write `.vscodeignore`**

```
.vscode/**
.vscode-test/**
src/**
node_modules/**
out/**
.gitignore
.git/**
**/*.map
**/*.ts
!dist/**
esbuild.mjs
tsconfig.json
vitest.config.ts
reference-mhelbich/**
docs/**
.claude/**
.idea/**
.revisions/**
```

- [ ] **Step 6: Update `.gitignore`** — append:

```
node_modules/
dist/
*.vsix
.vscode-test/
```

- [ ] **Step 7: Install dependencies and verify build**

Run: `npm install && npm run build`
Expected: `dist/extension.js` exists; no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts esbuild.mjs .vscodeignore .gitignore
git commit -m "chore: scaffold VS Code extension project"
```

---

## Task 2: Define types and capture fixtures

**Files:**
- Create: `src/types.ts`, `src/__fixtures__/daily.json`, `src/__fixtures__/monthly.json`, `src/__fixtures__/blocks-active.json`, `src/__fixtures__/blocks-empty.json`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

export interface DailyEntry {
  date: string; // "YYYY-MM-DD"
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
}

export interface MonthlyEntry {
  month: string; // "YYYY-MM"
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
}

export interface DailyReport {
  daily: DailyEntry[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    totalCost: number;
  };
}

export interface MonthlyReport {
  monthly: MonthlyEntry[];
  totals: DailyReport["totals"];
}

export interface ActiveBlock {
  id: string;
  startTime: string; // ISO8601
  endTime: string;
  actualEndTime?: string;
  isActive: boolean;
  isGap: boolean;
  totalTokens: number;
  costUSD: number;
  models: string[];
  burnRate?: { tokensPerMinute: number; costPerHour: number };
  projection?: { totalTokens: number; totalCost: number; remainingMinutes: number };
}

export interface BlocksActiveReport {
  blocks: ActiveBlock[];
}
```

- [ ] **Step 2: Capture `daily.json` fixture**

Run: `npx ccusage@latest daily --json --breakdown > src/__fixtures__/daily.json`

If you don't have local Claude logs, paste this fixture instead (representative of real shape):

```json
{
  "daily": [
    {
      "date": "2026-05-14",
      "inputTokens": 2981,
      "outputTokens": 224877,
      "cacheCreationTokens": 1493276,
      "cacheReadTokens": 21871409,
      "totalTokens": 23592543,
      "totalCost": 15.7746119,
      "modelsUsed": ["claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
      "modelBreakdowns": [
        { "modelName": "claude-sonnet-4-6", "inputTokens": 2432, "outputTokens": 181810, "cacheCreationTokens": 748874, "cacheReadTokens": 13973747, "cost": 9.7348476 },
        { "modelName": "claude-opus-4-6", "inputTokens": 103, "outputTokens": 16682, "cacheCreationTokens": 191526, "cacheReadTokens": 2847599, "cost": 3.038402 },
        { "modelName": "claude-opus-4-7", "inputTokens": 99, "outputTokens": 17505, "cacheCreationTokens": 156370, "cacheReadTokens": 1351360, "cost": 2.0911125 },
        { "modelName": "claude-haiku-4-5-20251001", "inputTokens": 347, "outputTokens": 8880, "cacheCreationTokens": 396506, "cacheReadTokens": 3698703, "cost": 0.9102498 }
      ]
    }
  ],
  "totals": {
    "inputTokens": 2981,
    "outputTokens": 224877,
    "cacheCreationTokens": 1493276,
    "cacheReadTokens": 21871409,
    "totalCost": 15.7746119,
    "totalTokens": 23592543
  }
}
```

- [ ] **Step 3: Capture `monthly.json` fixture**

Run: `npx ccusage@latest monthly --json --breakdown > src/__fixtures__/monthly.json`

Fallback if logs unavailable:

```json
{
  "monthly": [
    {
      "month": "2026-05",
      "inputTokens": 24146,
      "outputTokens": 536845,
      "cacheCreationTokens": 4753499,
      "cacheReadTokens": 74354186,
      "totalTokens": 79668676,
      "totalCost": 44.12751105,
      "modelsUsed": ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-opus-4-7"],
      "modelBreakdowns": [
        { "modelName": "claude-sonnet-4-6", "inputTokens": 22726, "outputTokens": 457708, "cacheCreationTokens": 2811577, "cacheReadTokens": 52642649, "cost": 33.27000645 },
        { "modelName": "claude-opus-4-6", "inputTokens": 127, "outputTokens": 18028, "cacheCreationTokens": 320563, "cacheReadTokens": 3174824, "cost": 4.04226575 },
        { "modelName": "claude-haiku-4-5-20251001", "inputTokens": 1160, "outputTokens": 35126, "cacheCreationTokens": 1342877, "cacheReadTokens": 16748141, "cost": 3.53020035 },
        { "modelName": "claude-opus-4-7", "inputTokens": 133, "outputTokens": 25983, "cacheCreationTokens": 278482, "cacheReadTokens": 1788572, "cost": 3.2850385 }
      ]
    }
  ],
  "totals": {
    "inputTokens": 24146,
    "outputTokens": 536845,
    "cacheCreationTokens": 4753499,
    "cacheReadTokens": 74354186,
    "totalCost": 44.12751105,
    "totalTokens": 79668676
  }
}
```

- [ ] **Step 4: Capture `blocks-active.json` fixture**

Run: `npx ccusage@latest blocks --json --active > src/__fixtures__/blocks-active.json`

Fallback:

```json
{
  "blocks": [
    {
      "id": "2026-05-14T08:00:00.000Z",
      "startTime": "2026-05-14T08:00:00.000Z",
      "endTime": "2026-05-14T13:00:00.000Z",
      "actualEndTime": "2026-05-14T12:09:17.039Z",
      "isActive": true,
      "isGap": false,
      "entries": 559,
      "tokenCounts": {
        "inputTokens": 2984,
        "outputTokens": 225312,
        "cacheCreationInputTokens": 1497285,
        "cacheReadInputTokens": 21994671
      },
      "totalTokens": 23720252,
      "costUSD": 15.87218915,
      "models": ["claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
      "burnRate": { "tokensPerMinute": 124171.46, "tokensPerMinuteForIndicator": 1195.09, "costPerHour": 4.985 },
      "projection": { "totalTokens": 30014564, "totalCost": 20.08, "remainingMinutes": 51 }
    }
  ]
}
```

- [ ] **Step 5: Write `blocks-empty.json`**

```json
{ "blocks": [] }
```

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/__fixtures__/
git commit -m "feat: define ccusage types and capture JSON fixtures"
```

---

## Task 3: Parse ccusage output (TDD)

**Files:**
- Create: `src/ccusage.ts`, `src/ccusage.test.ts`

- [ ] **Step 1: Write the failing tests in `src/ccusage.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `./ccusage` module not found.

- [ ] **Step 3: Write minimal `src/ccusage.ts` to pass tests**

```typescript
import type {
  DailyReport,
  MonthlyReport,
  BlocksActiveReport,
  DailyEntry,
  MonthlyEntry,
  ActiveBlock,
} from "./types";

function parseJson(raw: string, kind: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse ccusage ${kind} JSON: ${(e as Error).message}`);
  }
}

export function parseDaily(raw: string): DailyReport {
  const data = parseJson(raw, "daily") as DailyReport;
  if (!data || !Array.isArray(data.daily)) {
    throw new Error("ccusage daily response missing 'daily' array");
  }
  return data;
}

export function parseMonthly(raw: string): MonthlyReport {
  const data = parseJson(raw, "monthly") as MonthlyReport;
  if (!data || !Array.isArray(data.monthly)) {
    throw new Error("ccusage monthly response missing 'monthly' array");
  }
  return data;
}

export function parseBlocksActive(raw: string): BlocksActiveReport {
  const data = parseJson(raw, "blocks") as BlocksActiveReport;
  if (!data || !Array.isArray(data.blocks)) {
    throw new Error("ccusage blocks response missing 'blocks' array");
  }
  return data;
}

export function pickTodayEntry(
  report: DailyReport,
  todayYMD: string,
): DailyEntry | null {
  return report.daily.find((e) => e.date === todayYMD) ?? null;
}

export function pickThisMonthEntry(
  report: MonthlyReport,
  thisYM: string,
): MonthlyEntry | null {
  return report.monthly.find((e) => e.month === thisYM) ?? null;
}

export function pickActiveBlock(
  report: BlocksActiveReport,
): ActiveBlock | null {
  return report.blocks.find((b) => b.isActive && !b.isGap) ?? null;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/ccusage.ts src/ccusage.test.ts
git commit -m "feat: parse ccusage daily/monthly/blocks JSON output"
```

---

## Task 4: Spawn ccusage subprocess (TDD)

**Files:**
- Modify: `src/ccusage.ts`, `src/ccusage.test.ts`

- [ ] **Step 1: Add failing tests for spawning**

Append to `src/ccusage.test.ts`:

```typescript
import { runCcusage } from "./ccusage";

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
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `runCcusage` not exported.

- [ ] **Step 3: Extend `src/ccusage.ts` with the spawn helper**

Append to `src/ccusage.ts`:

```typescript
import { spawn } from "node:child_process";

export type RunResult =
  | { ok: true; stdout: string }
  | { ok: false; exitCode: number | null; stderr: string; error?: string };

export interface RunOptions {
  command: string;
  args: string[];
  maxBufferBytes?: number;
}

export function runCcusage(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const max = opts.maxBufferBytes ?? 8 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let truncated = false;

    let child;
    try {
      child = spawn(opts.command, opts.args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, exitCode: null, stderr: "", error: (e as Error).message });
      return;
    }

    child.stdout.on("data", (buf: Buffer) => {
      if (stdout.length + buf.length > max) {
        truncated = true;
        return;
      }
      stdout += buf.toString("utf8");
    });
    child.stderr.on("data", (buf: Buffer) => {
      if (stderr.length < max) stderr += buf.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ ok: false, exitCode: null, stderr, error: err.message });
    });
    child.on("close", (code) => {
      if (truncated) {
        resolve({ ok: false, exitCode: code, stderr, error: "stdout exceeded buffer limit" });
        return;
      }
      if (code === 0) resolve({ ok: true, stdout });
      else resolve({ ok: false, exitCode: code, stderr });
    });
  });
}

export function splitCommand(commandString: string): { command: string; baseArgs: string[] } {
  const parts = commandString.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    throw new Error("ccusageCommand is empty");
  }
  return { command: parts[0], baseArgs: parts.slice(1) };
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/ccusage.ts src/ccusage.test.ts
git commit -m "feat: add child-process spawn helper for ccusage"
```

---

## Task 5: Cache and date helpers

**Files:**
- Create: `src/cache.ts`, `src/cache.test.ts`

- [ ] **Step 1: Write failing tests in `src/cache.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { emptyCache, todayYMD, thisMonthYM, formatHHMM } from "./cache";

describe("emptyCache", () => {
  it("returns a cache with no data", () => {
    const c = emptyCache();
    expect(c.today).toBeNull();
    expect(c.thisMonth).toBeNull();
    expect(c.activeBlock).toBeNull();
    expect(c.lastUpdated).toBeNull();
  });
});

describe("todayYMD", () => {
  it("formats a Date as YYYY-MM-DD in the system timezone", () => {
    const d = new Date(2026, 4, 14, 9, 30); // local time
    expect(todayYMD(d)).toBe("2026-05-14");
  });
});

describe("thisMonthYM", () => {
  it("formats a Date as YYYY-MM", () => {
    expect(thisMonthYM(new Date(2026, 4, 14))).toBe("2026-05");
  });
});

describe("formatHHMM", () => {
  it("formats a Date as HH:MM", () => {
    expect(formatHHMM(new Date(2026, 4, 14, 9, 5))).toBe("09:05");
    expect(formatHHMM(new Date(2026, 4, 14, 23, 59))).toBe("23:59");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `./cache` not found.

- [ ] **Step 3: Write `src/cache.ts`**

```typescript
import type { DailyEntry, MonthlyEntry, ActiveBlock } from "./types";

export interface SectionState<T> {
  data: T | null;
  error: string | null;
  fetchedAt: Date | null;
}

export interface CacheState {
  today: SectionState<DailyEntry>;
  thisMonth: SectionState<MonthlyEntry>;
  activeBlock: SectionState<ActiveBlock | null>;
  lastUpdated: Date | null;
}

const emptySection = <T>(): SectionState<T> => ({ data: null, error: null, fetchedAt: null });

export function emptyCache(): CacheState {
  return {
    today: emptySection(),
    thisMonth: emptySection(),
    activeBlock: emptySection(),
    lastUpdated: null,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function todayYMD(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function thisMonthYM(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function formatHHMM(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 4: Update `src/cache.ts` to fix the `emptyCache` test**

The test expects `c.today` to be `null` but we return `SectionState`. Update the test or the type — choose the test (the test is wrong; `today` should be a `SectionState`).

Replace `src/cache.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { emptyCache, todayYMD, thisMonthYM, formatHHMM } from "./cache";

describe("emptyCache", () => {
  it("returns a cache with empty section states", () => {
    const c = emptyCache();
    expect(c.today.data).toBeNull();
    expect(c.today.error).toBeNull();
    expect(c.thisMonth.data).toBeNull();
    expect(c.activeBlock.data).toBeNull();
    expect(c.lastUpdated).toBeNull();
  });
});

describe("todayYMD", () => {
  it("formats a Date as YYYY-MM-DD in the system timezone", () => {
    const d = new Date(2026, 4, 14, 9, 30);
    expect(todayYMD(d)).toBe("2026-05-14");
  });
});

describe("thisMonthYM", () => {
  it("formats a Date as YYYY-MM", () => {
    expect(thisMonthYM(new Date(2026, 4, 14))).toBe("2026-05");
  });
});

describe("formatHHMM", () => {
  it("formats a Date as HH:MM", () => {
    expect(formatHHMM(new Date(2026, 4, 14, 9, 5))).toBe("09:05");
    expect(formatHHMM(new Date(2026, 4, 14, 23, 59))).toBe("23:59");
  });
});
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cache.ts src/cache.test.ts
git commit -m "feat: add cache state type and date helpers"
```

---

## Task 6: Render module (TDD)

**Files:**
- Create: `src/render.ts`, `src/render.test.ts`

- [ ] **Step 1: Write failing tests in `src/render.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { renderStatusBarText, renderTooltip, formatCost, formatTokens } from "./render";
import { emptyCache } from "./cache";
import type { CacheState } from "./cache";
import type { DailyEntry, MonthlyEntry, ActiveBlock } from "./types";

const sampleToday: DailyEntry = {
  date: "2026-05-14",
  inputTokens: 2981,
  outputTokens: 224877,
  cacheCreationTokens: 1493276,
  cacheReadTokens: 21871409,
  totalTokens: 23592543,
  totalCost: 15.7746,
  modelsUsed: ["claude-sonnet-4-6", "claude-opus-4-7"],
  modelBreakdowns: [
    { modelName: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 9.73 },
    { modelName: "claude-opus-4-7", inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 6.04 },
  ],
};

const sampleMonth: MonthlyEntry = {
  month: "2026-05",
  inputTokens: 24146,
  outputTokens: 536845,
  cacheCreationTokens: 4753499,
  cacheReadTokens: 74354186,
  totalTokens: 79668676,
  totalCost: 44.1275,
  modelsUsed: ["claude-sonnet-4-6"],
  modelBreakdowns: [],
};

const sampleBlock: ActiveBlock = {
  id: "2026-05-14T08:00:00.000Z",
  startTime: "2026-05-14T08:00:00.000Z",
  endTime: "2026-05-14T13:00:00.000Z",
  isActive: true,
  isGap: false,
  totalTokens: 23720252,
  costUSD: 15.87,
  models: [],
  projection: { totalTokens: 30014564, totalCost: 20.08, remainingMinutes: 51 },
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
    expect(renderStatusBarText(withData())).toBe("$15.77 $(search)");
  });

  it("shows Loading when there is no data and no error", () => {
    expect(renderStatusBarText(emptyCache())).toBe("Loading… $(search)");
  });

  it("shows a question mark when there is an error and no prior data", () => {
    const c = emptyCache();
    c.today = { data: null, error: "boom", fetchedAt: new Date() };
    expect(renderStatusBarText(c)).toBe("$? $(search)");
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
    c.thisMonth = { data: null, error: "spawn failed", fetchedAt: new Date(2026, 4, 14, 14, 32) };
    const md = renderTooltip(c).value;
    expect(md).toContain("This month");
    expect(md).toMatch(/spawn failed|unavailable/i);
  });

  it("shows initial fetching message when nothing has loaded yet", () => {
    const md = renderTooltip(emptyCache()).value;
    expect(md).toMatch(/Fetching|Loading/i);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `./render` not found.

- [ ] **Step 3: Write `src/render.ts`**

```typescript
import * as vscode from "vscode";
import type { CacheState } from "./cache";
import { formatHHMM } from "./cache";
import type { DailyEntry, MonthlyEntry, ActiveBlock, ModelBreakdown } from "./types";

export interface RenderOptions {
  showSessionBlock?: boolean;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function renderStatusBarText(cache: CacheState): string {
  if (cache.today.data) return `${formatCost(cache.today.data.totalCost)} $(search)`;
  if (cache.today.error && !cache.today.data) return `$? $(search)`;
  return `Loading… $(search)`;
}

function shortModelName(name: string): string {
  const m = name.match(/claude-(opus|sonnet|haiku)/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1) : name;
}

function renderModelLine(breakdowns: ModelBreakdown[]): string {
  const nonZero = breakdowns.filter((b) => b.cost > 0);
  if (nonZero.length === 0) return "";
  const parts = nonZero
    .sort((a, b) => b.cost - a.cost)
    .map((b) => `${shortModelName(b.modelName)} ${formatCost(b.cost)}`);
  return parts.join(" · ");
}

function renderTodaySection(s: CacheState["today"]): string {
  if (s.error && !s.data) {
    return `**Today** — _unavailable: ${s.error}_`;
  }
  if (!s.data) return `**Today** — _loading…_`;
  const d = s.data;
  const breakdown = renderModelLine(d.modelBreakdowns);
  const head = `**Today** — ${formatCost(d.totalCost)} · ${formatTokens(d.totalTokens)} tok`;
  return breakdown ? `${head}\n\n${breakdown}` : head;
}

function renderMonthSection(s: CacheState["thisMonth"]): string {
  if (s.error && !s.data) return `**This month** — _unavailable: ${s.error}_`;
  if (!s.data) return `**This month** — _loading…_`;
  const m = s.data;
  return `**This month** — ${formatCost(m.totalCost)} · ${formatTokens(m.totalTokens)} tok`;
}

function renderBlockSection(s: CacheState["activeBlock"]): string | null {
  if (s.error && !s.data) return `**Active session block (5h)** — _unavailable: ${s.error}_`;
  if (!s.data) return null;
  const b = s.data;
  const remaining = b.projection?.remainingMinutes;
  const remainStr =
    typeof remaining === "number"
      ? `${Math.floor(remaining / 60)}h ${remaining % 60}m remaining`
      : "";
  const head = `**Active session block (5h)** — ${formatCost(b.costUSD)}`;
  return remainStr ? `${head}\n\n${remainStr}` : head;
}

export function renderTooltip(cache: CacheState, opts: RenderOptions = {}): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  if (!cache.lastUpdated && !cache.today.error) {
    md.appendMarkdown("### Claude Code Usage\n\n_Fetching ccusage data…_");
    return md;
  }

  const lines: string[] = ["### Claude Code Usage", ""];
  lines.push(renderTodaySection(cache.today), "");
  lines.push(renderMonthSection(cache.thisMonth), "");

  if (opts.showSessionBlock !== false) {
    const block = renderBlockSection(cache.activeBlock);
    if (block) lines.push(block, "");
  }

  lines.push("---");
  const updated = cache.lastUpdated ? formatHHMM(cache.lastUpdated) : "—";
  lines.push(`Last updated ${updated} · [Refresh](command:ccusageWidget.refresh)`);

  md.appendMarkdown(lines.join("\n"));
  return md;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS — all render tests green.

(If a test fails due to `vscode` not being importable in vitest: see Step 5.)

- [ ] **Step 5: Add a vscode shim for tests**

If the previous step failed with `Cannot find module 'vscode'`, create `src/__mocks__/vscode.ts`:

```typescript
export class MarkdownString {
  value = "";
  isTrusted = false;
  supportThemeIcons = false;
  appendMarkdown(md: string): this {
    this.value += md;
    return this;
  }
}
```

Update `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: {
      vscode: resolve(__dirname, "src/__mocks__/vscode.ts"),
    },
  },
});
```

Re-run: `npm test` — expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts src/render.test.ts src/__mocks__/vscode.ts vitest.config.ts
git commit -m "feat: render status bar text and tooltip from cache"
```

---

## Task 7: Config and output modules

**Files:**
- Create: `src/config.ts`, `src/output.ts`

- [ ] **Step 1: Write `src/config.ts`**

```typescript
import * as vscode from "vscode";

export interface WidgetConfig {
  refreshIntervalMinutes: number;
  ccusageCommand: string;
  timezone: string | null;
  showSessionBlock: boolean;
}

export function readConfig(): WidgetConfig {
  const c = vscode.workspace.getConfiguration("ccusageWidget");
  return {
    refreshIntervalMinutes: Math.max(1, c.get<number>("refreshIntervalMinutes", 5)),
    ccusageCommand: c.get<string>("ccusageCommand", "npx ccusage@latest"),
    timezone: c.get<string | null>("timezone", null),
    showSessionBlock: c.get<boolean>("showSessionBlock", true),
  };
}

export function onConfigChange(cb: (cfg: WidgetConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("ccusageWidget")) cb(readConfig());
  });
}
```

- [ ] **Step 2: Write `src/output.ts`**

```typescript
import * as vscode from "vscode";

let channel: vscode.OutputChannel | null = null;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel("ccusage Widget");
  return channel;
}

export function logError(prefix: string, err: unknown): void {
  const c = getOutputChannel();
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  c.appendLine(`[${new Date().toISOString()}] ${prefix}: ${msg}`);
}

export function logInfo(msg: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${msg}`);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts src/output.ts
git commit -m "feat: add config reader and output channel helpers"
```

---

## Task 8: Poller with coalescing (TDD)

**Files:**
- Create: `src/poller.ts`, `src/poller.test.ts`

- [ ] **Step 1: Write failing tests in `src/poller.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `./poller` not found.

- [ ] **Step 3: Write `src/poller.ts`**

```typescript
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
  try { return { ok: true, data: parse(r.stdout) }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS — all poller tests green.

- [ ] **Step 5: Commit**

```bash
git add src/poller.ts src/poller.test.ts
git commit -m "feat: implement coalescing background poller"
```

---

## Task 9: Wire the extension entry point

**Files:**
- Create: `src/extension.ts`

- [ ] **Step 1: Write `src/extension.ts`**

```typescript
import * as vscode from "vscode";
import { Poller } from "./poller";
import type { Subcommand } from "./poller";
import { runCcusage, splitCommand } from "./ccusage";
import { renderStatusBarText, renderTooltip } from "./render";
import { readConfig, onConfigChange } from "./config";
import type { WidgetConfig } from "./config";
import { logError, logInfo, getOutputChannel } from "./output";

let poller: Poller | null = null;
let statusBar: vscode.StatusBarItem | null = null;

function buildArgs(sub: Subcommand, cfg: WidgetConfig): string[] {
  const args = [sub, "--json"];
  if (sub === "daily" || sub === "monthly") args.push("--breakdown");
  if (sub === "blocks") args.push("--active");
  if (cfg.timezone) args.push("--timezone", cfg.timezone);
  return args;
}

function makeRunner(cfg: WidgetConfig) {
  const { command, baseArgs } = splitCommand(cfg.ccusageCommand);
  return async (sub: Subcommand) => {
    const args = [...baseArgs, ...buildArgs(sub, cfg)];
    logInfo(`spawn: ${command} ${args.join(" ")}`);
    const result = await runCcusage({ command, args });
    if (!result.ok) {
      const tail = result.stderr ? ` — ${result.stderr.split("\n").slice(0, 3).join(" ")}` : "";
      logError(`ccusage ${sub} failed`, `${result.error ?? `exit ${result.exitCode}`}${tail}`);
    }
    return result;
  };
}

function renderAll(cfg: WidgetConfig) {
  if (!statusBar || !poller) return;
  const cache = poller.getCache();
  statusBar.text = renderStatusBarText(cache);
  statusBar.tooltip = renderTooltip(cache, { showSessionBlock: cfg.showSessionBlock });
}

export function activate(context: vscode.ExtensionContext): void {
  let cfg = readConfig();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "ccusageWidget.refresh";
  statusBar.text = "Loading… $(search)";
  statusBar.tooltip = "Fetching ccusage data…";
  statusBar.show();

  poller = new Poller({
    intervalMs: cfg.refreshIntervalMinutes * 60_000,
    runner: makeRunner(cfg),
  });

  poller.onUpdate(() => renderAll(cfg));
  poller.start();

  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand("ccusageWidget.refresh", () => {
      void poller?.refresh();
    }),
    vscode.commands.registerCommand("ccusageWidget.showOutput", () => {
      getOutputChannel().show();
    }),
    onConfigChange((newCfg) => {
      const intervalChanged = newCfg.refreshIntervalMinutes !== cfg.refreshIntervalMinutes;
      const commandChanged = newCfg.ccusageCommand !== cfg.ccusageCommand
        || newCfg.timezone !== cfg.timezone;
      cfg = newCfg;
      if (commandChanged && poller) {
        poller.stop();
        poller = new Poller({
          intervalMs: cfg.refreshIntervalMinutes * 60_000,
          runner: makeRunner(cfg),
        });
        poller.onUpdate(() => renderAll(cfg));
        poller.start();
      } else if (intervalChanged && poller) {
        poller.setInterval(cfg.refreshIntervalMinutes * 60_000);
      }
      renderAll(cfg);
    }),
    { dispose: () => poller?.stop() },
  );
}

export function deactivate(): void {
  poller?.stop();
  poller = null;
  statusBar?.dispose();
  statusBar = null;
}
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test`
Expected: no TS errors; all tests pass.

- [ ] **Step 3: Run the bundler**

Run: `npm run build`
Expected: `dist/extension.js` produced; no errors.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire extension activation, status bar, and commands"
```

---

## Task 10: Manual verification

**Files:** none — verification only

- [ ] **Step 1: Launch Extension Development Host**

Open the project in VS Code. Press F5 (or run "Run Extension" from the debug panel). A second VS Code window opens with the extension loaded.

If no launch config exists, create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

Add `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "npm: build",
      "type": "npm",
      "script": "build",
      "problemMatcher": ["$tsc"]
    }
  ]
}
```

- [ ] **Step 2: Confirm the status bar item**

In the new window, look at the bottom-right status bar. Within 30 seconds (npx download time) the widget should show today's cost. Hover over it — the tooltip should display today, this month, and (if applicable) the active block.

- [ ] **Step 3: Test commands**

Run "ccusage Widget: Refresh now" from the Command Palette. Status bar should briefly update with a new "Last updated" timestamp in the tooltip.

Run "ccusage Widget: Show output log". The output channel should open with one or more `spawn:` entries.

- [ ] **Step 4: Test error path**

In the extension dev host, set `ccusageWidget.ccusageCommand` to `bogus-command-xyz` in settings. After the next refresh (or via the Refresh command), the status bar should show `$? $(search)` and the tooltip should mention "unavailable" with the error.

Reset to default after testing.

- [ ] **Step 5: Commit launch config**

```bash
git add .vscode/launch.json .vscode/tasks.json
git commit -m "chore: add VS Code launch/build tasks for extension dev host"
```

- [ ] **Step 6: Package the extension (optional)**

Run: `npm run package`
Expected: `ccusage-widget-0.1.0.vsix` created in the project root.

Install it locally with: `code --install-extension ccusage-widget-0.1.0.vsix` and verify the widget appears in your main VS Code window.

---

## Definition of Done

- [ ] `npm test` passes (all parser, render, poller, cache tests green)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` produces `dist/extension.js`
- [ ] Pressing F5 launches the extension dev host; status bar widget appears within 30s
- [ ] Hover shows tooltip with today, this month, and active block sections
- [ ] Refresh command updates the "Last updated" timestamp
- [ ] Setting an invalid `ccusageCommand` triggers the error tooltip without crashing
