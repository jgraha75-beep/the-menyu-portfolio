const CONFIGURATION_VERSION = 1;
const LIFECYCLE_STATES = new Set(["draft", "active", "paused", "completed", "archived"]);
const COMPETITION_FORMATS = new Set(["head_to_head", "seven_to_smoke"]);

function invalidConfiguration(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_INPUT";
  return error;
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidConfiguration(`${label} must be an object`);
  return value;
}

function text(value, label, maximum = 160) {
  if (typeof value !== "string") throw invalidConfiguration(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized) throw invalidConfiguration(`${label} is required`);
  if (normalized.length > maximum) throw invalidConfiguration(`${label} must be ${maximum} characters or fewer`);
  return normalized;
}

function optionalText(value, fallback, label, maximum = 160) {
  return value === undefined || value === null || value === "" ? fallback : text(value, label, maximum);
}

function integer(value, label, { minimum = 0, maximum = 10000, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw invalidConfiguration(`${label} must be a whole number from ${minimum} to ${maximum}`);
  return value;
}

function boolean(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw invalidConfiguration(`${label} must be true or false`);
  return value;
}

function textList(value, label, { maximumItems = 24, maximumItemLength = 120, fallback = [] } = {}) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length > maximumItems) throw invalidConfiguration(`${label} must contain ${maximumItems} text values or fewer`);
  return value.map((item) => text(item, label, maximumItemLength));
}

function legacyEventConfiguration(judgesByDivision = {}) {
  return {
    schemaVersion: CONFIGURATION_VERSION,
    competitionFormat: "head_to_head",
    divisions: [
      {
        id: "2v2", name: "2v2 Battle", ageGroup: "Open", teamSize: 2, registrationLimit: null,
        prelims: { enabled: true, qualifierCount: 16, entryThreshold: 16, maxQualificationSpots: 16, judgeCount: 2, tieBreakRule: "manual_order", secondsPerSide: 90, scoreMinimum: 1, scoreMaximum: 10 },
        bracket: { enabled: true, type: "single_elimination", qualifierCount: 16, size: 16, seedMode: "prelim_rank", regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 45, movesPerBattler: 1 },
        judges: judgesByDivision["2v2"] || ["CanDoo", "D.MYST"],
        financial: { earlyEntryFee: 4000, sameDayEntryFee: 4500, drinkFee: 700 },
      },
      {
        id: "under15", name: "Under-15 1v1", ageGroup: "Under 15", teamSize: 1, registrationLimit: null,
        prelims: { enabled: true, qualifierCount: 8, entryThreshold: 8, maxQualificationSpots: 8, judgeCount: 2, tieBreakRule: "manual_order", secondsPerSide: 90, scoreMinimum: 1, scoreMaximum: 10 },
        bracket: { enabled: true, type: "single_elimination", qualifierCount: 8, size: 8, seedMode: "prelim_rank", regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 45, movesPerBattler: 1 },
        judges: judgesByDivision.under15 || ["Jay-K", "Kano"],
        financial: { earlyEntryFee: 2000, sameDayEntryFee: 2500, drinkFee: 700 },
      },
    ],
    staffRoles: ["Event lead", "Finance lead", "Check-in", "Prelim judge", "Tournament board", "DJ", "MC", "Records"],
    display: { showEntryNumbers: true, showOnDeck: true, showTimer: true, theme: "chip_chop" },
    financial: { currency: "JPY", spectatorEntryFee: 2000, spectatorDrinkFee: 700 },
  };
}

