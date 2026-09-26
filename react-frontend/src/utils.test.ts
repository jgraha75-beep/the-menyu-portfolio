import { describe, expect, it } from "vitest";
import type { EventData } from "./types";
import { cutoffFor, divisionConfig, divisionLabel, judgesFor } from "./utils";

const event = {
  configuration: {
    divisions: [{
      id: "open-3v3", name: "Open 3v3", ageGroup: "Open", teamSize: 3, registrationLimit: 64,
      prelims: { enabled: true, qualifierCount: 12, secondsPerSide: 75, scoreMinimum: 1, scoreMaximum: 20 },
      bracket: { enabled: true, type: "single_elimination", qualifierCount: 12, regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 40, movesPerBattler: 1 },
      judges: ["Judge A", "Judge B"], financial: { earlyEntryFee: 3000, sameDayEntryFee: 3500, drinkFee: 500 },
    }],
  },
} as Pick<EventData, "configuration" | "judgesByDivision">;

describe("configured division helpers", () => {
  it("uses the event's division name, judges, and prelim cutoff", () => {
    expect(divisionConfig(event, "open-3v3").teamSize).toBe(3);
    expect(divisionLabel(event, "open-3v3")).toBe("Open 3v3");
    expect(cutoffFor(event, "open-3v3")).toBe(12);
    expect(judgesFor(event, "open-3v3")).toEqual(["Judge A", "Judge B"]);
  });

  it("keeps a sensible legacy fallback for older event data", () => {
    expect(divisionConfig(undefined, "2v2").teamSize).toBe(2);
    expect(cutoffFor(undefined, "under15")).toBe(8);
  });
});
