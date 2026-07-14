import { describe, expect, it } from "vitest";
import { computeQuizScore, matchResultProfile } from "@/features/quiz-game/scoring";

const questions = [
  { id: "q1", points: 10, correctAnswerIds: ["q1-a1"] },
  { id: "q2", points: 10, correctAnswerIds: ["q2-a2"] },
  { id: "q3", points: 20, correctAnswerIds: ["q3-a1", "q3-a3"] },
];

const baseConfig = {
  penaltyPerWrong: 0,
  speedBonusEnabled: false,
  totalTimeLimitSeconds: null,
  minPassPercentage: null,
};

describe("computeQuizScore", () => {
  it("awards full points for all-correct answers", () => {
    const result = computeQuizScore(
      questions,
      [
        { questionId: "q1", selectedAnswerIds: ["q1-a1"] },
        { questionId: "q2", selectedAnswerIds: ["q2-a2"] },
        { questionId: "q3", selectedAnswerIds: ["q3-a1", "q3-a3"] },
      ],
      30,
      baseConfig,
    );
    expect(result.totalScore).toBe(40);
    expect(result.percentage).toBe(100);
    expect(result.questionResults.every((r) => r.correct)).toBe(true);
  });

  it("requires the exact same set of answers for multiple choice", () => {
    const result = computeQuizScore(
      questions,
      [
        { questionId: "q1", selectedAnswerIds: ["q1-a1"] },
        { questionId: "q2", selectedAnswerIds: ["q2-a2"] },
        { questionId: "q3", selectedAnswerIds: ["q3-a1"] }, // faltou uma opção correta
      ],
      30,
      baseConfig,
    );
    expect(result.questionResults.find((r) => r.questionId === "q3")?.correct).toBe(false);
    expect(result.totalScore).toBe(20);
  });

  it("treats unanswered questions as incorrect", () => {
    const result = computeQuizScore(questions, [], 5, baseConfig);
    expect(result.totalScore).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it("applies a penalty for wrong answers without going negative", () => {
    const result = computeQuizScore(
      questions,
      [
        { questionId: "q1", selectedAnswerIds: ["wrong"] },
        { questionId: "q2", selectedAnswerIds: ["wrong"] },
        { questionId: "q3", selectedAnswerIds: ["wrong"] },
      ],
      30,
      { ...baseConfig, penaltyPerWrong: 5 },
    );
    expect(result.totalScore).toBe(0);
  });

  it("computes pass/fail against the configured minimum percentage", () => {
    const passing = computeQuizScore(
      questions,
      [
        { questionId: "q1", selectedAnswerIds: ["q1-a1"] },
        { questionId: "q2", selectedAnswerIds: ["q2-a2"] },
        { questionId: "q3", selectedAnswerIds: ["q3-a1", "q3-a3"] },
      ],
      30,
      { ...baseConfig, minPassPercentage: 50 },
    );
    expect(passing.passed).toBe(true);

    const failing = computeQuizScore(questions, [], 30, { ...baseConfig, minPassPercentage: 50 });
    expect(failing.passed).toBe(false);
  });

  it("returns null passed when no minimum percentage is configured", () => {
    const result = computeQuizScore(questions, [], 30, baseConfig);
    expect(result.passed).toBeNull();
  });

  it("awards a speed bonus only for a perfect, fast run", () => {
    const config = { ...baseConfig, speedBonusEnabled: true, totalTimeLimitSeconds: 60 };
    const fast = computeQuizScore(
      questions,
      [
        { questionId: "q1", selectedAnswerIds: ["q1-a1"] },
        { questionId: "q2", selectedAnswerIds: ["q2-a2"] },
        { questionId: "q3", selectedAnswerIds: ["q3-a1", "q3-a3"] },
      ],
      10,
      config,
    );
    expect(fast.totalScore).toBeGreaterThan(40);

    const imperfect = computeQuizScore(
      questions,
      [{ questionId: "q1", selectedAnswerIds: ["q1-a1"] }],
      10,
      config,
    );
    expect(imperfect.totalScore).toBe(10);
  });
});

describe("matchResultProfile", () => {
  const profiles = [
    { id: "low", minPercentage: 0, maxPercentage: 49 },
    { id: "mid", minPercentage: 50, maxPercentage: 79 },
    { id: "high", minPercentage: 80, maxPercentage: 100 },
  ];

  it("matches the profile whose range contains the percentage", () => {
    expect(matchResultProfile(30, profiles)).toBe("low");
    expect(matchResultProfile(65, profiles)).toBe("mid");
    expect(matchResultProfile(100, profiles)).toBe("high");
  });

  it("returns null when no profile matches", () => {
    expect(matchResultProfile(30, [{ id: "high", minPercentage: 80, maxPercentage: 100 }])).toBeNull();
  });
});
