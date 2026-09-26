const registrationTextLimits = {
  sourceNumber: 80,
  teamName: 160,
  memberNames: 240,
  entryName: 160,
  dob: 40,
  parentName: 160,
  genre: 100,
  region: 160,
  email: 254,
  phone: 64,
  instagramTeam: 120,
  notes: 4000,
};

const eventTextLimits = {
  name: 160,
  eventTime: 80,
  prelimsStartTime: 80,
  location: 160,
  timeZone: 100,
};

function invalidInput(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_INPUT";
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw invalidInput(`${label} must be an object`);
  return value;
}

function text(value, label, maximumLength, { trim = false } = {}) {
  if (typeof value !== "string") throw invalidInput(`${label} must be text`);
  const normalized = trim ? value.trim() : value;
  if (normalized.length > maximumLength) throw invalidInput(`${label} must be ${maximumLength} characters or fewer`);
  return normalized;
}

function optionalText(input, label, maximumLength, options) {
  return input[label] === undefined ? undefined : text(input[label], label, maximumLength, options);
}

function stringList(value, label, { maximumItems, maximumItemLength }) {
  if (!Array.isArray(value)) throw invalidInput(`${label} must be a list of text values`);
  if (value.length > maximumItems) throw invalidInput(`${label} must contain ${maximumItems} items or fewer`);
  return value.map((item) => text(item, label, maximumItemLength, { trim: true })).filter(Boolean);
}

function division(value, label = "bracket") {
  const normalized = text(value, label, 64, { trim: true }).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) throw invalidInput(`${label} may only use lowercase letters, numbers, hyphens, and underscores`);
  return normalized;
}

function eventMode(value, label = "mode") {
  if (value !== "live" && value !== "rehearsal") throw invalidInput(`${label} must be live or rehearsal`);
  return value;
}

function identifier(value, label, maximumLength = 160) {
  const normalized = text(value, label, maximumLength, { trim: true });
  if (!normalized) throw invalidInput(`${label} is required`);
  return normalized;
}

function wholeNumber(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw invalidInput(`${label} must be a whole number from ${minimum} to ${maximum}`);
  return value;
}

function normalizeStaff(staff) {
  const input = requireRecord(staff, "staff");
  const name = text(input.name, "staff.name", 120, { trim: true });
  const role = text(input.role, "staff.role", 120, { trim: true });
  if (!name || !role) throw invalidInput("staff.name and staff.role are required");
  return { name, role };
}

function normalizeEventFields(payload) {
  const input = requireRecord(payload, "Request body");
  const fields = {};
  for (const [field, maximumLength] of Object.entries(eventTextLimits)) {
    const value = optionalText(input, field, maximumLength, { trim: field !== "eventTime" && field !== "prelimsStartTime" });
    if (value !== undefined) fields[field] = value;
  }
  if (input.judges !== undefined) fields.judges = stringList(input.judges, "judges", { maximumItems: 8, maximumItemLength: 120 });
  if (input.mode !== undefined) fields.mode = eventMode(input.mode);
  if (input.judgesByDivision !== undefined) {
    const judges = requireRecord(input.judgesByDivision, "judgesByDivision");
    fields.judgesByDivision = {};
    for (const [bracket, namesInput] of Object.entries(judges)) {
      division(bracket, "judgesByDivision division");
      const names = stringList(namesInput, `judgesByDivision.${bracket}`, { maximumItems: 2, maximumItemLength: 120 });
      if (names.length !== 2) throw invalidInput("Each legacy division judge list needs two names");
      fields.judgesByDivision[bracket] = names;
    }
  }
  return fields;
}

function normalizeRegistrationFields(payload, { requireBracket = false } = {}) {
  const input = requireRecord(payload, "Request body");
  const fields = {};
  if (requireBracket || input.bracket !== undefined) {
    fields.bracket = division(input.bracket);
  }
  for (const [field, maximumLength] of Object.entries(registrationTextLimits)) {
    const value = optionalText(input, field, maximumLength, { trim: field !== "notes" });
    if (value !== undefined) fields[field] = value;
  }
  if (input.instagramMembers !== undefined) fields.instagramMembers = stringList(input.instagramMembers, "instagramMembers", { maximumItems: 2, maximumItemLength: 120 });
  if (input.reviewReasons !== undefined) fields.reviewReasons = stringList(input.reviewReasons, "reviewReasons", { maximumItems: 12, maximumItemLength: 240 });
  if (input.needsReview !== undefined) {
    if (typeof input.needsReview !== "boolean") throw invalidInput("needsReview must be true or false");
    fields.needsReview = input.needsReview;
  }
  return fields;
}

function normalizeImportPayload(payload) {
  const input = requireRecord(payload, "Request body");
  const bracket = division(input.bracket);
  if (input.source === "pdf" || input.fileBase64 !== undefined) {
    const fileBase64 = text(input.fileBase64, "fileBase64", 12_000_000, { trim: true });
    if (!fileBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64) || fileBase64.length % 4 === 1) throw invalidInput("fileBase64 must be a valid base64 PDF");
    return { bracket, source: "pdf", fileBase64 };
  }
  return { bracket, source: "csv", csv: text(input.csv, "csv", 2_000_000) };
}

function normalizeBackupReason(payload) {
  const input = requireRecord(payload, "Request body");
  return optionalText(input, "reason", 1000, { trim: true }) || "";
}

function normalizeTieBreakPayload(payload) {
  const input = requireRecord(payload, "Request body");
  return { bracket: division(input.bracket), registrationIds: stringList(input.registrationIds, "registrationIds", { maximumItems: 64, maximumItemLength: 160 }).map((value) => identifier(value, "registrationIds")) };
}

function normalizeRankingOverride(payload) {
  const input = requireRecord(payload, "Request body");
  return { bracket: division(input.bracket), registrationId: identifier(input.registrationId, "registrationId"), rank: wholeNumber(input.rank, "rank", { minimum: 1, maximum: 10_000 }), reason: identifier(input.reason, "reason", 1000) };
}

function normalizeMatchDecision(payload) {
  const input = requireRecord(payload, "Request body");
  const outcome = identifier(input.outcome, "outcome");
  const winnerId = input.winnerId === undefined ? undefined : identifier(input.winnerId, "winnerId");
  const decisionMethod = input.decisionMethod === undefined ? undefined : identifier(input.decisionMethod, "decisionMethod", 80);
  let judgeVotes;
  if (input.judgeVotes !== undefined) {
    if (!Array.isArray(input.judgeVotes) || input.judgeVotes.length > 8) throw invalidInput("judgeVotes must contain eight judge selections or fewer");
    judgeVotes = input.judgeVotes.map((vote) => ({ winnerId: identifier(requireRecord(vote, "judgeVotes").winnerId, "judgeVotes.winnerId") }));
  }
  return { outcome, winnerId, decisionMethod, judgeVotes };
}

module.exports = { division, eventMode, invalidInput, isRecord, normalizeBackupReason, normalizeEventFields, normalizeImportPayload, normalizeMatchDecision, normalizeRankingOverride, normalizeRegistrationFields, normalizeStaff, normalizeTieBreakPayload };
