import type { Division, EventData, EventDivisionConfiguration, Registration } from "./types";
import type { Language } from "./i18n";

const legacyDivision = (division: Division): EventDivisionConfiguration => division === "2v2"
  ? { id: "2v2", name: "2v2 Battle", ageGroup: "Open", teamSize: 2, registrationLimit: null, prelims: { enabled: true, qualifierCount: 16, entryThreshold: 16, maxQualificationSpots: 16, judgeCount: 2, tieBreakRule: "manual_order", secondsPerSide: 90, scoreMinimum: 1, scoreMaximum: 10 }, bracket: { enabled: true, type: "single_elimination", qualifierCount: 16, size: 16, seedMode: "prelim_rank", regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 45, movesPerBattler: 1 }, judges: ["CanDoo", "D.MYST"], financial: { earlyEntryFee: 4000, sameDayEntryFee: 4500, drinkFee: 700 } }
  : { id: division, name: division === "under15" ? "Under-15 1v1" : division, ageGroup: "Open", teamSize: 1, registrationLimit: null, prelims: { enabled: true, qualifierCount: 8, entryThreshold: 8, maxQualificationSpots: 8, judgeCount: 2, tieBreakRule: "manual_order", secondsPerSide: 90, scoreMinimum: 1, scoreMaximum: 10 }, bracket: { enabled: true, type: "single_elimination", qualifierCount: 8, size: 8, seedMode: "prelim_rank", regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 45, movesPerBattler: 1 }, judges: ["Jay-K", "Kano"], financial: { earlyEntryFee: 2000, sameDayEntryFee: 2500, drinkFee: 700 } };
export const divisionConfig = (event: Pick<EventData, "configuration"> | undefined, division: Division) => event?.configuration?.divisions.find((item) => item.id === division) || legacyDivision(division);
export const divisionLabel = (event: Pick<EventData, "configuration"> | undefined, division: Division) => divisionConfig(event, division).name;
export const registrationTitle = (registration?: Registration) => registration?.teamName || registration?.entryName || registration?.memberNames || "Open slot";
export const yen = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
export const cutoffFor = (event: Pick<EventData, "configuration"> | undefined, division: Division) => divisionConfig(event, division).prelims.maxQualificationSpots ?? divisionConfig(event, division).prelims.qualifierCount;

export const judgesFor = (event: Pick<EventData, "configuration" | "judgesByDivision">, division: Division) =>
  event.configuration?.divisions.find((item) => item.id === division)?.judges ?? event.judgesByDivision?.[division] ?? legacyDivision(division).judges;

export const formatEventDateTime = (value: string | null | undefined, timeZone = "Asia/Tokyo", language: Language = "en") => {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
};

export const formatEventTime = (value: string | null | undefined, timeZone = "Asia/Tokyo", language: Language = "en") => {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", { timeZone, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
};

const zonedParts = (date: Date, timeZone: string) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));

export const eventLocalInputToIso = (value: string, timeZone = "Asia/Tokyo") => {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value); if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number); const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess;
  for (let attempt = 0; attempt < 2; attempt += 1) { const parts = zonedParts(new Date(result), timeZone); const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second); result += guess - represented; }
  return new Date(result).toISOString();
};

export const isoToEventLocalInput = (value: string, timeZone = "Asia/Tokyo") => {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  const parts = zonedParts(new Date(value), timeZone); return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
};

export const countdownText = (value: string | null | undefined, language: Language = "en") => {
  if (!value || Number.isNaN(Date.parse(value))) return ""; const seconds = Math.floor((Date.parse(value) - Date.now()) / 1000); if (seconds <= 0) return "started";
  const hours = Math.floor(seconds / 3600); const minutes = Math.max(1, Math.ceil((seconds % 3600) / 60));
  return language === "ja" ? `${hours ? `${hours}時間` : ""}${minutes}分` : `${hours ? `${hours}h ` : ""}${minutes}m`;
};

export const roleWorkspace: Record<string, string> = {
  "Event lead": "now",
  "Check-in": "checkin",
  "Prelim judge": "prelims",
  "Tournament board": "bracket",
  "Reports": "records",
};
