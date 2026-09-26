import type { AuditEntry, Division, EventData, Registration, Workspace } from "./types";
import { cutoffFor } from "./utils";

export type AttentionItem = { key: string; count: number; tone: "danger" | "warning" | "blue" };

export function checkInAttention(registrations: Registration[], auditLog: AuditEntry[] = []): AttentionItem[] {
  const active = registrations.filter((registration) => registration.status !== "Canceled");
  const lateIds = new Set(auditLog.filter((entry) => entry.action === "append_late_arrival").map((entry) => entry.targetId));
  return [
    { key: "partial", count: active.filter((registration) => registration.status === "Partial").length, tone: "danger" },
    { key: "duplicates", count: active.filter((registration) => registration.duplicateOf?.length && !registration.duplicateIgnored).length, tone: "danger" },
    { key: "review", count: active.filter((registration) => registration.needsReview).length, tone: "warning" },
    { key: "payment", count: active.filter((registration) => registration.registrationSource === "same_day" && registration.status !== "Checked in").length, tone: "warning" },
    { key: "late", count: lateIds.size, tone: "blue" },
  ].filter((item) => item.count > 0) as AttentionItem[];
}

export function workspaceAttention(workspace: Workspace, division: Division, event: EventData, registrations: Registration[], auditLog: AuditEntry[] = []): AttentionItem[] {
  if (workspace === "checkin" || workspace === "now") return checkInAttention(registrations, auditLog);
  const eligible = registrations.filter((registration) => registration.bracket === division && registration.status === "Checked in");
  if (workspace === "prelims") {
    if (eligible.length <= cutoffFor(event, division)) return [];
    const unscored = eligible.filter((registration) => !Number.isInteger(registration.scores.judge1) || !Number.isInteger(registration.scores.judge2)).length;
    return [
      { key: "noOrder", count: event.prelimOrders[division]?.lockedAt ? 0 : 1, tone: "warning" },
      { key: "unscored", count: unscored, tone: "danger" },
    ].filter((item) => item.count > 0) as AttentionItem[];
  }
  if (workspace === "bracket" || workspace === "display") {
    const bracket = event.brackets[division];
    if (!bracket) return eligible.length >= 2 ? [{ key: "noBracket", count: 1, tone: "warning" }] : [];
    const openMatches = bracket.rounds.flatMap((round) => round.matches).filter((match) => match.sideA && match.sideB && !match.winnerId).length;
    return openMatches ? [{ key: "openMatches", count: openMatches, tone: "blue" }] : [];
  }
  return [];
}
