import { describe, expect, it } from "vitest";
import { utcToZonedDateTimeLocal, zonedDateTimeToUtc } from "@/lib/dates/timezone";

describe("zonedDateTimeToUtc", () => {
  it("converts a wall-clock time in Europe/Lisbon during winter (WET, UTC+0)", () => {
    const utc = zonedDateTimeToUtc("2026-01-15T10:00", "Europe/Lisbon");
    expect(utc?.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("converts a wall-clock time in Europe/Lisbon during summer (WEST, UTC+1)", () => {
    const utc = zonedDateTimeToUtc("2026-07-15T10:00", "Europe/Lisbon");
    expect(utc?.toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });

  it("converts a wall-clock time in a timezone with a fixed non-zero offset", () => {
    // America/Sao_Paulo é UTC-3 durante todo o ano desde que deixou de observar DST.
    const utc = zonedDateTimeToUtc("2026-07-15T10:00", "America/Sao_Paulo");
    expect(utc?.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("returns null for a malformed input", () => {
    expect(zonedDateTimeToUtc("not-a-date", "Europe/Lisbon")).toBeNull();
  });
});

describe("utcToZonedDateTimeLocal", () => {
  it("is the inverse of zonedDateTimeToUtc for Europe/Lisbon in winter", () => {
    const original = "2026-01-15T10:00";
    const utc = zonedDateTimeToUtc(original, "Europe/Lisbon");
    expect(utc).not.toBeNull();
    expect(utcToZonedDateTimeLocal(utc!, "Europe/Lisbon")).toBe(original);
  });

  it("is the inverse of zonedDateTimeToUtc for Europe/Lisbon in summer (DST)", () => {
    const original = "2026-07-15T10:00";
    const utc = zonedDateTimeToUtc(original, "Europe/Lisbon");
    expect(utc).not.toBeNull();
    expect(utcToZonedDateTimeLocal(utc!, "Europe/Lisbon")).toBe(original);
  });

  it("formats a known UTC instant correctly for a different timezone", () => {
    const utc = new Date("2026-07-15T13:00:00.000Z");
    expect(utcToZonedDateTimeLocal(utc, "America/Sao_Paulo")).toBe("2026-07-15T10:00");
  });
});
