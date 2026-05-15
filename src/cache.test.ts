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
