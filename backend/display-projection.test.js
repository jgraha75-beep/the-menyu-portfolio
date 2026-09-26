const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDisplayProjection } = require("./display-projection");

const divisionSettings = { name: "2v2 Battle", prelims: { qualifierCount: 16 } };
const registration = (id, name, average = null) => ({ id, bracket: "two-v-two", sourceNumber: id.slice(-1), teamName: name, email: `${id}@private.example`, phone: "private", notes: "private", scores: { average } });
const timer = { version: 1, durationSeconds: 90, remainingSeconds: 72, status: "running", startedAt: "2026-09-24T12:00:00.000Z", updatedAt: "2026-09-24T12:00:00.000Z" };
const baseEvent = () => ({
  id: "event", name: "CHIP CHOP", location: "Tokyo", eventTime: "", timeZone: "Asia/Tokyo", updatedAt: "2026-09-24T12:00:00.000Z",
  configuration: { display: { showEntryNumbers: true, showOnDeck: true, showTimer: true } },
  registrations: [registration("reg-1", "One", 8.5), registration("reg-2", "Two", 9), registration("reg-3", "Three"), registration("reg-4", "Four")],
  prelimOrders: { "two-v-two": { lockedAt: "2026-09-24T11:00:00.000Z", registrationIds: ["reg-1", "reg-2", "reg-3", "reg-4"], currentEntryIndex: 0 } },
  timers: { prelims: { "two-v-two": timer }, bracket: {} }, brackets: {},
});
const options = { divisionSettings, registrationTitle: (entry) => entry.teamName || entry.entryName, at: () => "2026-09-24T12:00:05.000Z" };

test("public display projection has current and on-deck prelims without private registration fields", () => {
  const projection = buildDisplayProjection(baseEvent(), "two-v-two", options);
  assert.equal(projection.projection.phase, "prelims");
  assert.deepEqual(projection.projection.current.score, { sideA: 8.5, sideB: 9, kind: "average" });
  assert.equal(projection.projection.current.position, "Battle 1 of 2");
  assert.equal(projection.projection.onDeck.sideA.name, "Three");
  assert.equal(projection.presentation.showOnDeck, true);
  const payload = JSON.stringify(projection);
  for (const privateValue of ["private.example", "private\"", "private"]) assert.equal(payload.includes(privateValue), false);
});

test("bracket projection chooses the next playable match in bracket order and exposes aggregate votes only", () => {
  const event = baseEvent();
  event.prelimOrders["two-v-two"].currentEntryIndex = 4;
  event.brackets["two-v-two"] = {
    id: "bracket", createdAt: "2026-09-24T12:00:00.000Z", source: "prelim_seeded", participantIds: ["reg-1", "reg-2", "reg-3", "reg-4"],
    rounds: [{ name: "Top 16", matches: [
      { id: "match-1", matchNumber: 1, sideA: "reg-1", sideB: "reg-2", winnerId: null, judgeVotes: [{ judgeNumber: 1, winnerId: "reg-2" }, { judgeNumber: 2, winnerId: "reg-1" }], requiredPerformanceRounds: 2, performanceRoundsCompleted: 1, tieBreakActive: false },
      { id: "match-2", matchNumber: 2, sideA: "reg-3", sideB: "reg-4", winnerId: null, judgeVotes: [], requiredPerformanceRounds: 2, performanceRoundsCompleted: 0, tieBreakActive: false },
    ] }],
  };
  event.timers.bracket["two-v-two"] = timer;
  const projection = buildDisplayProjection(event, "two-v-two", options);
  assert.equal(projection.projection.phase, "bracket");
  assert.equal(projection.projection.current.position, "Top 16 · Battle 1");
  assert.deepEqual(projection.projection.current.score, { sideA: 1, sideB: 1, kind: "judge_votes" });
  assert.equal(projection.projection.onDeck.sideA.name, "Three");
  assert.equal(JSON.stringify(projection).includes("judgeNumber"), false);
});

test("waiting and completed projections never invent a live matchup", () => {
  const waiting = baseEvent(); waiting.prelimOrders = {};
  assert.equal(buildDisplayProjection(waiting, "two-v-two", options).projection.current, null);
  const completed = baseEvent(); completed.prelimOrders["two-v-two"].currentEntryIndex = 4;
  const projection = buildDisplayProjection(completed, "two-v-two", options);
  assert.equal(projection.projection.phase, "complete");
  assert.equal(projection.projection.current, null);
});
