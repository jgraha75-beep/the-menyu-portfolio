import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AudienceDisplayView } from "./AudienceDisplay";
import type { PublicDisplayData } from "../types";

const entry = (number: string) => ({ id: number, number, name: `Entry ${number}` });
const matchup = (phase: "prelims" | "bracket", sideA = entry("01"), sideB = entry("02")) => ({
  id: `${phase}-1`, phase, round: phase === "prelims" ? "Prelims" : "Top 16", position: phase === "prelims" ? "Battle 1 of 3" : "Top 16 · Battle 1", state: "ready" as const, activeSide: "B" as const, sideA, sideB, score: { sideA: 8.5, sideB: 9, kind: phase === "prelims" ? "average" as const : "judge_votes" as const }, ...(phase === "bracket" ? { performance: { completed: 1, required: 2, tieBreakActive: false } } : {}),
});
const data = {
  event: { name: "CHIP CHOP" }, division: "2v2", divisionName: "2v2 Battle", qualifierCount: 16,
  presentation: { showEntryNumbers: true, showOnDeck: true, showTimer: true },
  projection: { phase: "prelims", current: matchup("prelims"), onDeck: { ...matchup("prelims", entry("03"), entry("04")), id: "prelim-2", position: "Battle 2 of 3", activeSide: null }, timer: { version: 1, durationSeconds: 90, remainingSeconds: 90, status: "running", startedAt: null, updatedAt: "" } },
} as unknown as PublicDisplayData;

describe("audience display projection", () => {
  it("shows only audience-ready current, on-deck, timing, score and position data", () => {
    const html = renderToStaticMarkup(<AudienceDisplayView data={data} seconds={90} running connection="connected" />);
    for (const text of ["CHIP CHOP", "Entry 01", "Entry 02", "Entry 03", "Entry 04", "Prelims", "Battle 1 of 3", "1:30", "On deck", "8.5", "9"]) expect(html).toContain(text);
    for (const privateText of ["staff", "audit", "configuration", "settings", "controls", "email", "phone"]) expect(html.toLowerCase()).not.toContain(privateText);
  });

  it("uses the bracket projection for round, match position, votes and performance rounds", () => {
    const bracket = matchup("bracket");
    const html = renderToStaticMarkup(<AudienceDisplayView data={{ ...data, projection: { ...data.projection, phase: "bracket", current: bracket, onDeck: null } }} seconds={42} running connection="connected" />);
    for (const text of ["Top 16", "Top 16 · Battle 1", "Judge votes", "1 / 2 rounds", "0:42"]) expect(html).toContain(text);
  });

  it("has a clear empty completion state and a quiet reconnect indicator", () => {
    const html = renderToStaticMarkup(<AudienceDisplayView data={{ ...data, projection: { ...data.projection, phase: "complete", current: null, onDeck: null } }} seconds={0} running={false} connection="reconnecting" />);
    expect(html).toContain("Division complete");
    expect(html).toContain("Updating…");
    expect(html).not.toContain('role="timer"');
  });
});