function normalizeDivision(raw, index, competitionFormat) {
  const input = plainObject(raw, `divisions[${index}]`);
  const id = text(input.id, `divisions[${index}].id`, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw invalidConfiguration(`divisions[${index}].id may only use lowercase letters, numbers, hyphens, and underscores`);
  const prelimInput = input.prelims === undefined ? {} : plainObject(input.prelims, `divisions[${index}].prelims`);
  const bracketInput = input.bracket === undefined ? {} : plainObject(input.bracket, `divisions[${index}].bracket`);
  const financeInput = input.financial === undefined ? {} : plainObject(input.financial, `divisions[${index}].financial`);
  const prelimEnabled = boolean(prelimInput.enabled, `divisions[${index}].prelims.enabled`, competitionFormat === "head_to_head");
  const bracketEnabled = boolean(bracketInput.enabled, `divisions[${index}].bracket.enabled`, competitionFormat === "head_to_head");
  if (competitionFormat === "seven_to_smoke" && (prelimEnabled || bracketEnabled)) throw invalidConfiguration("7-to-smoke divisions cannot enable the head-to-head prelim or bracket engine");
  const scoreMinimum = integer(prelimInput.scoreMinimum ?? 1, `divisions[${index}].prelims.scoreMinimum`, { minimum: 0, maximum: 100 });
  const scoreMaximum = integer(prelimInput.scoreMaximum ?? 10, `divisions[${index}].prelims.scoreMaximum`, { minimum: scoreMinimum, maximum: 100 });
  const qualifierCount = integer(prelimInput.maxQualificationSpots ?? prelimInput.qualifierCount ?? bracketInput.size ?? bracketInput.qualifierCount ?? 8, `divisions[${index}].prelims.maxQualificationSpots`, { minimum: 2, maximum: 32 });
  if (![2, 4, 8, 16, 32].includes(qualifierCount)) throw invalidConfiguration(`divisions[${index}].prelims.maxQualificationSpots must be 2, 4, 8, 16, or 32`);
  const entryThreshold = integer(prelimInput.entryThreshold ?? qualifierCount, `divisions[${index}].prelims.entryThreshold`, { minimum: 2, maximum: 5000 });
  const judges = textList(input.judges, `divisions[${index}].judges`, { maximumItems: 8, fallback: [] });
  const judgeCount = integer(prelimInput.judgeCount ?? (judges.length || 2), `divisions[${index}].prelims.judgeCount`, { minimum: 1, maximum: 8 });
  if (judges.length && judges.length !== judgeCount) throw invalidConfiguration(`divisions[${index}].prelims.judgeCount must match the number of judges`);
  const tieBreakRule = optionalText(prelimInput.tieBreakRule, "manual_order", `divisions[${index}].prelims.tieBreakRule`, 64);
  if (!["manual_order", "prelim_order"].includes(tieBreakRule)) throw invalidConfiguration(`divisions[${index}].prelims.tieBreakRule must be manual_order or prelim_order`);
  const bracketSize = integer(bracketInput.size ?? bracketInput.qualifierCount ?? qualifierCount, `divisions[${index}].bracket.size`, { minimum: 2, maximum: 32 });
  if (![2, 4, 8, 16, 32].includes(bracketSize)) throw invalidConfiguration(`divisions[${index}].bracket.size must be 2, 4, 8, 16, or 32`);
  if (bracketSize !== qualifierCount) throw invalidConfiguration(`divisions[${index}] bracket size must match maximum qualification spots`);
  const seedMode = optionalText(bracketInput.seedMode, "prelim_rank", `divisions[${index}].bracket.seedMode`, 64);
  if (!["prelim_rank", "source_number", "manual"].includes(seedMode)) throw invalidConfiguration(`divisions[${index}].bracket.seedMode must be prelim_rank, source_number, or manual`);
  return {
    id,
    name: optionalText(input.name, id, `divisions[${index}].name`),
    ageGroup: optionalText(input.ageGroup, "Open", `divisions[${index}].ageGroup`),
    teamSize: integer(input.teamSize ?? 1, `divisions[${index}].teamSize`, { minimum: 1, maximum: 12 }),
    registrationLimit: integer(input.registrationLimit, `divisions[${index}].registrationLimit`, { minimum: 1, maximum: 5000, nullable: true }),
    prelims: {
      enabled: prelimEnabled,
      qualifierCount,
      entryThreshold,
      maxQualificationSpots: qualifierCount,
      judgeCount,
      tieBreakRule,
      secondsPerSide: integer(prelimInput.secondsPerSide ?? 90, `divisions[${index}].prelims.secondsPerSide`, { minimum: 1, maximum: 600 }),
      scoreMinimum,
      scoreMaximum,
    },
    bracket: {
      enabled: bracketEnabled,
      type: optionalText(bracketInput.type, "single_elimination", `divisions[${index}].bracket.type`, 64),
      qualifierCount,
      size: bracketSize,
      seedMode,
      regularPerformanceRounds: integer(bracketInput.regularPerformanceRounds ?? 1, `divisions[${index}].bracket.regularPerformanceRounds`, { minimum: 1, maximum: 10 }),
      finalPerformanceRounds: integer(bracketInput.finalPerformanceRounds ?? 2, `divisions[${index}].bracket.finalPerformanceRounds`, { minimum: 1, maximum: 10 }),
      secondsPerBattler: integer(bracketInput.secondsPerBattler ?? 45, `divisions[${index}].bracket.secondsPerBattler`, { minimum: 1, maximum: 600 }),
      movesPerBattler: integer(bracketInput.movesPerBattler ?? 1, `divisions[${index}].bracket.movesPerBattler`, { minimum: 1, maximum: 20 }),
    },
    judges,
    financial: {
      earlyEntryFee: integer(financeInput.earlyEntryFee ?? 0, `divisions[${index}].financial.earlyEntryFee`, { minimum: 0, maximum: 1_000_000 }),
      sameDayEntryFee: integer(financeInput.sameDayEntryFee ?? 0, `divisions[${index}].financial.sameDayEntryFee`, { minimum: 0, maximum: 1_000_000 }),
      drinkFee: integer(financeInput.drinkFee ?? 0, `divisions[${index}].financial.drinkFee`, { minimum: 0, maximum: 1_000_000 }),
    },
  };
}

function normalizeEventConfiguration(raw, legacyJudges) {
  const input = raw === undefined ? legacyEventConfiguration(legacyJudges) : plainObject(raw, "configuration");
  const competitionFormat = input.competitionFormat === undefined ? "head_to_head" : text(input.competitionFormat, "configuration.competitionFormat", 64);
  if (!COMPETITION_FORMATS.has(competitionFormat)) throw invalidConfiguration("configuration.competitionFormat must be head_to_head or seven_to_smoke");
  if (!Array.isArray(input.divisions) || input.divisions.length < 1 || input.divisions.length > 24) throw invalidConfiguration("configuration.divisions must contain between 1 and 24 divisions");
  const divisions = input.divisions.map((division, index) => normalizeDivision(division, index, competitionFormat));
  if (new Set(divisions.map((division) => division.id)).size !== divisions.length) throw invalidConfiguration("configuration division ids must be unique");
  const displayInput = input.display === undefined ? {} : plainObject(input.display, "configuration.display");
  const financeInput = input.financial === undefined ? {} : plainObject(input.financial, "configuration.financial");
  const currency = optionalText(financeInput.currency, "JPY", "configuration.financial.currency", 8).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw invalidConfiguration("configuration.financial.currency must be an ISO currency code");
  return {
    schemaVersion: CONFIGURATION_VERSION,
    competitionFormat,
    divisions,
    staffRoles: textList(input.staffRoles, "configuration.staffRoles", { maximumItems: 32, fallback: legacyEventConfiguration().staffRoles }),
    display: {
      showEntryNumbers: boolean(displayInput.showEntryNumbers, "configuration.display.showEntryNumbers", true),
      showOnDeck: boolean(displayInput.showOnDeck, "configuration.display.showOnDeck", true),
      showTimer: boolean(displayInput.showTimer, "configuration.display.showTimer", true),
      theme: optionalText(displayInput.theme, "chip_chop", "configuration.display.theme", 64),
    },
    financial: {
      currency,
      spectatorEntryFee: integer(financeInput.spectatorEntryFee ?? 2000, "configuration.financial.spectatorEntryFee", { minimum: 0, maximum: 1_000_000 }),
      spectatorDrinkFee: integer(financeInput.spectatorDrinkFee ?? 700, "configuration.financial.spectatorDrinkFee", { minimum: 0, maximum: 1_000_000 }),
    },
  };
}

function ensureEventConfiguration(event) {
  event.configuration = normalizeEventConfiguration(event.configuration, event.judgesByDivision);
  event.judgesByDivision = Object.fromEntries(event.configuration.divisions.map((division) => [division.id, division.judges]));
  return event.configuration;
}

function divisionConfig(event, divisionId) {
  return ensureEventConfiguration(event).divisions.find((division) => division.id === divisionId) || null;
}

function assertKnownDivision(event, divisionId) {
  const found = divisionConfig(event, divisionId);
  if (!found) throw invalidConfiguration(`Unknown division: ${divisionId}`);
  return found;
}

function lifecycleState(value) {
  if (!LIFECYCLE_STATES.has(value)) throw invalidConfiguration("state must be draft, active, paused, completed, or archived");
  return value;
}

function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function assertConfigurationCanReplace(event, next) {
  const current = ensureEventConfiguration(event);
  const registrationsByDivision = new Map(current.divisions.map((division) => [division.id, event.registrations.filter((registration) => registration.bracket === division.id)]));
  if (event.registrations.length && current.competitionFormat !== next.competitionFormat) throw invalidConfiguration("Competition format cannot change after registrations exist");
  for (const currentDivision of current.divisions) {
    const registrations = registrationsByDivision.get(currentDivision.id) || [];
    const replacement = next.divisions.find((division) => division.id === currentDivision.id);
    if (registrations.length && !replacement) throw invalidConfiguration(`Division ${currentDivision.name} cannot be removed while it has registrations`);
    if (!replacement) continue;
    if (replacement.registrationLimit !== null && registrations.length > replacement.registrationLimit) throw invalidConfiguration(`${replacement.name} already has more registrations than its new limit`);
    if (registrations.length && replacement.teamSize !== currentDivision.teamSize) throw invalidConfiguration(`${currentDivision.name} team size cannot change after registrations exist`);
    if (event.prelimOrders[currentDivision.id]?.lockedAt && !sameJson(replacement.prelims, currentDivision.prelims)) throw invalidConfiguration(`${currentDivision.name} prelim settings cannot change after the order is locked`);
    if (event.brackets[currentDivision.id] && !sameJson(replacement.bracket, currentDivision.bracket)) throw invalidConfiguration(`${currentDivision.name} bracket settings cannot change after the bracket is created`);
    if (registrations.some((registration) => Number(registration.payment?.total || 0) > 0) && !sameJson(replacement.financial, currentDivision.financial)) throw invalidConfiguration(`${currentDivision.name} fees cannot change after payments are recorded`);
  }
  if ((Number(event.spectators?.entryMoney || 0) > 0 || Number(event.spectators?.drinkMoney || 0) > 0) && !sameJson(next.financial, current.financial)) throw invalidConfiguration("Spectator fees cannot change after spectator payments are recorded");
  return next;
}

module.exports = { CONFIGURATION_VERSION, assertConfigurationCanReplace, assertKnownDivision, divisionConfig, ensureEventConfiguration, legacyEventConfiguration, lifecycleState, normalizeEventConfiguration };
