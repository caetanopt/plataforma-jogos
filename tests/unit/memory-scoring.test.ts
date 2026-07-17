import { describe, expect, it } from "vitest";
import { computeMemoryScore } from "@/features/memory-game/scoring";

const baseConfig = {
  pointsPerPair: 10,
  penaltyPerMistake: 2,
  speedBonusEnabled: false,
  timeLimitSeconds: null,
  maxAttempts: null,
};

describe("computeMemoryScore", () => {
  it("awards full points with no mistakes", () => {
    const result = computeMemoryScore({
      pairsTotal: 8,
      pairsFound: 8,
      attempts: 8,
      timeSeconds: 40,
      config: baseConfig,
    });
    expect(result.completed).toBe(true);
    expect(result.score).toBe(80);
  });

  it("penalizes mistakes beyond the minimum attempts", () => {
    const result = computeMemoryScore({
      pairsTotal: 8,
      pairsFound: 8,
      attempts: 12,
      timeSeconds: 40,
      config: baseConfig,
    });
    expect(result.score).toBe(80 - 4 * 2);
  });

  it("never returns a negative score", () => {
    const result = computeMemoryScore({
      pairsTotal: 8,
      pairsFound: 2,
      attempts: 30,
      timeSeconds: 40,
      config: { ...baseConfig, penaltyPerMistake: 100 },
    });
    expect(result.score).toBe(0);
  });

  it("is not completed when the time limit is exceeded", () => {
    const result = computeMemoryScore({
      pairsTotal: 8,
      pairsFound: 8,
      attempts: 8,
      timeSeconds: 61,
      config: { ...baseConfig, timeLimitSeconds: 60 },
    });
    expect(result.completed).toBe(false);
    expect(result.withinTimeLimit).toBe(false);
  });

  it("is not completed when max attempts are exceeded", () => {
    const result = computeMemoryScore({
      pairsTotal: 8,
      pairsFound: 8,
      attempts: 25,
      timeSeconds: 40,
      config: { ...baseConfig, maxAttempts: 20 },
    });
    expect(result.completed).toBe(false);
    expect(result.withinAttemptLimit).toBe(false);
  });

  it("awards a speed bonus for finishing well within the time limit", () => {
    const withoutBonus = computeMemoryScore({
      pairsTotal: 10,
      pairsFound: 10,
      attempts: 10,
      timeSeconds: 30,
      config: { ...baseConfig, timeLimitSeconds: 60, speedBonusEnabled: false },
    });
    const withBonus = computeMemoryScore({
      pairsTotal: 10,
      pairsFound: 10,
      attempts: 10,
      timeSeconds: 30,
      config: { ...baseConfig, timeLimitSeconds: 60, speedBonusEnabled: true },
    });
    expect(withBonus.score).toBeGreaterThan(withoutBonus.score);
  });

  it("never awards a speed bonus for an incomplete game", () => {
    const result = computeMemoryScore({
      pairsTotal: 10,
      pairsFound: 4,
      attempts: 4,
      timeSeconds: 10,
      config: { ...baseConfig, timeLimitSeconds: 60, speedBonusEnabled: true },
    });
    expect(result.completed).toBe(false);
    expect(result.score).toBe(40);
  });

  it("clamps a manipulated pairsFound to the real number of pairs", () => {
    const result = computeMemoryScore({
      pairsTotal: 8,
      pairsFound: 999_999,
      attempts: 8,
      timeSeconds: 40,
      config: baseConfig,
    });
    expect(result.pairsFound).toBe(8);
    expect(result.score).toBe(80);
  });

  it("clamps attempts to at least pairsFound and rejects negative/NaN input", () => {
    const result = computeMemoryScore({
      pairsTotal: 8,
      pairsFound: 8,
      attempts: -5,
      timeSeconds: -10,
      config: baseConfig,
    });
    expect(result.attempts).toBe(8);
    expect(result.timeSeconds).toBe(0);
    expect(result.score).toBe(80);
  });
});
