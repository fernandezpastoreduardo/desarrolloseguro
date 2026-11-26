import { describe, expect, it } from "vitest";
import { calculateTotalBlockingTime } from "./performance-timing.js";

describe("calculateTotalBlockingTime", () => {
  it("counts blocking time only between FCP and the first five-second TTI quiet window", () => {
    const result = calculateTotalBlockingTime(
      1_000,
      [
        { startTime: 500, duration: 400 },
        { startTime: 2_000, duration: 100 },
        { startTime: 8_200, duration: 200 },
      ],
      [
        { startTime: 0, responseEnd: 3_000 },
        { startTime: 1_500, responseEnd: 2_500 },
      ],
      9_000,
    );

    expect(result).toBe(50);
  });

  it("measures TBT through the bounded observation when no five-second quiet window was observed", () => {
    expect(calculateTotalBlockingTime(1_000, [], [
      { startTime: 0, responseEnd: 9_000 },
      { startTime: 0, responseEnd: 9_000 },
      { startTime: 0, responseEnd: 9_000 },
    ], 9_000)).toBe(0);
    expect(calculateTotalBlockingTime(1_000, [
      { startTime: 2_000, duration: 180 },
      { startTime: 4_000, duration: 40 },
    ], [
      { startTime: 0, responseEnd: 9_000 },
      { startTime: 0, responseEnd: 9_000 },
      { startTime: 0, responseEnd: 9_000 },
    ], 9_000)).toBe(130);
    expect(calculateTotalBlockingTime(1_000, [], [], 5_999)).toBe(0);
  });
});
