const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeEventConfiguration } = require("./event-configuration");
const { transitionCompetitionState } = require("./competition-state");
const { cutoffTie, rankEntries, scoreAverage, shouldRunPrelims } = require("./prelim-rules");
const { firstPairs } = require("./bracket-rules");

test("normalizes configurable prelim, judge, tie-break, and bracket settings", () => {
  const configuration = normalizeEventConfiguration({ competitionFormat: "head_to_head", divisions: [{ id: "open", name: "Open", teamSize: 1, prelims: { enabled: true, entryThreshold: 12, maxQualificationSpots: 16, judgeCount: 3, tieBreakRule: "prelim_order", scoreMinimum: 1, scoreMaximum: 10 }, bracket: { enabled: true, size: 16 }, judges: ["A", "B", "C"] }] });
  assert.equal(configuration.divisions[0].prelims.entryThreshold, 12);
  assert.equal(configuration.divisions[0].prelims.judgeCount, 3);
  assert.equal(configuration.divisions[0].bracket.size, 16);
  assert.equal(shouldRunPrelims(12, configuration.divisions[0].prelims), false);
  assert.equal(shouldRunPrelims(13, configuration.divisions[0].prelims), true);
});

test("ranks variable judge scores and resolves a configured tie by prelim order", () => {
  const entries = [
    { id: "a", prelimOrder: 2, createdAt: "2026-01-01", scores: { judgeScores: [8, 8, 8] } },
    { id: "b", prelimOrder: 1, createdAt: "2026-01-01", scores: { judgeScores: [8, 8, 8] } },
    { id: "c", prelimOrder: 3, createdAt: "2026-01-01", scores: { judgeScores: [7, 7, 7] } },
  ];
  const ranked = rankEntries(entries, { judgeCount: 3, tieBreakRule: "prelim_order" });
  assert.equal(scoreAverage(entries[0], 3), 8);
  assert.deepEqual(ranked.map((entry) => entry.id), ["b", "a", "c"]);
  assert.deepEqual(cutoffTie(ranked, 1, 3).map((entry) => entry.id), ["b", "a"]);
});

test("creates a fixed Top 8 shape with explicit byes and enforces state transitions", () => {
  const pairs = firstPairs(["seed-1", "seed-2", "seed-3"], { seeded: true, size: 8 });
  assert.equal(pairs.length, 4);
  assert.equal(pairs.flat().filter(Boolean).length, 3);
  const registration = { competitionState: "registered" };
  transitionCompetitionState(registration, "checked_in");
  transitionCompetitionState(registration, "prelim_assigned");
  transitionCompetitionState(registration, "performing");
  transitionCompetitionState(registration, "scored");
  transitionCompetitionState(registration, "qualified");
  transitionCompetitionState(registration, "seeded");
  transitionCompetitionState(registration, "bracketed");
  transitionCompetitionState(registration, "completed");
  assert.equal(registration.competitionState, "completed");
});
