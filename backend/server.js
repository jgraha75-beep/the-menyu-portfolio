const http = require("node:http");
const crypto = require("node:crypto");
const { createAuthenticator } = require("./auth");
const { loadRuntimeConfig } = require("./config");
const { createHttpTools } = require("./http");
const { createPersistenceFromEnv } = require("./persistence");
const { digestJson, digestJsonLegacy } = require("./integrity");
const { division, eventMode, invalidInput, isRecord, normalizeBackupReason, normalizeEventFields, normalizeImportPayload, normalizeMatchDecision, normalizeRankingOverride, normalizeRegistrationFields, normalizeStaff, normalizeTieBreakPayload } = require("./input-validation");
const { simplePDF } = require("./pdf-export");
const { parseCSV, parseCSVPreview } = require("./csv-import");
const { parsePDFPreview } = require("./pdf-import");
const { assertConfigurationCanReplace, assertKnownDivision, divisionConfig, ensureEventConfiguration, legacyEventConfiguration, lifecycleState, normalizeEventConfiguration } = require("./event-configuration");
const { ensureCompetitionState, transitionCompetitionState } = require("./competition-state");
const { cutoffTie: prelimCutoffTie, hasCompleteScores, rankEntries, scoreAverage: prelimScoreAverage, sameIds: sameParticipantIds, shouldRunPrelims } = require("./prelim-rules");
const { firstPairs: configuredPairs } = require("./bracket-rules");
const { EDIT_FIELDS, fieldChanges, stampFields, evaluateAction } = require("./offline-actions");
const { buildDisplayProjection } = require("./display-projection");
const { assignmentForStaff, applyLockedScores, assignmentsFor, assertEventLead, isEventLead, lockWhenReady, monitorStatus, normalizeScore, publicScoreRecord, scoreRecords } = require("./judging");
const { correctionTransaction, ensureFinanceState, financeReport, importCostRecords, normalizeTransaction, previewCostImport } = require("./finance");

const runtime = loadRuntimeConfig();
const PORT = runtime.port;
const persistence = createPersistenceFromEnv();
let persistenceReady = null;
const DEFAULT_LOCATION = "Tokyo, Japan";
const DEFAULT_TIME_ZONE = "Asia/Tokyo";

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
const now = () => new Date().toISOString();
const { applyResponseHeaders, sendJSON, sendFile, readBody, requestError } = createHttpTools(runtime);
const { authenticate, accessCodeMatches, clearFailedLogins, recordFailedLogin, requireLoginCapacity, signSession } = createAuthenticator({ ...runtime, requestError, now });
const canonical = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const money = (value) => Number(value || 0);
const splitMembers = (value) => String(value || "").split(/\s*(?:,|&|\/|、)\s*/).map((name) => name.trim()).filter(Boolean);
const routeParts = (url) => url.split("?")[0].split("/").filter(Boolean);
const query = (url) => new URL(url, "http://localhost").searchParams;
const nextPowerOfTwo = (value) => { let size = 1; while (size < Math.max(value, 2)) size *= 2; return size; };
const divisionFor = (event, bracket) => assertKnownDivision(event, bracket);
const cutoffFor = (event, bracket) => divisionFor(event, bracket).prelims.maxQualificationSpots;
const formatFor = (event, bracket) => {
  const settings = divisionFor(event, bracket).bracket;
  return { decision: "Board operator records the judges' right/left result after all performance rounds", regular: { performanceRounds: settings.regularPerformanceRounds, secondsPerBattler: settings.secondsPerBattler, movesPerBattler: settings.movesPerBattler }, final: { performanceRounds: settings.finalPerformanceRounds, secondsPerBattler: settings.secondsPerBattler, movesPerBattler: settings.movesPerBattler } };
};
const divisionFees = (event, bracket) => divisionFor(event, bracket).financial;
const spectatorFees = (event) => ensureEventConfiguration(event).financial;
function validTimeZone(value) { try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; } }
function nextDisplayCode(event) { event.nextRegistrationNumber = Number.isInteger(event.nextRegistrationNumber) && event.nextRegistrationNumber > 0 ? event.nextRegistrationNumber : 1; const code = `CC-${String(event.nextRegistrationNumber).padStart(4, "0")}`; event.nextRegistrationNumber += 1; return code; }

function shuffle(values) { const copy = [...values]; for (let i = copy.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
async function initializePersistence() { persistenceReady ||= persistence.initialize(); await persistenceReady; }
async function readStore() { await initializePersistence(); const store = await persistence.readStore(); store.events ||= []; for (const event of store.events) ensureEventShape(event); return store; }
function parseJSON(raw) { try { const payload = raw ? JSON.parse(raw) : {}; if (!isRecord(payload)) throw invalidInput("Request body must be an object"); return payload; } catch (error) { if (error.code === "INVALID_INPUT") throw error; throw invalidInput("Request body must be valid JSON"); } }
function setEventRevisionHeader(res, event) { res.setHeader("X-Event-Revision", String(event.revision)); }
function revisionFromRequest(req, payload) {
  const raw = req.headers["if-match"] ?? payload.expectedRevision;
  if (raw === undefined || raw === null || raw === "") return null;
  const normalized = String(raw).trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const revision = Number(normalized); return Number.isInteger(revision) && revision >= 0 ? revision : null;
}
function requireCurrentRevision(req, payload, event) {
  const expected = revisionFromRequest(req, payload);
  if (expected === null) { const error = new Error("Refresh this event before making changes"); error.statusCode = 428; error.code = "REVISION_REQUIRED"; error.currentRevision = event.revision; throw error; }
  if (expected !== event.revision) { const error = new Error("Another device updated this event. The latest data has been loaded; review it and retry"); error.statusCode = 409; error.code = "REVISION_CONFLICT"; error.currentRevision = event.revision; throw error; }
}
function requireRegistrationVersion(payload, registration, event) {
  if (!payload.expectedUpdatedAt) { const error = new Error("Refresh this registration before editing it"); error.statusCode = 428; error.code = "RESOURCE_VERSION_REQUIRED"; error.currentRevision = event.revision; throw error; }
  if (payload.expectedUpdatedAt !== registration.updatedAt) { const error = new Error("Another device changed this registration. The latest data has been loaded; review it and retry"); error.statusCode = 409; error.code = "RESOURCE_CONFLICT"; error.currentRevision = event.revision; throw error; }
}
function mergeSafeMutation(method, route) {
  if (method !== "POST") return false;
  if (["import", "staff-attendance", "spectators", "timers"].includes(route[3])) return true;
  return route[3] === "registrations" && (!route[4] || route[5] === "check-in");
}
async function commitEvent(store, event, res, { create = false } = {}) { const expectedRevision = event.revision; event.revision += 1; event.updatedAt = now(); await persistence.commitEvent(store, event, { expectedRevision, create }); setEventRevisionHeader(res, event); }
async function commitMergeSafe(eventId, res, mutate, attempts = 5) {
  let lastConflict;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const latestStore = await readStore(); const latestEvent = findEvent(latestStore, eventId);
    if (!latestEvent) { const error = new Error("Event not found"); error.statusCode = 404; throw error; }
    if (!["draft", "active"].includes(latestEvent.lifecycle.status)) { const error = new Error(latestEvent.lifecycle.status === "archived" ? "This event is archived. Restore it before changing event operations." : `This event is ${latestEvent.lifecycle.status}. Set it active before changing event operations.`); error.statusCode = 409; error.code = latestEvent.lifecycle.status === "archived" ? "EVENT_ARCHIVED" : "EVENT_NOT_ACTIVE"; error.currentRevision = latestEvent.revision; throw error; }
    const result = await mutate(latestEvent, latestStore);
    if (result?.skipCommit) { setEventRevisionHeader(res, latestEvent); return { event: latestEvent, result, committed: false }; }
    try { await commitEvent(latestStore, latestEvent, res); return { event: latestEvent, result, committed: true }; }
    catch (error) { if (error.code !== "REVISION_CONFLICT") throw error; lastConflict = error; }
  }
  throw lastConflict;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
async function syncOfflineAction(eventId, command, staff, res) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const store = await readStore(); const event = findEvent(store, eventId);
    if (!event) throw Object.assign(new Error("Event not found"), { statusCode: 404 });
    const { result, replay } = evaluateAction(event, command, staff, { applyEdit: applyRegistrationEdit, audit });
    if (replay) { setEventRevisionHeader(res, event); return result; }
    try { await commitEvent(store, event, res); return result; }
    catch (error) { if (error.code !== "REVISION_CONFLICT" || attempt === 4) throw error; }
  }
}
function applyRegistrationEdit(event, registration, fields, staff) {
  const before = Object.fromEntries(EDIT_FIELDS.map((field) => [field, JSON.stringify(registration[field])]));
  Object.assign(registration, fields); syncMembers(event, registration);
  registration.duplicateOf = duplicateIds(event, registration); recalculatePayments(event);
  const changed = [...new Set([...Object.keys(fields), ...EDIT_FIELDS.filter((field) => before[field] !== JSON.stringify(registration[field]))])];
  registration.updatedAt = now(); stampFields(event, registration, changed, staff, registration.updatedAt);
}
function backupDigest(event) { return digestJson(event); }
function backupDigestMatches(event, expected) { return expected === digestJson(event) || expected === digestJsonLegacy(event); }
function backupSummary(backup) { return { backupId: backup.backupId, eventId: backup.eventId, eventName: backup.eventName, createdAt: backup.createdAt, reason: backup.reason || "", kind: backup.kind || "manual", createdBy: backup.createdBy, revision: backup.event?.revision ?? null, registrationCount: backup.event?.registrations?.length ?? 0 }; }
async function createEventBackup(event, staff, reason = "", kind = "manual") {
  const eventCopy = clone(event); const backup = { schemaVersion: 1, backupId: id("backup"), eventId: event.id, eventName: event.name, createdAt: now(), reason, kind, createdBy: { name: staff.name, role: staff.role }, integrity: { algorithm: "sha256", encoding: "canonical-json-v1", eventDigest: backupDigest(eventCopy) }, event: eventCopy };
  await persistence.saveBackup(backup); return backupSummary(backup);
}
async function loadEventBackup(eventId, backupId) {
  const backup = await persistence.loadBackup(eventId, backupId);
  if (backup.schemaVersion !== 1 || backup.eventId !== eventId || !backup.event || backup.integrity?.algorithm !== "sha256" || !backupDigestMatches(backup.event, backup.integrity.eventDigest)) throw new Error("Backup integrity check failed");
  return backup;
}
async function listEventBackups(eventId) {
  const summaries = [];
  for (const backupId of await persistence.listBackups(eventId)) {
    try { summaries.push(backupSummary(await loadEventBackup(eventId, backupId))); } catch { /* Invalid backups are hidden and cannot be restored. */ }
  }
  return summaries.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}
async function importPreview(event, intake) {
  const config = divisionFor(event, intake.bracket);
  const options = { teamSize: config.teamSize };
  if (intake.source === "pdf") return parsePDFPreview(Buffer.from(intake.fileBase64, "base64"), intake.bracket, options);
  return parseCSVPreview(intake.csv, intake.bracket, options);
}
function reversedAuditIds(event) {
  return new Set((event.auditLog || []).flatMap((entry) => [entry.details?.reversalOfAuditId, ...(entry.details?.reversalOfAuditIds || [])]).filter(Boolean));
}
async function importHistory(event) {
  const backups = new Map((await listEventBackups(event.id)).filter((backup) => backup.kind === "import").map((backup) => [backup.backupId, backup]));
  const reversed = reversedAuditIds(event);
  return [...(event.auditLog || [])].filter((entry) => entry.action === "import_csv").reverse().map((entry) => ({
    importId: entry.details?.importId || null,
    auditId: entry.id,
    division: entry.targetId,
    createdAt: entry.at,
    count: Number(entry.details?.count || 0),
    registrationIds: entry.details?.registrationIds || [],
    sourceType: entry.details?.sourceType || "csv",
    undone: reversed.has(entry.id),
    backup: entry.details?.importId ? backups.get(entry.details.importId) || null : null,
  }));
}
function latestUnreversedImport(event) {
  const reversed = reversedAuditIds(event);
  return [...(event.auditLog || [])].reverse().find((entry) => entry.action === "import_csv" && entry.details?.importId && !reversed.has(entry.id));
}
function mergeStaffAttendance(current = [], restored = []) { const merged = new Map(); for (const record of [...restored, ...current]) { const existing = merged.get(record.key); if (!existing) merged.set(record.key, record); else merged.set(record.key, { ...existing, signedInAt: String(existing.signedInAt) < String(record.signedInAt) ? existing.signedInAt : record.signedInAt, lastActiveAt: String(existing.lastActiveAt) > String(record.lastActiveAt) ? existing.lastActiveAt : record.lastActiveAt }); } return [...merged.values()]; }
async function restoreEventBackup(store, event, backupId, staff) {
  const backup = await loadEventBackup(event.id, backupId); const safetyBackup = await createEventBackup(event, staff, `Automatic safety backup before restoring ${backupId}`, "pre_restore"); const restored = clone(backup.event);
  ensureEventShape(restored); restored.id = event.id; restored.createdAt = event.createdAt; restored.revision = event.revision; restored.updatedAt = event.updatedAt; restored.auditLog = clone(event.auditLog || []); restored.staffAttendance = mergeStaffAttendance(event.staffAttendance, restored.staffAttendance);
  restored.offlineReceipts = clone(event.offlineReceipts || {});
  for (const registration of restored.registrations) stampFields(restored, registration, EDIT_FIELDS, staff);
  audit(restored, staff, "restore_event_backup", "backup", backupId, { restoredBackupCreatedAt: backup.createdAt, restoredBackupReason: backup.reason || "", safetyBackupId: safetyBackup.backupId });
  const index = store.events.findIndex((candidate) => candidate.id === event.id); store.events[index] = restored; return { event: restored, restoredBackup: backupSummary(backup), safetyBackup };
}
function staffFrom(payload) { return normalizeStaff(payload.staff); }
function staffKey(staff) { return `${canonical(staff?.name)}:${canonical(staff?.role)}`; }
function staffHasRole(staff, role) { return String(staff?.role || "").split(",").some((candidate) => canonical(candidate) === canonical(role)); }
function assertFinanceManager(staff) {
  if (!staffHasRole(staff, "Event lead") && !staffHasRole(staff, "Finance lead")) {
    const error = new Error("Only an Event lead or Finance lead can change financial records"); error.statusCode = 403; error.code = "FINANCE_NOT_AUTHORIZED"; throw error;
  }
}
function assertFinanceEventLead(staff) {
  if (!staffHasRole(staff, "Event lead")) { const error = new Error("Only an Event lead can reopen a closed event"); error.statusCode = 403; error.code = "FINANCE_REOPEN_NOT_AUTHORIZED"; throw error; }
}
function recordStaffPresence(event, staff) {
  if (!staff?.name || !staff?.role) return null;
  event.staffAttendance ||= [];
  const key = staffKey(staff); const at = now(); let record = event.staffAttendance.find((item) => item.key === key);
  if (!record) { record = { id: id("staff"), key, name: staff.name.trim(), role: staff.role.trim(), signedInAt: at, lastActiveAt: at }; event.staffAttendance.push(record); }
  else record.lastActiveAt = at;
  return record;
}
function audit(event, staff, action, targetType, targetId, details = {}) { recordStaffPresence(event, staff); const entry = { id: id("audit"), at: now(), staffName: staff?.name || "Unknown", staffRole: staff?.role || "Unknown", action, targetType, targetId, details }; event.auditLog.push(entry); return entry; }
function latestUnreversedAudit(event, action, targetId, predicate = () => true) {
  const reversed = new Set((event.auditLog || []).flatMap((entry) => [entry.details?.reversalOfAuditId, ...(entry.details?.reversalOfAuditIds || [])]).filter(Boolean));
  return [...(event.auditLog || [])].reverse().find((entry) => entry.action === action && entry.targetId === targetId && !reversed.has(entry.id) && predicate(entry));
}

function ensureBracketShape(event, bracket) {
  bracket.format = typeof bracket.format?.regular === "string" || !bracket.format ? formatFor(event, bracket.division) : bracket.format;
  for (const round of bracket.rounds || []) for (const match of round.matches || []) {
    match.roundName ||= round.name;
    match.requiredPerformanceRounds ||= round.name === "Final" ? bracket.format.final.performanceRounds : bracket.format.regular.performanceRounds;
    match.performanceRoundsCompleted ??= match.winnerId ? match.requiredPerformanceRounds : 0;
    match.performanceRoundCompletedAt ||= [];
    match.tieBreakCount ??= 0; match.tieBreakActive ??= false; match.tieBreakHistory ||= [];
  }
}

function ensureEventShape(event) {
  event.revision = Number.isInteger(event.revision) && event.revision >= 0 ? event.revision : 0; event.updatedAt ||= event.createdAt || now();
  event.lifecycle ||= { status: "active", archivedAt: null, archivedBy: null }; event.lifecycle.status = ["draft", "active", "paused", "completed", "archived"].includes(event.lifecycle.status) ? event.lifecycle.status : "active"; event.lifecycle.archivedAt ||= null; event.lifecycle.archivedBy ||= null;
  event.location ||= DEFAULT_LOCATION; event.timeZone = validTimeZone(event.timeZone) ? event.timeZone : DEFAULT_TIME_ZONE; event.prelimsStartTime ||= ""; event.mode = event.mode === "rehearsal" ? "rehearsal" : "live";
  event.people ||= []; event.registrations ||= []; event.spectators ||= { count: 0, entryMoney: 0, drinkMoney: 0 }; event.prelimOrders ||= {}; event.prelimTieBreaks ||= {}; event.bracketSeeds ||= {}; event.brackets ||= {}; event.auditLog ||= []; event.staffAttendance ||= []; event.judges ||= []; event.judgeAssignments ||= {}; event.timers ||= { prelims: {}, bracket: {} }; ensureEventConfiguration(event); ensureFinanceState(event);
  const usedNumbers = event.registrations.map((registration) => /^(?:CC|SD)-(\d+)$/.exec(String(registration.displayCode || ""))).filter(Boolean).map((match) => Number(match[1])); event.nextRegistrationNumber = Math.max(Number.isInteger(event.nextRegistrationNumber) ? event.nextRegistrationNumber : 1, usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1);
  for (const registration of event.registrations) {
    registration.createdAt ||= event.createdAt || event.updatedAt; registration.updatedAt ||= registration.createdAt;
    registration.displayCode ||= nextDisplayCode(event); registration.registrationSource ||= "early"; registration.status ||= "Registered"; registration.members ||= []; registration.payment ||= { battlerEntry: 0, drink: 0, total: 0, paidAt: null }; registration.scores ||= { judge1: null, judge2: null, average: null }; registration.scores.judgeScores ||= [registration.scores.judge1 ?? null, registration.scores.judge2 ?? null]; registration.instagramMembers ||= []; ensureCompetitionState(registration);
  }
  for (const division of event.configuration.divisions) assignmentsFor(event, division);
  for (const bracket of Object.values(event.brackets)) ensureBracketShape(event, bracket);
}
function eventTimer(event, scope, division) {
  if (!["prelims", "bracket"].includes(scope)) throw new Error("Timer scope must be prelims or bracket");
  const config = divisionFor(event, division);
  if (scope === "prelims" && !config.prelims.enabled) throw new Error("Prelims are not enabled for this division");
  if (scope === "bracket" && !config.bracket.enabled) throw new Error("Bracket timing is not enabled for this division");
  event.timers ||= { prelims: {}, bracket: {} }; event.timers[scope] ||= {};
  const duration = scope === "prelims" ? config.prelims.secondsPerSide : config.bracket.secondsPerBattler;
  event.timers[scope][division] ||= { version: 0, durationSeconds: duration, remainingSeconds: duration, status: "idle", startedAt: null, updatedAt: event.updatedAt };
  return event.timers[scope][division];
}
function timerRemaining(timer, at = Date.now()) { if (timer.status !== "running" || !timer.startedAt) return timer.remainingSeconds; return Math.max(0, timer.remainingSeconds - Math.floor((at - Date.parse(timer.startedAt)) / 1000)); }
function controlTimer(event, scope, division, payload) {
  const staff = staffFrom(payload); const timer = eventTimer(event, scope, division);
  if (!Number.isInteger(payload.expectedTimerVersion) || payload.expectedTimerVersion !== timer.version) { const error = new Error("Another device changed this timer. The latest timer state has been loaded; review it and retry"); error.statusCode = 409; error.code = "TIMER_CONFLICT"; error.currentRevision = event.revision; throw error; }
  const action = payload.action; if (!["start", "pause", "reset"].includes(action)) throw new Error("Timer action must be start, pause, or reset");
  const at = now(); const remaining = timerRemaining(timer, Date.parse(at));
  if (action === "start") { timer.remainingSeconds = remaining > 0 ? remaining : timer.durationSeconds; timer.status = "running"; timer.startedAt = at; }
  if (action === "pause") { timer.remainingSeconds = remaining; timer.status = "paused"; timer.startedAt = null; }
  if (action === "reset") { const duration = payload.durationSeconds === undefined ? timer.durationSeconds : Number(payload.durationSeconds); if (!Number.isInteger(duration) || duration < 1 || duration > 600) throw new Error("Timer duration must be a whole number from 1 to 600 seconds"); timer.durationSeconds = duration; timer.remainingSeconds = duration; timer.status = "idle"; timer.startedAt = null; }
  timer.version += 1; timer.updatedAt = at; audit(event, staff, "control_shared_timer", "timer", `${scope}:${division}`, { action, timerVersion: timer.version, remainingSeconds: timer.remainingSeconds }); return timer;
}
function findEvent(store, eventId) { const event = store.events.find((candidate) => candidate.id === eventId); if (event) ensureEventShape(event); return event; }
function findRegistration(event, registrationId) { return event.registrations.find((candidate) => candidate.id === registrationId); }
function ensurePerson(event, name) {
  const nameKey = canonical(name); if (!nameKey) return null;
  let person = event.people.find((candidate) => candidate.nameKey === nameKey);
  if (!person) { person = { id: id("person"), name: name.trim(), nameKey, createdAt: now() }; event.people.push(person); }
  return person;
}
function syncMembers(event, registration) {
  const config = divisionFor(event, registration.bracket);
  const memberCount = config.teamSize;
  const names = memberCount > 1 ? splitMembers(registration.memberNames) : [registration.entryName];
  registration.members = Array.from({ length: memberCount }, (_, index) => {
    const previous = registration.members[index] || {};
    const name = names[index] || previous.name || "";
    const person = ensurePerson(event, name); const retainsLinkedPerson = previous.personId && canonical(previous.name) === canonical(name);
    return { name, personId: retainsLinkedPerson ? previous.personId : person?.id || null, instagram: registration.instagramMembers[index] ?? previous.instagram ?? "", checkedIn: Boolean(previous.checkedIn || previous.paid), arrivedAt: previous.arrivedAt || null, drinkCharged: Boolean(previous.drinkCharged) };
  });
  if (memberCount > 1 && names.length !== memberCount) {
    registration.needsReview = true;
    registration.reviewReasons = [...new Set([...(registration.reviewReasons || []), `${memberCount} member names are required for ${config.name}`])];
  }
}
function registrationTitle(registration) { return registration?.teamName || registration?.entryName || registration?.memberNames || ""; }
function registrationIsInBracket(event, registrationId, bracketName) { const bracket = event.brackets[bracketName]; return Boolean(bracket?.participantIds?.includes(registrationId) || bracket?.rounds?.some((round) => round.matches.some((match) => [match.sideA, match.sideB, match.winnerId].includes(registrationId)))); }
function duplicateIds(event, registration) {
  const signature = (item) => `${item.bracket}:${canonical(item.teamName || item.entryName)}:${item.members.map((member) => canonical(member.name)).filter(Boolean).sort().join("|")}`;
  return event.registrations.filter((item) => item.id !== registration.id && signature(item) === signature(registration)).map((item) => item.id);
}
function entryFee(event, registration) { const fees = divisionFees(event, registration.bracket); return registration.registrationSource === "same_day" ? fees.sameDayEntryFee : fees.earlyEntryFee; }
function drinkChargeKey(registration, member) { return member.personId || canonical(member.name) || `${registration.id}:${member.name}`; }
function chargedDrinkKeys(event) {
  return new Set(event.registrations
    .filter((registration) => registration.status !== "Canceled")
    .flatMap((registration) => registration.members.map((member) => ({ registration, member })))
    .filter(({ member }) => member.checkedIn)
    .map(({ registration, member }) => drinkChargeKey(registration, member)));
}
function checkInQuote(event, registration, member) {
  if (registration.status === "Canceled" || member.checkedIn) return null;
  const entryMoney = entryFee(event, registration);
  const drinkMoney = chargedDrinkKeys(event).has(drinkChargeKey(registration, member)) ? 0 : divisionFees(event, registration.bracket).drinkFee;
  return { entryMoney, drinkMoney, total: entryMoney + drinkMoney, currency: spectatorFees(event).currency };
}
function registrationReadModel(event, registration) {
  const view = clone(registration);
  view.fieldChanges = fieldChanges(event, registration);
  view.members = view.members.map((member, index) => ({ ...member, checkInQuote: checkInQuote(event, registration, registration.members[index]) }));
  return view;
}
function eventReadModel(event) {
  const view = clone(event);
  delete view.offlineReceipts;
  view.spectators.undoAuditId = latestUnreversedAudit(event, "add_spectator", event.id)?.id || null;
  view.registrations = event.registrations.map((registration) => registrationReadModel(event, registration));
  return view;
}
function undoSpectator(event, payload) {
  const original = event.auditLog.find((entry) => entry.id === payload.auditId && entry.action === "add_spectator" && entry.targetId === event.id);
  if (!original) throw new Error("Choose a recorded spectator addition to undo");
  if (event.auditLog.some((entry) => entry.details?.reversalOfAuditId === original.id)) return;
  if (latestUnreversedAudit(event, "add_spectator", event.id)?.id !== original.id) {
    const error = new Error("Another spectator was added. Refresh and review the latest addition before undoing");
    error.statusCode = 409; error.code = "REVISION_CONFLICT"; error.currentRevision = event.revision; throw error;
  }
  const entryMoney = original.details.entryMoney ?? spectatorFees(event).spectatorEntryFee;
  const drinkMoney = original.details.drinkMoney ?? spectatorFees(event).spectatorDrinkFee;
  if (event.spectators.count < 1 || event.spectators.entryMoney < entryMoney || event.spectators.drinkMoney < drinkMoney) throw new Error("Spectator totals do not match the recorded addition; review the event records");
  event.spectators.count -= 1;
  event.spectators.entryMoney -= entryMoney;
  event.spectators.drinkMoney -= drinkMoney;
  audit(event, staffFrom(payload), "undo_spectator", "event", event.id, { count: 1, entryMoney, drinkMoney, reversalOfAuditId: original.id });
}
function publicDisplayModel(event, bracketName) {
  const divisionSettings = divisionFor(event, bracketName);
  return buildDisplayProjection(event, bracketName, { divisionSettings, registrationTitle, at: now });
}

// Recomputing from individual arrivals makes undo safe and charges the ¥700 drink only once per person across both brackets.
function recalculatePayments(event) {
  for (const registration of event.registrations) { registration.payment = { battlerEntry: 0, drink: 0, total: 0, paidAt: null }; for (const member of registration.members) member.drinkCharged = false; }
  const arrivals = event.registrations.filter((registration) => registration.status !== "Canceled").flatMap((registration) => registration.members.map((member) => ({ registration, member }))).filter(({ member }) => member.checkedIn).sort((a, b) => String(a.member.arrivedAt).localeCompare(String(b.member.arrivedAt)));
  const chargedDrinkFor = new Set();
  for (const { registration, member } of arrivals) {
    registration.payment.battlerEntry += entryFee(event, registration);
    const personKey = drinkChargeKey(registration, member);
    if (!chargedDrinkFor.has(personKey)) { chargedDrinkFor.add(personKey); registration.payment.drink += divisionFees(event, registration.bracket).drinkFee; member.drinkCharged = true; }
    registration.payment.paidAt ||= member.arrivedAt || now();
  }
  for (const registration of event.registrations) {
    registration.payment.total = registration.payment.battlerEntry + registration.payment.drink;
    if (registration.status === "Canceled") continue;
    const checked = registration.members.filter((member) => member.checkedIn).length;
    registration.status = checked === 0 ? "Registered" : (checked < divisionFor(event, registration.bracket).teamSize ? "Partial" : "Checked in");
  }
}
function createRegistration(event, input, source) {
  const fields = normalizeRegistrationFields(input, { requireBracket: true });
  const config = divisionFor(event, fields.bracket);
  const currentRegistrations = event.registrations.filter((registration) => registration.bracket === fields.bracket && registration.status !== "Canceled");
  if (config.registrationLimit !== null && currentRegistrations.length >= config.registrationLimit) throw new Error(`${config.name} has reached its registration limit`);
  if (source === "same_day") {
    const numbers = event.registrations.filter((item) => item.bracket === fields.bracket).map((item) => Number(item.sourceNumber)).filter((value) => Number.isSafeInteger(value) && value > 0);
    fields.sourceNumber = String(Math.max(0, ...numbers) + 1);
  }
  const registration = { id: id("reg"), displayCode: nextDisplayCode(event), eventId: event.id, bracket: fields.bracket, registrationSource: source, sourceNumber: fields.sourceNumber || "", teamName: fields.teamName || "", memberNames: fields.memberNames || "", entryName: fields.entryName || "", dob: fields.dob || "", parentName: fields.parentName || "", genre: fields.genre || "", region: fields.region || "", email: fields.email || "", phone: fields.phone || "", instagramTeam: fields.instagramTeam || "", instagramMembers: fields.instagramMembers || [], status: "Registered", competitionState: "registered", needsReview: fields.needsReview || false, reviewReasons: fields.reviewReasons || [], members: [], payment: { battlerEntry: 0, drink: 0, total: 0, paidAt: null }, notes: fields.notes || "", duplicateIgnored: false, prelimOrder: null, prelimRank: null, rankOverride: null, scores: { judge1: null, judge2: null, judgeScores: [], average: null }, createdAt: now(), updatedAt: now() };
  syncMembers(event, registration);
  if (!registration.teamName && !registration.entryName) { registration.needsReview = true; registration.reviewReasons = [...new Set([...registration.reviewReasons, "team or entry name is required"])]; }
  event.registrations.push(registration); registration.duplicateOf = duplicateIds(event, registration); return registration;
}
function resolveDuplicate(event, registration, payload) {
  const staff = staffFrom(payload);
  if (!registration.duplicateOf?.length) throw new Error("This registration has no duplicate warning");
  if (payload.action === "ignore") {
    registration.duplicateIgnored = true;
    registration.updatedAt = now();
    audit(event, staff, "ignore_duplicate_warning", "registration", registration.id, { duplicateOf: registration.duplicateOf });
    return { deleted: false, registration };
  }
  if (payload.action !== "delete") throw new Error("Duplicate action must be ignore or delete");
  if (registration.members.some((member) => member.checkedIn)) throw new Error("Checked-in duplicates cannot be removed; undo check-in or cancel the record instead");
  const isInBracket = Object.values(event.brackets).some((bracket) => bracket.rounds?.some((round) => round.matches.some((match) => [match.sideA, match.sideB, match.winnerId].includes(registration.id))));
  if (isInBracket) throw new Error("Bracket participants cannot be removed");
  event.registrations = event.registrations.filter((item) => item.id !== registration.id);
  recalculatePayments(event);
  audit(event, staff, "remove_duplicate_registration", "registration", registration.id, { duplicateOf: registration.duplicateOf });
  return { deleted: true, registrationId: registration.id };
}
function checkIn(event, registration, payload) {
  const staff = staffFrom(payload); if (registration.status === "Canceled") throw new Error("Canceled registrations cannot be checked in");
  if (event.brackets[registration.bracket] && !registrationIsInBracket(event, registration.id, registration.bracket)) throw new Error("This bracket has already been generated; this late entry cannot be added to competition");
  const memberIndex = divisionFor(event, registration.bracket).teamSize > 1 ? Number(payload.memberIndex) : 0;
  if (!Number.isInteger(memberIndex) || !registration.members[memberIndex]) throw new Error("A valid memberIndex is required");
  const member = registration.members[memberIndex]; if (member.checkedIn) return { alreadyCheckedIn: true, registration };
  member.checkedIn = true; member.arrivedAt = now(); recalculatePayments(event); if (registration.status === "Checked in") transitionCompetitionState(registration, "checked_in"); registration.updatedAt = now(); audit(event, staff, "check_in", "registration", registration.id, { memberIndex, status: registration.status, competitionState: registration.competitionState, total: registration.payment.total }); return { alreadyCheckedIn: false, registration };
}
function undoCheckIn(event, registration, payload) {
  const staff = staffFrom(payload); const memberIndex = divisionFor(event, registration.bracket).teamSize > 1 ? Number(payload.memberIndex) : 0;
  if (!Number.isInteger(memberIndex) || !registration.members[memberIndex]) throw new Error("A valid memberIndex is required");
  const member = registration.members[memberIndex]; if (!member.checkedIn) throw new Error("This member is not checked in");
  const reversedAudit = latestUnreversedAudit(event, "check_in", registration.id, (entry) => Number(entry.details?.memberIndex) === memberIndex);
  member.checkedIn = false; member.arrivedAt = null; recalculatePayments(event); if (registration.status !== "Checked in") registration.competitionState = "registered"; registration.updatedAt = now(); audit(event, staff, "undo_check_in", "registration", registration.id, { memberIndex, status: registration.status, competitionState: registration.competitionState, reversalOfAuditId: reversedAudit?.id || null }); return registration;
}
function generatePrelimOrder(event, bracket, staff) {
  const config = divisionFor(event, bracket);
  if (!config.prelims.enabled) throw new Error(`Prelims are not enabled for ${config.name}`);
  if (event.brackets[bracket]) throw new Error("A bracket already exists; the prelim order can no longer be changed");
  if (event.prelimOrders[bracket]?.lockedAt) throw new Error("The prelim order is locked. Fully checked-in late arrivals are appended to the end automatically");
  const eligible = prelimEligible(event, bracket); if (!shouldRunPrelims(eligible.length, config.prelims)) throw new Error(`Prelims are only required above ${config.prelims.entryThreshold} checked-in entries`);
  const registrationIndex = new Map(event.registrations.map((registration, index) => [registration.id, index]));
  const order = eligible.slice().sort((left, right) => {
    const compare = (registration) => {
      const imported = registration.registrationSource === "early";
      const sourceNumber = Number(registration.sourceNumber);
      return [imported ? 0 : 1, imported && Number.isFinite(sourceNumber) && sourceNumber > 0 ? sourceNumber : Number.MAX_SAFE_INTEGER, registrationIndex.get(registration.id) ?? Number.MAX_SAFE_INTEGER];
    };
    const leftKey = compare(left); const rightKey = compare(right);
    return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || leftKey[2] - rightKey[2];
  });
  event.prelimOrders[bracket] = { lockedAt: now(), registrationIds: order.map((registration) => registration.id), currentEntryIndex: 0 };
  const timer = eventTimer(event, "prelims", bracket);
  Object.assign(timer, { version: timer.version + 1, durationSeconds: config.prelims.secondsPerSide, remainingSeconds: config.prelims.secondsPerSide, status: "idle", startedAt: null, updatedAt: now() });
  order.forEach((registration, index) => { registration.prelimOrder = index + 1; transitionCompetitionState(registration, "prelim_assigned"); });
  if (order[0]) transitionCompetitionState(order[0], "performing");
  audit(event, staff, "generate_prelim_order", "bracket", bracket, { count: order.length, ordering: "imported_then_walk_in" });
  return order;
}
function appendLate(event, registration, staff) { const order = event.prelimOrders[registration.bracket]; if (!order?.lockedAt || event.brackets[registration.bracket] || registration.status !== "Checked in" || order.registrationIds.includes(registration.id)) return; order.registrationIds.push(registration.id); registration.prelimOrder = order.registrationIds.length; transitionCompetitionState(registration, "prelim_assigned"); audit(event, staff, "append_late_arrival", "registration", registration.id, { prelimOrder: registration.prelimOrder }); }
function prelimEligible(event, bracket) { return event.registrations.filter((registration) => registration.bracket === bracket && registration.status === "Checked in"); }
function advancePrelim(event, division, payload) {
  const order = event.prelimOrders[division];
  if (!order?.lockedAt || !order.registrationIds.length) throw new Error("Lock the prelim order first");
  if (event.brackets[division]) throw new Error("The tournament bracket has already started");
  if (!["next", "previous"].includes(payload.action)) throw new Error("Choose next or previous");
  const index = order.currentEntryIndex || 0;
  const timer = eventTimer(event, "prelims", division);
  if (payload.action === "next" && timer.status === "running" && timerRemaining(timer) > 0) throw new Error("Pause the timer before finishing a side early");
  if (payload.action === "next" && index >= order.registrationIds.length) throw new Error("All prelim performances are complete");
  if (payload.action === "previous" && index === 0) throw new Error("Already at the first performance");
  const current = findRegistration(event, order.registrationIds[index]);
  if (current && current.competitionState === "performing") transitionCompetitionState(current, "prelim_assigned");
  order.currentEntryIndex = payload.action === "next" ? index + 1 : index - 1;
  const next = findRegistration(event, order.registrationIds[order.currentEntryIndex]);
  if (next && next.competitionState === "prelim_assigned") transitionCompetitionState(next, "performing");
  const duration = divisionFor(event, division).prelims.secondsPerSide;
  Object.assign(timer, { version: timer.version + 1, durationSeconds: duration, remainingSeconds: duration, status: "idle", startedAt: null, updatedAt: now() });
  audit(event, staffFrom(payload), "advance_prelim", "bracket", division, { action: payload.action, currentEntryIndex: order.currentEntryIndex });
  return order;
}
function activePrelimRegistration(event, division) {
  const order = event.prelimOrders[division];
  if (!order?.lockedAt || !order.registrationIds.length) return null;
  const index = order.currentEntryIndex || 0;
  if (index >= order.registrationIds.length) return null;
  return findRegistration(event, order.registrationIds[index]) || null;
}
function judgeSession(event, division, staff) {
  const settings = divisionFor(event, division);
  const assignment = assignmentForStaff(event, settings, staff);
  const current = activePrelimRegistration(event, division);
  const nextId = event.prelimOrders[division]?.registrationIds[(event.prelimOrders[division]?.currentEntryIndex || 0) + 1];
  const onDeck = nextId ? findRegistration(event, nextId) : null;
  return {
    event: { id: event.id, name: event.name, mode: event.mode },
    division: { id: settings.id, name: settings.name, scoreMinimum: settings.prelims.scoreMinimum, scoreMaximum: settings.prelims.scoreMaximum, secondsPerSide: settings.prelims.secondsPerSide },
    judge: { judgeNumber: assignment.judgeNumber, judgeName: assignment.judgeName, assignedStaffName: assignment.staffName },
    current: current ? { id: current.id, title: registrationTitle(current), members: current.memberNames || "", style: current.genre || "", number: current.sourceNumber || current.displayCode, prelimOrder: current.prelimOrder, updatedAt: current.updatedAt, score: publicScoreRecord(scoreRecords(event, current, settings).find((item) => item.assignment.id === assignment.id).record) } : null,
    onDeck: onDeck ? { title: registrationTitle(onDeck), number: onDeck.sourceNumber || onDeck.displayCode, prelimOrder: onDeck.prelimOrder } : null,
  };
}
function saveJudgeScore(event, division, payload, staff) {
  const settings = divisionFor(event, division);
  if (event.brackets[division]) throw new Error("Scores cannot change after the bracket is generated");
  const assignment = assignmentForStaff(event, settings, staff);
  const current = activePrelimRegistration(event, division);
  if (!current) throw new Error("There is no active prelim entry to score");
  if (payload.registrationId !== current.id) {
    const error = new Error("The active prelim entry changed. Refresh before submitting a score"); error.statusCode = 409; error.code = "CURRENT_BATTLE_CHANGED"; throw error;
  }
  requireRegistrationVersion(payload, current, event);
  const score = normalizeScore(payload.score, settings.prelims);
  const state = payload.state === "submitted" ? "submitted" : payload.state === "draft" ? "draft" : null;
  if (!state) throw new Error("Score state must be draft or submitted");
  const record = scoreRecords(event, current, settings).find((item) => item.assignment.id === assignment.id).record;
  if (["locked", "corrected"].includes(record.state)) {
    const error = new Error("This score is locked. Ask an Event lead for a documented correction"); error.statusCode = 409; error.code = "SCORE_LOCKED"; throw error;
  }
  if (record.state === "submitted") {
    const error = new Error("This score was already submitted and is waiting to lock"); error.statusCode = 409; error.code = "SCORE_SUBMITTED"; throw error;
  }
  const at = now();
  record.score = score;
  record.draftedAt ||= at;
  record.state = state;
  if (state === "submitted") record.submittedAt = at;
  current.updatedAt = at;
  audit(event, staff, state === "submitted" ? "submit_judge_score" : "save_judge_score_draft", "registration", current.id, { division, judgeNumber: assignment.judgeNumber, scoreState: state });
  const lock = lockWhenReady(event, current, settings, at, scoreAverage);
  if (lock.locked) audit(event, staff, "lock_judge_scores", "registration", current.id, { division, judgeNumbers: lock.records.map(({ assignment: item }) => item.judgeNumber) });
  if (current.scores.average !== null && ["prelim_assigned", "performing"].includes(current.competitionState)) transitionCompetitionState(current, "scored");
  return { registration: registrationReadModel(event, current), score: publicScoreRecord(record), locked: lock.locked };
}
function correctJudgeScore(event, division, payload, staff) {
  assertEventLead(staff);
  const settings = divisionFor(event, division);
  if (event.brackets[division]) throw new Error("Scores cannot change after the bracket is generated");
  const registration = findRegistration(event, payload.registrationId);
  if (!registration || registration.bracket !== division) throw new Error("registrationId must refer to an entry in this division");
  requireRegistrationVersion(payload, registration, event);
  if (!Number.isInteger(payload.judgeNumber) || payload.judgeNumber < 1 || payload.judgeNumber > settings.prelims.judgeCount) throw new Error(`judgeNumber must be from 1 to ${settings.prelims.judgeCount}`);
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (!reason || reason.length > 300) throw new Error("A correction reason of 1 to 300 characters is required");
  const score = normalizeScore(payload.score, settings.prelims);
  const record = scoreRecords(event, registration, settings).find((item) => item.assignment.judgeNumber === payload.judgeNumber).record;
  if (!["locked", "corrected"].includes(record.state)) throw new Error("Only a locked score can be corrected");
  const at = now();
  const previousScore = record.score;
  record.score = score;
  record.state = "corrected";
  record.correctedAt = at;
  record.correctionReason = reason;
  record.correctedBy = { name: staff.name, role: staff.role };
  applyLockedScores(registration, scoreRecords(event, registration, settings), scoreAverage);
  registration.prelimRank = null;
  registration.rankOverride = null;
  delete event.prelimTieBreaks[division];
  if (["qualified", "eliminated"].includes(registration.competitionState)) transitionCompetitionState(registration, "scored");
  registration.updatedAt = at;
  audit(event, staff, "correct_locked_judge_score", "registration", registration.id, { division, judgeNumber: payload.judgeNumber, previousScore, score, reason });
  return { registration: registrationReadModel(event, registration), score: publicScoreRecord(record) };
}
function scoreAverage(registration, judgeCount = 2) { return prelimScoreAverage(registration, judgeCount); }
function sameIds(left, right) { return left.length === right.length && left.every((id) => right.includes(id)); }
function tieBreakForGroup(event, bracket, group) {
  const tieBreak = event.prelimTieBreaks?.[bracket];
  return tieBreak && sameIds(tieBreak.registrationIds || [], group.map((registration) => registration.id)) ? tieBreak : null;
}
function rankPrelims(event, bracket, staff) {
  if (!event.prelimOrders[bracket]?.lockedAt) throw new Error("Generate and lock the prelim order before ranking entries");
  const config = divisionFor(event, bracket); const eligible = prelimEligible(event, bracket); for (const registration of eligible) { registration.scores.average = scoreAverage(registration, config.prelims.judgeCount); registration.prelimRank = null; }
  const ranked = rankEntries(eligible, { judgeCount: config.prelims.judgeCount, tieBreakRule: config.prelims.tieBreakRule, savedTieBreak: event.prelimTieBreaks?.[bracket] });
  for (const registration of ranked.filter((item) => item.rankOverride).sort((left, right) => left.rankOverride.rank - right.rankOverride.rank)) { const oldIndex = ranked.findIndex((item) => item.id === registration.id); ranked.splice(oldIndex, 1); ranked.splice(Math.min(registration.rankOverride.rank - 1, ranked.length), 0, registration); }
  ranked.forEach((registration, index) => { registration.prelimRank = index + 1; if (registration.competitionState !== "scored") transitionCompetitionState(registration, "scored"); transitionCompetitionState(registration, index < cutoffFor(event, bracket) ? "qualified" : "eliminated"); });
  audit(event, staff, "rank_prelims", "bracket", bracket, { count: ranked.length }); return ranked.sort((a, b) => a.prelimRank - b.prelimRank);
}
function cutoffTieGroup(event, bracket, ranked, cutoff) {
  return prelimCutoffTie(ranked, cutoff, divisionFor(event, bracket).prelims.judgeCount);
}
function qualifiedPrelimParticipants(event, bracket, cutoff) {
  if (!event.prelimOrders[bracket]?.lockedAt) throw new Error("Generate and lock the prelim order before creating the bracket");
  const judgeCount = divisionFor(event, bracket).prelims.judgeCount; const eligible = prelimEligible(event, bracket); const unscored = eligible.filter((registration) => !hasCompleteScores(registration, judgeCount));
  if (unscored.length) throw new Error(`All ${eligible.length} checked-in ${bracket} prelim entrants need ${judgeCount} score${judgeCount === 1 ? "" : "s"} before qualification`);
  const ranked = eligible.slice().sort((left, right) => left.prelimRank - right.prelimRank);
  if (ranked.some((registration, index) => registration.prelimRank !== index + 1)) throw new Error("Generate complete prelim rankings before creating the bracket");
  const tieGroup = cutoffTieGroup(event, bracket, ranked, cutoff);
  if (tieGroup.length && divisionFor(event, bracket).prelims.tieBreakRule === "manual_order" && !tieBreakForGroup(event, bracket, tieGroup)) throw new Error(`The tie at the top ${cutoff} cutoff must be resolved by a manual tie-break before creating the bracket`);
  return ranked.slice(0, cutoff).map((registration) => registration.id);
}
function qualifierHandoff(event, bracket) {
  const cutoff = cutoffFor(event, bracket);
  const existing = event.brackets[bracket];
  let ids;
  if (existing) {
    ids = existing.participantIds;
    if (ids.length > cutoff) throw new Error("The existing bracket exceeds the new cutoff. Review it before handing off; it has not been changed");
  } else {
    const order = event.prelimOrders[bracket];
    if (order?.lockedAt) {
      if ((order.currentEntryIndex || 0) < order.registrationIds.length) throw new Error("Finish every prelim performance before handing off");
      const snapshot = clone(event);
      rankPrelims(snapshot, bracket, { name: "Handoff validation", role: "System" });
      ids = qualifiedPrelimParticipants(snapshot, bracket, cutoff);
    } else {
      const eligible = prelimEligible(event, bracket);
      if (eligible.length > cutoff) throw new Error("Run prelims and enter both judge scores before handing off");
      ids = eligible.slice().sort((a, b) => Number(a.sourceNumber) - Number(b.sourceNumber)).map((entry) => entry.id);
    }
  }
  if (ids.length < 2) throw new Error("At least two checked-in entries are required for a handoff");
  return { division: bracket, cutoff, revision: event.revision, entries: ids.map((id, index) => {
    const entry = findRegistration(event, id);
    return { seed: index + 1, number: entry.sourceNumber || "", name: registrationTitle(entry), average: scoreAverage(entry) };
  }) };
}
function recordPrelimTieBreak(event, payload) {
  const staff = staffFrom(payload); const cutoff = cutoffFor(event, payload.bracket);
  const config = divisionFor(event, payload.bracket);
  if (!config.prelims.enabled || !Array.isArray(payload.registrationIds)) throw new Error("Prelims and ordered registrationIds are required");
  if (config.prelims.tieBreakRule !== "manual_order") throw new Error("This division resolves prelim ties by prelim order; no manual tie-break is needed");
  if (event.brackets[payload.bracket]) throw new Error("Qualification tie-breaks cannot change after the bracket is generated");
  const eligible = prelimEligible(event, payload.bracket); if (eligible.some((registration) => !hasCompleteScores(registration, config.prelims.judgeCount))) throw new Error(`All checked-in prelim entrants need ${config.prelims.judgeCount} scores before resolving a tie`);
  const ranked = eligible.slice().sort((left, right) => left.prelimRank - right.prelimRank); if (ranked.some((registration, index) => registration.prelimRank !== index + 1)) throw new Error("Generate prelim rankings before resolving a tie");
  const tieGroup = cutoffTieGroup(event, payload.bracket, ranked, cutoff); if (!tieGroup.length) throw new Error("There is no unresolved qualification-cutoff tie for this bracket");
  if (new Set(payload.registrationIds).size !== payload.registrationIds.length || !sameIds(payload.registrationIds, tieGroup.map((registration) => registration.id))) throw new Error("registrationIds must contain every tied cutoff entrant exactly once, ordered from winner to loser");
  event.prelimTieBreaks[payload.bracket] = { registrationIds: payload.registrationIds, at: now(), staffName: staff.name, staffRole: staff.role };
  const rankings = rankPrelims(event, payload.bracket, staff); audit(event, staff, "record_prelim_tiebreak", "bracket", payload.bracket, { registrationIds: payload.registrationIds }); return { rankings, tieBreak: event.prelimTieBreaks[payload.bracket] };
}
function makeRounds(pairs, format) {
  const newMatch = (sideA, sideB, roundName, matchNumber) => ({ id: id("match"), matchNumber, roundName, sideA, sideB, judgeVotes: [], winnerId: null, decisionMethod: null, completedAt: null, requiredPerformanceRounds: roundName === "Final" ? format.final.performanceRounds : format.regular.performanceRounds, performanceRoundsCompleted: 0, performanceRoundCompletedAt: [], tieBreakCount: 0, tieBreakActive: false, tieBreakHistory: [] });
  const firstRoundName = pairs.length === 1 ? "Final" : "Round 1";
  const rounds = [{ name: firstRoundName, matches: pairs.map(([sideA, sideB], index) => newMatch(sideA, sideB, firstRoundName, index + 1)) }];
  let count = pairs.length / 2; let roundNumber = 2; while (count >= 1) { const roundName = count === 1 ? "Final" : `Round ${roundNumber}`; rounds.push({ name: roundName, matches: Array.from({ length: count }, (_, index) => newMatch(null, null, roundName, index + 1)) }); count /= 2; roundNumber += 1; }
  return rounds;
}
function advanceWinner(bracket, roundIndex, matchIndex, winnerId) { const nextRound = bracket.rounds[roundIndex + 1]; if (!nextRound) return; const nextMatch = nextRound.matches[Math.floor(matchIndex / 2)]; if (matchIndex % 2 === 0) nextMatch.sideA = winnerId; else nextMatch.sideB = winnerId; }
function sourceMatchForSlot(bracket, roundIndex, matchIndex, side) { return roundIndex === 0 ? null : bracket.rounds[roundIndex - 1]?.matches[(matchIndex * 2) + (side === "A" ? 0 : 1)]; }
function slotCannotReceiveWinner(bracket, roundIndex, matchIndex, side) { if (roundIndex === 0) return true; const source = sourceMatchForSlot(bracket, roundIndex, matchIndex, side); return Boolean(source) && !source.sideA && !source.sideB; }
function isTrueBye(bracket, roundIndex, matchIndex, match) { if (!match.sideA || !match.sideB) { if (!match.sideA && !match.sideB) return false; return match.sideA ? slotCannotReceiveWinner(bracket, roundIndex, matchIndex, "B") : slotCannotReceiveWinner(bracket, roundIndex, matchIndex, "A"); } return false; }
function autoAdvanceByes(bracket) { let advanced = true; while (advanced) { advanced = false; for (let roundIndex = 0; roundIndex < bracket.rounds.length - 1; roundIndex += 1) for (let matchIndex = 0; matchIndex < bracket.rounds[roundIndex].matches.length; matchIndex += 1) { const match = bracket.rounds[roundIndex].matches[matchIndex]; if (match.winnerId || !isTrueBye(bracket, roundIndex, matchIndex, match)) continue; match.winnerId = match.sideA || match.sideB; match.decisionMethod = "bye"; match.performanceRoundsCompleted = match.requiredPerformanceRounds; advanceWinner(bracket, roundIndex, matchIndex, match.winnerId); advanced = true; } } }
function bracketCandidates(event, bracketName) {
  const config = divisionFor(event, bracketName);
  const eligible = prelimEligible(event, bracketName);
  const needsPrelim = Boolean(event.prelimOrders[bracketName]?.lockedAt) || shouldRunPrelims(eligible.length, config.prelims);
  if (needsPrelim) return qualifiedPrelimParticipants(event, bracketName, cutoffFor(event, bracketName));
  return eligible.slice().sort((left, right) => Number(left.sourceNumber) - Number(right.sourceNumber) || String(left.createdAt).localeCompare(String(right.createdAt))).map((registration) => registration.id);
}
function saveBracketSeeds(event, payload) {
  const bracketName = division(payload.bracket); const staff = staffFrom(payload);
  if (event.brackets[bracketName]) throw new Error("Seeds cannot change after the bracket is generated");
  if (!Array.isArray(payload.registrationIds) || !payload.registrationIds.every((entry) => typeof entry === "string" && entry.trim())) throw new Error("registrationIds must be an ordered list of entry ids");
  if (new Set(payload.registrationIds).size !== payload.registrationIds.length) throw new Error("Each entry can only be seeded once");
  const candidates = bracketCandidates(event, bracketName);
  if (!sameParticipantIds(payload.registrationIds, candidates)) throw new Error("Manual seeds must contain every qualifying entry exactly once");
  event.bracketSeeds[bracketName] = { registrationIds: payload.registrationIds, at: now(), staffName: staff.name, staffRole: staff.role };
  for (const registrationId of payload.registrationIds) { const registration = findRegistration(event, registrationId); if (registration?.competitionState === "checked_in" || registration?.competitionState === "qualified") transitionCompetitionState(registration, "seeded"); }
  audit(event, staff, "save_bracket_seeds", "bracket", bracketName, { registrationIds: payload.registrationIds });
  return event.bracketSeeds[bracketName];
}
function createBracket(event, bracketName, staff, replace = false) {
  const config = divisionFor(event, bracketName);
  if (!config.bracket.enabled || ensureEventConfiguration(event).competitionFormat !== "head_to_head") throw new Error(`The bracket engine is not enabled for ${config.name}`);
  const existing = event.brackets[bracketName];
  if (existing) {
    const hasActivity = existing.rounds.some((round) => round.matches.some((match) => (match.winnerId && match.decisionMethod !== "bye") || (match.performanceRoundsCompleted > 0 && match.decisionMethod !== "bye") || match.tieBreakHistory?.length));
    if (!replace) throw new Error("A bracket already exists. Use the explicit replace action before any bracket activity is recorded");
    if (hasActivity) throw new Error("A bracket with recorded activity cannot be replaced. Undo the activity instead");
  }
  const eligible = event.registrations.filter((registration) => registration.bracket === bracketName && registration.status === "Checked in"); const needsPrelim = Boolean(event.prelimOrders[bracketName]?.lockedAt) || shouldRunPrelims(eligible.length, config.prelims);
  let participants = bracketCandidates(event, bracketName);
  const manualSeeds = event.bracketSeeds?.[bracketName]?.registrationIds;
  if (manualSeeds) { if (!sameParticipantIds(manualSeeds, participants)) throw new Error("Saved manual seeds no longer match the qualifying entries"); participants = manualSeeds; }
  if (participants.length < 2) throw new Error("At least two checked-in entries are required to create a bracket");
  const bracketSlotSize = needsPrelim ? config.bracket.size : nextPowerOfTwo(participants.length);
  const format = formatFor(event, bracketName); const bracket = { id: id("bracket"), division: bracketName, createdAt: now(), source: needsPrelim ? "prelim_seeded" : "seeded_direct", participantIds: participants, format, rounds: makeRounds(configuredPairs(participants, { seeded: true, size: bracketSlotSize }), format) };
  for (const participantId of participants) { const registration = findRegistration(event, participantId); if (!registration) continue; if (registration.competitionState === "checked_in") transitionCompetitionState(registration, "seeded"); else if (registration.competitionState === "qualified") transitionCompetitionState(registration, "seeded"); transitionCompetitionState(registration, "bracketed"); }
  autoAdvanceByes(bracket); event.brackets[bracketName] = bracket; audit(event, staff, existing ? "replace_bracket" : "create_bracket", "bracket", bracketName, { participants: participants.length, source: bracket.source }); return bracket;
}
function locateMatch(bracket, matchId) { for (let roundIndex = 0; roundIndex < bracket.rounds.length; roundIndex += 1) { const matchIndex = bracket.rounds[roundIndex].matches.findIndex((match) => match.id === matchId); if (matchIndex >= 0) return { roundIndex, matchIndex, match: bracket.rounds[roundIndex].matches[matchIndex] }; } return null; }
function completePerformanceRound(event, bracketName, matchId, payload) {
  const staff = staffFrom(payload); const bracket = event.brackets[bracketName]; const located = bracket && locateMatch(bracket, matchId); if (!located) throw new Error("Match not found"); const { match } = located;
  if (match.winnerId || !match.sideA || !match.sideB) throw new Error("Both sides must be present in an undecided match");
  if (match.performanceRoundsCompleted >= match.requiredPerformanceRounds) throw new Error("All required performance rounds are already complete");
  match.performanceRoundsCompleted += 1; match.performanceRoundCompletedAt.push(now()); audit(event, staff, "complete_performance_round", "match", match.id, { bracket: bracketName, completed: match.performanceRoundsCompleted, required: match.requiredPerformanceRounds }); return match;
}
function recordTieReplay(event, bracketName, matchId, payload) {
  const staff = staffFrom(payload); const bracket = event.brackets[bracketName]; const located = bracket && locateMatch(bracket, matchId); if (!located) throw new Error("Match not found"); const { match } = located;
  if (match.winnerId || !match.sideA || !match.sideB) throw new Error("Both sides must be present in an undecided match");
  if (match.performanceRoundsCompleted < match.requiredPerformanceRounds) throw new Error(`Complete all ${match.requiredPerformanceRounds} performance round${match.requiredPerformanceRounds === 1 ? "" : "s"} before recording a tie`);
  match.tieBreakHistory ||= [];
  match.tieBreakHistory.push({ at: now(), staffName: staff.name, staffRole: staff.role, previousRequiredPerformanceRounds: match.requiredPerformanceRounds, previousPerformanceRoundsCompleted: match.performanceRoundsCompleted, previousPerformanceRoundCompletedAt: match.performanceRoundCompletedAt });
  match.tieBreakCount = match.tieBreakHistory.length; match.tieBreakActive = true; match.requiredPerformanceRounds = 1; match.performanceRoundsCompleted = 0; match.performanceRoundCompletedAt = []; match.judgeVotes = []; match.winnerId = null; match.decisionMethod = null; match.completedAt = null;
  audit(event, staff, "record_bracket_tie_replay", "match", match.id, { bracket: bracketName, tieBreakCount: match.tieBreakCount }); return match;
}
function decideMatch(event, bracketName, matchId, payload) {
  const staff = staffFrom(payload); const bracket = event.brackets[bracketName]; const located = bracket && locateMatch(bracket, matchId); if (!located) throw new Error("Match not found"); const { match, roundIndex, matchIndex } = located;
  if (match.winnerId) throw new Error("This match is already decided. Undo the decision before changing it"); if (!match.sideA || !match.sideB) throw new Error("Both sides must be present before a decision can be recorded"); if (match.performanceRoundsCompleted < match.requiredPerformanceRounds) throw new Error(`Complete all ${match.requiredPerformanceRounds} performance round${match.requiredPerformanceRounds === 1 ? "" : "s"} before recording a decision`); if (![match.sideA, match.sideB].includes(payload.winnerId)) throw new Error("winnerId must be one of the match sides"); if (!["operator_choice", "normal_vote", "rematch", "judge_agreement"].includes(payload.decisionMethod)) throw new Error("Invalid decisionMethod");
  const votes = Array.isArray(payload.judgeVotes) ? payload.judgeVotes : [];
  const judgeCount = divisionFor(event, bracketName).prelims.judgeCount;
  if (payload.decisionMethod === "normal_vote" && (votes.length !== judgeCount || votes.some((vote) => vote.winnerId !== payload.winnerId))) throw new Error(`A normal ${judgeCount}-judge decision requires every judge to select the same side`);
  match.judgeVotes = payload.decisionMethod === "operator_choice" ? [] : votes; match.winnerId = payload.winnerId; match.decisionMethod = match.tieBreakActive ? "tie_break_operator_choice" : payload.decisionMethod; match.completedAt = now(); match.tieBreakActive = false; const loserId = match.sideA === match.winnerId ? match.sideB : match.sideA; const winner = findRegistration(event, match.winnerId); const loser = findRegistration(event, loserId); if (loser?.competitionState === "bracketed") transitionCompetitionState(loser, "completed"); if (winner && roundIndex === bracket.rounds.length - 1 && winner.competitionState === "bracketed") transitionCompetitionState(winner, "completed"); advanceWinner(bracket, roundIndex, matchIndex, match.winnerId); autoAdvanceByes(bracket); audit(event, staff, "decide_bracket_match", "match", match.id, { bracket: bracketName, winnerId: match.winnerId, decisionMethod: match.decisionMethod, tieBreakCount: match.tieBreakCount || 0 }); return match;
}
function clearDependentSlot(bracket, roundIndex, matchIndex) {
  const nextRound = bracket.rounds[roundIndex + 1]; if (!nextRound) return;
  const nextMatchIndex = Math.floor(matchIndex / 2); const next = nextRound.matches[nextMatchIndex]; if (matchIndex % 2 === 0) next.sideA = null; else next.sideB = null;
  next.requiredPerformanceRounds = next.roundName === "Final" ? bracket.format.final.performanceRounds : bracket.format.regular.performanceRounds; next.performanceRoundsCompleted = 0; next.performanceRoundCompletedAt = []; next.tieBreakCount = 0; next.tieBreakActive = false; next.tieBreakHistory = [];
  if (next.winnerId) { next.judgeVotes = []; next.winnerId = null; next.decisionMethod = null; next.completedAt = null; clearDependentSlot(bracket, roundIndex + 1, nextMatchIndex); }
}
function undoDecision(event, bracketName, matchId, payload) {
  const staff = staffFrom(payload); const bracket = event.brackets[bracketName]; const located = bracket && locateMatch(bracket, matchId); if (!located) throw new Error("Match not found"); const { match, roundIndex, matchIndex } = located;
  if (match.tieBreakActive && !match.winnerId && match.tieBreakHistory?.length) { const reversedAudit = latestUnreversedAudit(event, "record_bracket_tie_replay", match.id); const replay = match.tieBreakHistory.pop(); match.tieBreakCount = match.tieBreakHistory.length; match.tieBreakActive = Boolean(match.tieBreakHistory.length); match.requiredPerformanceRounds = replay.previousRequiredPerformanceRounds; match.performanceRoundsCompleted = replay.previousPerformanceRoundsCompleted; match.performanceRoundCompletedAt = replay.previousPerformanceRoundCompletedAt; audit(event, staff, "undo_bracket_tie_replay", "match", match.id, { bracket: bracketName, tieBreakCount: match.tieBreakCount, reversalOfAuditId: reversedAudit?.id || null }); return match; }
  if (!match.winnerId || match.decisionMethod === "bye") throw new Error("A staff-recorded match decision is required"); const reversedAudit = latestUnreversedAudit(event, "decide_bracket_match", match.id); for (const registrationId of [match.sideA, match.sideB]) { const registration = findRegistration(event, registrationId); if (registration?.competitionState === "completed") transitionCompetitionState(registration, "bracketed"); } clearDependentSlot(bracket, roundIndex, matchIndex); match.judgeVotes = []; match.winnerId = null; match.decisionMethod = null; match.completedAt = null; autoAdvanceByes(bracket); audit(event, staff, "undo_bracket_decision", "match", match.id, { bracket: bracketName, reversalOfAuditId: reversedAudit?.id || null }); return match;
}
function reportFor(event) {
  recalculatePayments(event);
  const configuration = ensureEventConfiguration(event);
  const active = event.registrations.filter((registration) => registration.status !== "Canceled");
  const divisionSummary = (division) => {
    const registrations = active.filter((registration) => registration.bracket === division);
    const members = registrations.flatMap((registration) => registration.members);
    return {
      registrations: registrations.length,
      fullyCheckedIn: registrations.filter((registration) => registration.status === "Checked in").length,
      partial: registrations.filter((registration) => registration.status === "Partial").length,
      battlers: members.length,
      checkedInBattlers: members.filter((member) => member.checkedIn).length,
      entryMoney: registrations.reduce((total, registration) => total + money(registration.payment.battlerEntry), 0),
      drinkMoney: registrations.reduce((total, registration) => total + money(registration.payment.drink), 0)
    };
  };
  const divisionSummaries = Object.fromEntries(configuration.divisions.map((division) => [division.id, divisionSummary(division.id)]));
  // Keep these two legacy keys in the response so existing reports and exports remain readable.
  const twoVTwo = divisionSummaries["2v2"] || divisionSummary("2v2"); const under15 = divisionSummaries.under15 || divisionSummary("under15");
  const configuredSummaries = Object.values(divisionSummaries);
  const cashByDivision = Object.fromEntries(Object.entries(divisionSummaries).map(([division, summary]) => [division, { entryMoney: summary.entryMoney, drinkMoney: summary.drinkMoney, total: summary.entryMoney + summary.drinkMoney }]));
  const battlerEntryMoney = configuredSummaries.reduce((total, summary) => total + summary.entryMoney, 0);
  const drinkMoney = configuredSummaries.reduce((total, summary) => total + summary.drinkMoney, 0) + money(event.spectators.drinkMoney);
  const totalTeams = active.filter((registration) => divisionFor(event, registration.bracket).teamSize > 1).length;
  const checkedInTeams = active.filter((registration) => divisionFor(event, registration.bracket).teamSize > 1 && registration.status === "Checked in").length;
  const totalBattlers = configuredSummaries.reduce((total, summary) => total + summary.battlers, 0);
  const checkedInBattlers = configuredSummaries.reduce((total, summary) => total + summary.checkedInBattlers, 0);
  return {
    eventId: event.id, eventName: event.name, eventTime: event.eventTime, exportedAt: now(),
    divisions: { twoVTwo, under15 },
    divisionSummaries,
    cashByDivision,
    cashByCategory: {
      twoVTwo: { entryMoney: twoVTwo.entryMoney, drinkMoney: twoVTwo.drinkMoney, total: twoVTwo.entryMoney + twoVTwo.drinkMoney },
      under15: { entryMoney: under15.entryMoney, drinkMoney: under15.drinkMoney, total: under15.entryMoney + under15.drinkMoney },
      spectator: { entryMoney: money(event.spectators.entryMoney), drinkMoney: money(event.spectators.drinkMoney), total: money(event.spectators.entryMoney) + money(event.spectators.drinkMoney) }
    },
    staffAttendance: event.staffAttendance,
    totals: {
      teams: totalTeams, battlers: checkedInBattlers, totalTeams, checkedInTeams,
      totalBattlers, checkedInBattlers, spectators: event.spectators.count,
      canceled: event.registrations.filter((registration) => registration.status === "Canceled").length,
      battlerEntryMoney, spectatorEntryMoney: money(event.spectators.entryMoney), drinkMoney,
      totalCash: battlerEntryMoney + money(event.spectators.entryMoney) + drinkMoney
    }
  };
}
function csvEscape(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
const EXPORT_COPY = {
  en: {
    sections: ["SUMMARY", "REGISTRATIONS", "PRELIM RANKINGS", "BRACKET & RESULTS", "STAFF ATTENDANCE", "ACTIVITY AUDIT"],
    registrations: ["Registration ID", "Source No", "Division", "Team Name", "Member Names", "Entry Name", "Member 1 Instagram", "Member 2 Instagram", "Team Instagram", "DOB", "Parent/Guardian", "Email", "Phone", "Genre", "Region", "Status", "Source", "Member Check-in", "Arrival Times", "Entry Fee", "Drink Fee", "Total", "Needs Review", "Review Reasons", "Duplicate Warning", "Duplicate Ignored", "Notes"],
    rankings: ["Division", "Prelim Order", "Rank", "Entry", "Judge 1", "Judge 2", "Average", "Override Rank", "Override Reason"],
    bracket: ["Division", "Round", "Match", "Left", "Right", "Performance Rounds", "Winner", "Decision", "Tie Replay Count"],
    staff: ["Name", "Role", "Signed In At", "Last Active At"], audit: ["At", "Staff Name", "Staff Role", "Action", "Target Type", "Target ID", "Details"],
    financeSection: "FINANCIAL REVIEW", finance: ["Date", "Category", "Description", "Expected", "Actual", "Variance", "Payee / Payer", "Source", "Correction Of", "Correction Reason"],
    financeTotals: ["TOTAL", "Gross Revenue", "Expenses", "Staff Payouts", "Refunds", "Net Profit"],
    summary: ["Event", "Location", "Time Zone", "Event Time", "Exported At", "Total Teams", "Checked-in Teams", "Total Battlers", "Checked-in Battlers", "Spectators", "Canceled", "Entry Cash", "Spectator Entry Cash", "Drink Money", "Total Cash"],
    yes: "Yes", no: "No", checked: "Checked in", notChecked: "Not checked in", status: { Registered: "Waiting", Partial: "Partial", "Checked in": "Present", Canceled: "Canceled" }, source: { early: "Early signup", same_day: "Same-day" }, report: "report", page: "page"
  },
  ja: {
    sections: ["概要", "登録一覧", "予選ランキング", "トーナメント結果", "スタッフ出席", "操作履歴"],
    registrations: ["登録ID", "元番号", "部門", "チーム名", "メンバー名", "エントリー名", "メンバー1 Instagram", "メンバー2 Instagram", "チームInstagram", "生年月日", "保護者", "メール", "電話番号", "ジャンル", "地域", "状況", "登録区分", "メンバー受付", "到着時刻", "エントリー料金", "ドリンク料金", "合計", "確認必要", "確認理由", "重複警告", "重複確認済み", "メモ"],
    rankings: ["部門", "予選順", "順位", "エントリー", "ジャッジ1", "ジャッジ2", "平均", "修正順位", "修正理由"],
    bracket: ["部門", "ラウンド", "試合", "左", "右", "パフォーマンスラウンド", "勝者", "判定", "再戦回数"],
    staff: ["名前", "役割", "サインイン時刻", "最終操作時刻"], audit: ["時刻", "スタッフ名", "スタッフ役割", "操作", "対象種別", "対象ID", "詳細"],
    financeSection: "収支報告", finance: ["日付", "分類", "内容", "予定", "実績", "差額", "支払先・入金元", "記録元", "修正対象", "修正理由"],
    financeTotals: ["合計", "総収入", "経費", "スタッフ支払", "返金", "純利益"],
    summary: ["イベント", "会場", "タイムゾーン", "イベント時刻", "出力時刻", "チーム数", "受付済みチーム", "出場者数", "受付済み出場者", "観戦者", "キャンセル", "エントリー売上", "観戦売上", "ドリンク売上", "現金合計"],
    yes: "はい", no: "いいえ", checked: "受付済み", notChecked: "未受付", status: { Registered: "待機中", Partial: "一部受付済み", "Checked in": "受付済み", Canceled: "キャンセル" }, source: { early: "事前登録", same_day: "当日登録" }, report: "レポート", page: "ページ"
  }
};
function exportCopy(language) { return language === "ja" ? EXPORT_COPY.ja : EXPORT_COPY.en; }
function registrationsRows(event, language = "en") {
  const copy = exportCopy(language); const rows = [copy.registrations];
  for (const registration of event.registrations) rows.push([registration.displayCode, registration.sourceNumber, registration.bracket, registration.teamName, registration.memberNames, registration.entryName, registration.members[0]?.instagram || "", registration.members[1]?.instagram || "", registration.instagramTeam, registration.dob, registration.parentName, registration.email, registration.phone, registration.genre, registration.region, copy.status[registration.status] || registration.status, copy.source[registration.registrationSource] || registration.registrationSource, registration.members.map((member) => member.checkedIn ? copy.checked : copy.notChecked).join(" | "), registration.members.map((member) => member.arrivedAt || "").join(" | "), registration.payment.battlerEntry, registration.payment.drink, registration.payment.total, registration.needsReview ? copy.yes : copy.no, (registration.reviewReasons || []).join(" | "), registration.duplicateOf?.length ? copy.yes : copy.no, registration.duplicateIgnored ? copy.yes : copy.no, registration.notes]);
  return rows;
}
function rankingsRows(event, language = "en") {
  const rows = [exportCopy(language).rankings];
  for (const registration of event.registrations.filter((item) => item.prelimRank || item.prelimOrder).sort((a, b) => a.bracket.localeCompare(b.bracket) || (a.prelimRank || Number.MAX_SAFE_INTEGER) - (b.prelimRank || Number.MAX_SAFE_INTEGER))) rows.push([registration.bracket, registration.prelimOrder, registration.prelimRank, registrationTitle(registration), registration.scores.judge1, registration.scores.judge2, registration.scores.average, registration.rankOverride?.rank || "", registration.rankOverride?.reason || ""]);
  return rows;
}
function bracketRows(event, language = "en") {
  const rows = [exportCopy(language).bracket];
  for (const bracket of Object.values(event.brackets)) for (const round of bracket.rounds) for (const match of round.matches) rows.push([bracket.division, round.name, match.matchNumber, registrationTitle(findRegistration(event, match.sideA)), registrationTitle(findRegistration(event, match.sideB)), `${match.performanceRoundsCompleted}/${match.requiredPerformanceRounds}`, registrationTitle(findRegistration(event, match.winnerId)), match.decisionMethod || "", match.tieBreakCount || 0]);
  return rows;
}
function staffRows(event, language = "en") {
  const rows = [exportCopy(language).staff];
  for (const staff of event.staffAttendance || []) rows.push([staff.name, staff.role, staff.signedInAt, staff.lastActiveAt]);
  return rows;
}
function auditRows(event, language = "en") {
  const rows = [exportCopy(language).audit];
  for (const entry of event.auditLog || []) rows.push([entry.at, entry.staffName, entry.staffRole, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.details || {})]);
  return rows;
}
function financeRows(event, language = "en") {
  const copy = exportCopy(language); const report = financeReport(event, ensureEventConfiguration(event)); const rows = [copy.finance];
  for (const transaction of report.transactions) rows.push([transaction.occurredAt, transaction.category, transaction.description, transaction.expectedAmount, transaction.actualAmount, transaction.actualAmount - transaction.expectedAmount, transaction.party, transaction.source, transaction.correctionOf || "", transaction.correctionReason || ""]);
  rows.push([]);
  rows.push(copy.financeTotals);
  rows.push([report.status, report.actual.grossRevenue, report.actual.expenses, report.actual.payouts, report.actual.refunds, report.actual.netProfit]);
  rows.push([language === "ja" ? "予定" : "EXPECTED", report.expected.grossRevenue, report.expected.expenses, report.expected.payouts, report.expected.refunds, report.expected.netProfit]);
  return rows;
}
function summaryRows(event, report, language = "en") {
  return [exportCopy(language).summary, [report.eventName, event.location, event.timeZone, report.eventTime, report.exportedAt, report.totals.totalTeams, report.totals.checkedInTeams, report.totals.totalBattlers, report.totals.checkedInBattlers, report.totals.spectators, report.totals.canceled, report.totals.battlerEntryMoney, report.cashByCategory.spectator.entryMoney, report.totals.drinkMoney, report.totals.totalCash]];
}
function combinedRows(event, report, language = "en") {
  const sections = exportCopy(language).sections.map((section, index) => [section, [summaryRows, registrationsRows, rankingsRows, bracketRows, staffRows, auditRows][index](event, ...(index === 0 ? [report, language] : [language]))]);
  sections.push([exportCopy(language).financeSection, financeRows(event, language)]);
  return sections.flatMap(([section, rows]) => [[section], ...rows, []]);
}
function rowsFor(event, kind, language = "en") {
  const report = reportFor(event);
  if (kind === "registrations") return registrationsRows(event, language);
  if (kind === "rankings") return rankingsRows(event, language);
  if (kind === "bracket") return bracketRows(event, language);
  if (kind === "staff") return staffRows(event, language);
  if (kind === "finance") return financeRows(event, language);
  return combinedRows(event, report, language);
}
function csvFor(event, kind, language = "en") { return rowsFor(event, kind, language).map((row) => row.map(csvEscape).join(",")).join("\n"); }
function pdfLinesFor(event, kind, language = "en") {
  const report = reportFor(event); const label = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const rows = kind === "combined" ? combinedRows(event, report, language) : rowsFor(event, kind, language);
  return rows.map((row) => row.length === 1 ? `— ${label(row[0])} —` : row.map(label).join(" | "));
}
async function handle(req, res) {
  try {
    const originAllowed = applyResponseHeaders(req, res);
    if (req.method === "OPTIONS") { if (!originAllowed) return sendJSON(res, 403, { error: "Origin is not allowed" }); res.writeHead(204); return res.end(); }
    const route = routeParts(req.url); const method = req.method; const payload = parseJSON(["POST", "PATCH", "DELETE"].includes(method) ? await readBody(req) : ""); const store = await readStore();
    if (method === "GET" && route[0] === "api" && route[1] === "health") return sendJSON(res, 200, { ok: true, at: now() });
    if (method === "GET" && route[0] === "api" && route[1] === "auth" && route[2] === "status") return sendJSON(res, 200, { required: true });
    if (method === "POST" && route[0] === "api" && route[1] === "auth" && route[2] === "login") { requireLoginCapacity(req); if (!accessCodeMatches(payload.accessCode)) { recordFailedLogin(req); const error = new Error("Invalid staff access code"); error.statusCode = 401; throw error; } const supplied = staffFrom(payload); const staff = { name: supplied.name.trim(), role: supplied.role.trim() }; clearFailedLogins(req); return sendJSON(res, 200, { token: signSession(staff), staff }); }
    if (method === "GET" && route[0] === "api" && route[1] === "public" && route[2] === "events" && route[3] && route[4] === "display" && !route[5]) {
      const event = findEvent(store, route[3]);
      if (!event) return sendJSON(res, 404, { error: "Event not found" });
      return sendJSON(res, 200, publicDisplayModel(event, division(query(req.url).get("division") || ensureEventConfiguration(event).divisions[0].id)));
    }
    if (route[0] === "api" && !(method === "GET" && route[1] === "health") && !(route[1] === "auth" && route[2] === "status") && !(route[1] === "auth" && route[2] === "login")) { const session = authenticate(req); payload.staff = session.staff; if (method === "POST" && route[1] === "auth" && route[2] === "logout") return sendJSON(res, 200, { loggedOut: true }); }
    if (method === "GET" && route.length === 2 && route[0] === "api" && route[1] === "events") return sendJSON(res, 200, store.events.map((storedEvent) => { const { auditLog, ...event } = eventReadModel(storedEvent); return event; }));
    if (method === "POST" && route.length === 2 && route[0] === "api" && route[1] === "events") { const staff = staffFrom(payload); const fields = normalizeEventFields(payload); const createdAt = now(); const timeZone = fields.timeZone || DEFAULT_TIME_ZONE; if (!validTimeZone(timeZone)) throw new Error("A valid IANA time zone is required"); const configuration = normalizeEventConfiguration(payload.configuration, fields.judgesByDivision); const event = { id: id("event"), name: fields.name || "Untitled event", eventTime: fields.eventTime || "", prelimsStartTime: fields.prelimsStartTime || "", location: fields.location || DEFAULT_LOCATION, timeZone, mode: fields.mode || "live", judges: fields.judges || [], judgesByDivision: Object.fromEntries(configuration.divisions.map((division) => [division.id, division.judges])), configuration, nextRegistrationNumber: 1, lifecycle: { status: payload.state === undefined ? "draft" : lifecycleState(payload.state), archivedAt: null, archivedBy: null }, people: [], registrations: [], spectators: { count: 0, entryMoney: 0, drinkMoney: 0 }, prelimOrders: {}, prelimTieBreaks: {}, brackets: {}, timers: { prelims: {}, bracket: {} }, auditLog: [], staffAttendance: [], revision: 0, createdAt, updatedAt: createdAt }; ensureEventShape(event); store.events.push(event); audit(event, staff, "create_event", "event", event.id, { location: event.location, timeZone: event.timeZone, mode: event.mode, state: event.lifecycle.status, divisions: configuration.divisions.map((division) => division.id) }); await commitEvent(store, event, res, { create: true }); return sendJSON(res, 201, event); }
    if (route[0] !== "api" || route[1] !== "events" || !route[2]) return sendJSON(res, 404, { error: "Route not found" });
    const event = findEvent(store, route[2]); if (!event) return sendJSON(res, 404, { error: "Event not found" }); setEventRevisionHeader(res, event);
    if (method === "POST" && route[3] === "offline-actions" && route.length === 4) return sendJSON(res, 200, await syncOfflineAction(event.id, payload.command, staffFrom(payload), res));
    if (["POST", "PATCH", "DELETE"].includes(method) && !mergeSafeMutation(method, route)) requireCurrentRevision(req, payload, event);
    if (method === "GET" && route.length === 3) return sendJSON(res, 200, eventReadModel(event));
    if (method === "GET" && route[3] === "handoff" && route[4] && !route[5]) return sendJSON(res, 200, qualifierHandoff(event, division(route[4])));
    if (method === "PATCH" && route.length === 3) { const staff = staffFrom(payload); const fields = normalizeEventFields(payload); const changed = [...Object.keys(fields), ...(payload.configuration === undefined ? [] : ["configuration"]), ...(payload.state === undefined ? [] : ["state"])]; if (!changed.length) throw new Error("Provide at least one event field to update"); if (fields.name !== undefined && !fields.name) throw new Error("Event name cannot be empty"); if (fields.timeZone !== undefined && !validTimeZone(fields.timeZone)) throw new Error("A valid IANA time zone is required"); if (fields.name !== undefined) event.name = fields.name; if (fields.eventTime !== undefined) event.eventTime = fields.eventTime; if (fields.prelimsStartTime !== undefined) event.prelimsStartTime = fields.prelimsStartTime; if (fields.location !== undefined) event.location = fields.location || DEFAULT_LOCATION; if (fields.timeZone !== undefined) event.timeZone = fields.timeZone; if (fields.mode !== undefined) event.mode = eventMode(fields.mode); if (fields.judges !== undefined) event.judges = fields.judges; if (fields.judgesByDivision !== undefined) { const configuration = normalizeEventConfiguration({ ...ensureEventConfiguration(event), divisions: ensureEventConfiguration(event).divisions.map((division) => ({ ...division, judges: fields.judgesByDivision[division.id] || division.judges })) }); assertConfigurationCanReplace(event, configuration); event.configuration = configuration; event.judgesByDivision = Object.fromEntries(configuration.divisions.map((division) => [division.id, division.judges])); } if (payload.configuration !== undefined) { const configuration = normalizeEventConfiguration(payload.configuration, event.judgesByDivision); assertConfigurationCanReplace(event, configuration); event.configuration = configuration; event.judgesByDivision = Object.fromEntries(configuration.divisions.map((division) => [division.id, division.judges])); } if (payload.state !== undefined) { const nextState = lifecycleState(payload.state); if (event.lifecycle.status === "archived" && nextState !== "archived") throw new Error("Restore an archived event before changing its state"); event.lifecycle.status = nextState; if (nextState !== "archived") { event.lifecycle.archivedAt = null; event.lifecycle.archivedBy = null; } } audit(event, staff, "update_event", "event", event.id, { fields: changed }); await commitEvent(store, event, res); return sendJSON(res, 200, event); }
    if (method === "POST" && route[3] === "archive" && !route[4]) { const staff = staffFrom(payload); const action = payload.action === "restore" ? "restore" : payload.action === "archive" ? "archive" : null; if (!action) throw new Error("action must be archive or restore"); if (action === "archive" && event.lifecycle.status === "archived") throw new Error("Event is already archived"); if (action === "restore" && event.lifecycle.status !== "archived") throw new Error("Only archived events can be restored"); event.lifecycle = action === "archive" ? { status: "archived", archivedAt: now(), archivedBy: { name: staff.name, role: staff.role } } : { status: "active", archivedAt: null, archivedBy: null }; audit(event, staff, action === "archive" ? "archive_event" : "restore_event", "event", event.id); await commitEvent(store, event, res); return sendJSON(res, 200, event); }
    if (method === "DELETE" && route.length === 3) { const staff = staffFrom(payload); const deletedEvent = { id: event.id, name: event.name, registrationCount: event.registrations.length, deletedBy: { name: staff.name, role: staff.role }, deletedAt: now() }; await persistence.deleteEvent(event.id, event.revision); return sendJSON(res, 200, { deleted: true, deletedEvent }); }
    if (method === "GET" && route[3] === "finance" && !route[4]) { recalculatePayments(event); return sendJSON(res, 200, financeReport(event, ensureEventConfiguration(event))); }
    if (route[3] === "finance" && method === "POST") {
      const staff = staffFrom(payload); const finance = ensureFinanceState(event); const configuration = ensureEventConfiguration(event);
      if (event.lifecycle.status === "archived") { const error = new Error("Restore this event before changing its financial record"); error.statusCode = 409; error.code = "EVENT_ARCHIVED"; throw error; }
      if (route[4] === "transactions" && !route[5]) {
        assertFinanceManager(staff);
        if (finance.status === "closed") { const error = new Error("Reopen the event before adding financial records"); error.statusCode = 409; error.code = "FINANCE_CLOSED"; throw error; }
        const transaction = normalizeTransaction(payload, { source: "manual", createdBy: staff }); finance.transactions.push(transaction); finance.status = "open"; finance.review = { reviewedAt: null, reviewedBy: null, notes: "" };
        audit(event, staff, "create_financial_transaction", "financial_transaction", transaction.id, { category: transaction.category, expectedAmount: transaction.expectedAmount, actualAmount: transaction.actualAmount });
        await commitEvent(store, event, res); return sendJSON(res, 201, { transaction, report: financeReport(event, configuration) });
      }
      if (route[4] === "import" && route[5] === "preview" && !route[6]) { assertFinanceManager(staff); return sendJSON(res, 200, previewCostImport(payload.csv)); }
      if (route[4] === "import" && !route[5]) {
        assertFinanceManager(staff); const preview = previewCostImport(payload.csv);
        if (!preview.canImport) { const error = new Error(preview.errors[0]?.message || "Nothing safe to import"); error.statusCode = 400; error.code = "FINANCE_IMPORT_REVIEW_REQUIRED"; throw error; }
        const transactions = importCostRecords(event, preview, staff);
        audit(event, staff, "import_financial_transactions", "event", event.id, { count: transactions.length, categories: [...new Set(transactions.map((transaction) => transaction.category))], warningCount: preview.warnings.length });
        await commitEvent(store, event, res); return sendJSON(res, 201, { imported: transactions.length, warnings: preview.warnings, transactions, report: financeReport(event, configuration) });
      }
      if (route[4] === "review" && !route[5]) {
        assertFinanceManager(staff);
        if (finance.status === "closed") { const error = new Error("This financial record is already closed"); error.statusCode = 409; error.code = "FINANCE_CLOSED"; throw error; }
        const notes = String(payload.notes || "").trim(); if (notes.length > 1200) throw new Error("Review notes must be 1,200 characters or fewer");
        finance.status = "review"; finance.review = { reviewedAt: now(), reviewedBy: { name: staff.name, role: staff.role }, notes };
        audit(event, staff, "review_event_finances", "event", event.id, { notes });
        await commitEvent(store, event, res); return sendJSON(res, 200, financeReport(event, configuration));
      }
      if (route[4] === "close" && !route[5]) {
        assertFinanceManager(staff);
        if (finance.status !== "review" || !finance.review.reviewedAt) { const error = new Error("Complete the final financial review before closing the event"); error.statusCode = 409; error.code = "FINANCE_REVIEW_REQUIRED"; throw error; }
        finance.status = "closed"; finance.closedAt = now(); finance.closedBy = { name: staff.name, role: staff.role }; event.lifecycle.status = "completed";
        audit(event, staff, "close_event_finances", "event", event.id, { netProfit: financeReport(event, configuration).actual.netProfit });
        await commitEvent(store, event, res); return sendJSON(res, 200, financeReport(event, configuration));
      }
      if (route[4] === "reopen" && !route[5]) {
        assertFinanceEventLead(staff);
        if (finance.status !== "closed") { const error = new Error("Only a closed event can be reopened"); error.statusCode = 409; error.code = "FINANCE_NOT_CLOSED"; throw error; }
        const reason = String(payload.reason || "").trim(); if (reason.length < 3 || reason.length > 240) throw new Error("Reopen reason must be between 3 and 240 characters");
        finance.status = "open"; finance.reopenedAt = now(); finance.reopenedBy = { name: staff.name, role: staff.role }; finance.reopenReason = reason; finance.closedAt = null; finance.closedBy = null; finance.review = { reviewedAt: null, reviewedBy: null, notes: "" }; event.lifecycle.status = "active";
        audit(event, staff, "reopen_event_finances", "event", event.id, { reason });
        await commitEvent(store, event, res); return sendJSON(res, 200, financeReport(event, configuration));
      }
      if (route[4] === "corrections" && !route[5]) {
        assertFinanceManager(staff); recalculatePayments(event);
        const correction = correctionTransaction(event, configuration, String(payload.transactionId || ""), payload.correctedActualAmount, payload.reason, staff);
        audit(event, staff, "correct_closed_financial_transaction", "financial_transaction", correction.transaction.id, { correctionOf: correction.original.id, previousActualAmount: correction.original.actualAmount, correctedActualAmount: correction.correctedActualAmount, delta: correction.transaction.actualAmount, reason: correction.transaction.correctionReason });
        await commitEvent(store, event, res); return sendJSON(res, 201, { correction: correction.transaction, report: financeReport(event, configuration) });
      }
    }
    if (!["draft", "active"].includes(event.lifecycle.status) && ["POST", "PATCH"].includes(method) && route[3] !== "backups") { const error = new Error(event.lifecycle.status === "archived" ? "This event is archived. Restore it before changing event operations." : `This event is ${event.lifecycle.status}. Set it active before changing event operations.`); error.statusCode = 409; error.code = event.lifecycle.status === "archived" ? "EVENT_ARCHIVED" : "EVENT_NOT_ACTIVE"; error.currentRevision = event.revision; throw error; }
    if (method === "GET" && route[3] === "sync") { const after = Number(query(req.url).get("after")); return sendJSON(res, 200, { eventId: event.id, revision: event.revision, changed: !Number.isInteger(after) || after !== event.revision, updatedAt: event.updatedAt, serverNow: now() }); }
    if (method === "GET" && route[3] === "snapshot") { const eventView = eventReadModel(event); return sendJSON(res, 200, { revision: event.revision, serverNow: now(), event: eventView, registrations: eventView.registrations, report: { ...reportFor(event), auditLog: event.auditLog } }); }
    if (route[3] === "judging" && route[4]) {
      const divisionName = division(route[4]);
      const settings = divisionFor(event, divisionName);
      if (method === "GET" && route[5] === "session" && !route[6]) return sendJSON(res, 200, judgeSession(event, divisionName, staffFrom(payload)));
      if (method === "GET" && route[5] === "status" && !route[6]) {
        const registrations = event.registrations.filter((registration) => registration.bracket === divisionName && registration.status === "Checked in");
        return sendJSON(res, 200, monitorStatus(event, settings, registrations));
      }
      if (method === "GET" && route[5] === "audit" && !route[6]) {
        const entries = event.auditLog.filter((entry) => entry.details?.division === divisionName && ["save_judge_score_draft", "submit_judge_score", "lock_judge_scores", "correct_locked_judge_score", "assign_judge"].includes(entry.action)).map((entry) => ({ ...entry, details: { ...entry.details, score: undefined, previousScore: undefined } }));
        return sendJSON(res, 200, { division: divisionName, entries });
      }
      if (method === "POST" && route[5] === "assignments" && !route[6]) {
        const staff = staffFrom(payload); assertEventLead(staff);
        if (!Number.isInteger(payload.judgeNumber) || payload.judgeNumber < 1 || payload.judgeNumber > settings.prelims.judgeCount) throw new Error(`judgeNumber must be from 1 to ${settings.prelims.judgeCount}`);
        if (typeof payload.staffName !== "string" || !payload.staffName.trim() || payload.staffName.trim().length > 120) throw new Error("staffName is required and must be 120 characters or fewer");
        const assignment = assignmentsFor(event, settings).find((item) => item.judgeNumber === payload.judgeNumber);
        assignment.staffName = payload.staffName.trim(); assignment.assignedAt = now();
        audit(event, staff, "assign_judge", "judge_assignment", assignment.id, { division: divisionName, judgeNumber: assignment.judgeNumber, judgeName: assignment.judgeName, assignedStaffName: assignment.staffName });
        await commitEvent(store, event, res); return sendJSON(res, 200, assignment);
      }
      if (method === "POST" && route[5] === "score" && !route[6]) {
        const result = saveJudgeScore(event, divisionName, payload, staffFrom(payload));
        await commitEvent(store, event, res); return sendJSON(res, 200, result);
      }
      if (method === "POST" && route[5] === "corrections" && !route[6]) {
        const result = correctJudgeScore(event, divisionName, payload, staffFrom(payload));
        await commitEvent(store, event, res); return sendJSON(res, 200, result);
      }
    }
    if (method === "GET" && route[3] === "backups" && !route[4]) return sendJSON(res, 200, { backups: await listEventBackups(event.id) });
    if (method === "GET" && route[3] === "imports" && !route[4]) return sendJSON(res, 200, { imports: await importHistory(event) });
    if (method === "GET" && route[3] === "backups" && route[4] && !route[5]) { const backup = await loadEventBackup(event.id, route[4]); return sendFile(res, "application/json; charset=utf-8", `${event.id}-${route[4]}.json`, JSON.stringify(backup, null, 2)); }
    if (method === "POST" && route[3] === "backups" && !route[4]) { const staff = staffFrom(payload); const reason = normalizeBackupReason(payload); audit(event, staff, "create_event_backup", "event", event.id, { reason }); const backup = await createEventBackup(event, staff, reason, "manual"); await commitEvent(store, event, res); return sendJSON(res, 201, { backup }); }
    if (method === "POST" && route[3] === "backups" && route[4] && route[5] === "restore") { const staff = staffFrom(payload); const result = await restoreEventBackup(store, event, route[4], staff); await commitEvent(store, result.event, res); return sendJSON(res, 200, result); }
    if (method === "POST" && route[3] === "import" && route[4] === "preview") { const intake = normalizeImportPayload(payload); return sendJSON(res, 200, await importPreview(event, intake)); }
    if (method === "POST" && route[3] === "import") {
      const staff = staffFrom(payload); const intake = normalizeImportPayload(payload); const preview = await importPreview(event, intake);
      if (!preview.canImport) { const error = invalidInput(preview.errors[0]?.message || "Nothing safe to import"); error.code = "IMPORT_REVIEW_REQUIRED"; throw error; }
      const records = preview.records.map(({ sourceRow, ...record }) => record);
      const mutation = await commitMergeSafe(event.id, res, async (latest) => {
        const backup = await createEventBackup(latest, staff, `Before ${intake.source.toUpperCase()} import (${intake.bracket})`, "import");
        const config = divisionFor(latest, intake.bracket); const registrations = records.map((record) => createRegistration(latest, { ...record, bracket: intake.bracket, ...(record.instagram ? (config.teamSize === 1 ? { instagramMembers: [record.instagram] } : { instagramTeam: record.instagram }) : {}) }, "early"));
        const importAudit = audit(latest, staff, "import_csv", "bracket", intake.bracket, { count: registrations.length, registrationIds: registrations.map((registration) => registration.id), importId: backup.backupId, sourceType: intake.source, warningCount: preview.warnings.length });
        return { registrations, backup, importAudit };
      });
      const registrations = mutation.result.registrations;
      return sendJSON(res, 201, { imported: registrations.length, needsReview: registrations.filter((registration) => registration.needsReview).length, duplicateWarnings: registrations.filter((registration) => registration.duplicateOf.length).length, warnings: preview.warnings, importId: mutation.result.backup.backupId, backup: mutation.result.backup, registrations });
    }
    if (method === "POST" && route[3] === "imports" && route[4] === "undo") {
      const staff = staffFrom(payload); const mutation = await commitMergeSafe(event.id, res, (latest) => {
        const original = latestUnreversedImport(latest);
        if (!original) { const error = new Error("There is no import available to undo."); error.statusCode = 409; error.code = "NO_IMPORT_TO_UNDO"; throw error; }
        const ids = new Set(original.details.registrationIds || []);
        const blocked = [...ids].find((registrationId) => registrationIsInBracket(latest, registrationId, original.targetId));
        if (blocked) { const error = new Error("This import is already part of a bracket or prelim order and cannot be undone safely."); error.statusCode = 409; error.code = "IMPORT_UNDO_BLOCKED"; throw error; }
        const before = latest.registrations.length; latest.registrations = latest.registrations.filter((registration) => !ids.has(registration.id));
        for (const order of Object.values(latest.prelimOrders || {})) { if (!order?.registrationIds) continue; order.registrationIds = order.registrationIds.filter((registrationId) => !ids.has(registrationId)); order.currentEntryIndex = Math.min(order.currentEntryIndex || 0, order.registrationIds.length); }
        recalculatePayments(latest);
        audit(latest, staff, "undo_import", "import", original.details.importId, { reversalOfAuditId: original.id, removedRegistrationIds: [...ids], removedCount: before - latest.registrations.length });
        return { importId: original.details.importId, removed: before - latest.registrations.length };
      });
      return sendJSON(res, 200, { ...mutation.result, imports: await importHistory(mutation.event) });
    }
    if (method === "POST" && route[3] === "staff-attendance") { const staff = staffFrom(payload); const mutation = await commitMergeSafe(event.id, res, (latest) => { const attendance = recordStaffPresence(latest, staff); audit(latest, staff, "staff_sign_in", "event", latest.id); return { attendance, staffAttendance: latest.staffAttendance }; }); return sendJSON(res, 200, mutation.result); }
    if (method === "GET" && route[3] === "registrations" && !route[4]) { const bracket = query(req.url).get("bracket"); return sendJSON(res, 200, event.registrations.filter((registration) => !bracket || registration.bracket === bracket).map((registration) => registrationReadModel(event, registration))); }
    if (method === "POST" && route[3] === "registrations" && !route[4]) { const staff = staffFrom(payload); const mutation = await commitMergeSafe(event.id, res, (latest) => { const registration = createRegistration(latest, payload, "same_day"); audit(latest, staff, "create_same_day_registration", "registration", registration.id, { duplicates: registration.duplicateOf.length }); return { registration }; }); return sendJSON(res, 201, mutation.result.registration); }
    if (route[3] === "registrations" && route[4]) {
      const registration = findRegistration(event, route[4]); if (!registration) return sendJSON(res, 404, { error: "Registration not found" });
      if (method === "GET" && !route[5]) return sendJSON(res, 200, registrationReadModel(event, registration));
      if (method === "POST" && route[5] === "resolve-duplicate") { const result = resolveDuplicate(event, registration, payload); await commitEvent(store, event, res); return sendJSON(res, 200, result); }
      if (method === "PATCH" && !route[5]) { requireRegistrationVersion(payload, registration, event); const staff = staffFrom(payload); const fields = normalizeRegistrationFields(payload); delete fields.bracket; const changed = Object.keys(fields); if (!changed.length) throw new Error("Provide at least one registration field to update"); applyRegistrationEdit(event, registration, fields, staff); audit(event, staff, "edit_registration", "registration", registration.id, { fields: changed }); await commitEvent(store, event, res); return sendJSON(res, 200, registration); }
      if (method === "POST" && route[5] === "link-person") { const staff = staffFrom(payload); const memberIndex = divisionFor(event, registration.bracket).teamSize > 1 ? Number(payload.memberIndex) : 0; const person = event.people.find((candidate) => candidate.id === payload.personId); if (!Number.isInteger(memberIndex) || !registration.members[memberIndex] || !person) throw new Error("A valid memberIndex and existing personId are required"); registration.members[memberIndex].personId = person.id; recalculatePayments(event); registration.updatedAt = now(); audit(event, staff, "link_person", "registration", registration.id, { memberIndex, personId: person.id }); await commitEvent(store, event, res); return sendJSON(res, 200, registration); }
      if (method === "POST" && route[5] === "check-in") { const mutation = await commitMergeSafe(event.id, res, (latest) => { const current = findRegistration(latest, registration.id); if (!current) { const error = new Error("Registration not found"); error.statusCode = 404; throw error; } const result = checkIn(latest, current, payload); if (result.alreadyCheckedIn) return { ...result, skipCommit: true }; appendLate(latest, current, payload.staff); return result; }); if (mutation.result.alreadyCheckedIn) return sendJSON(res, 409, { message: "Already checked in", code: "ALREADY_CHECKED_IN", currentRevision: mutation.event.revision, registration: mutation.result.registration }); return sendJSON(res, 200, { message: "Checked in", registration: mutation.result.registration }); }
      if (method === "POST" && route[5] === "undo-check-in") { const result = undoCheckIn(event, registration, payload); await commitEvent(store, event, res); return sendJSON(res, 200, result); }
      if (method === "POST" && route[5] === "cancel") { const staff = staffFrom(payload); if (registrationIsInBracket(event, registration.id, registration.bracket)) throw new Error("Bracket participants cannot be canceled after the bracket is generated"); registration.status = "Canceled"; registration.members.forEach((member) => { member.checkedIn = false; member.arrivedAt = null; }); recalculatePayments(event); registration.updatedAt = now(); audit(event, staff, "cancel_registration", "registration", registration.id); await commitEvent(store, event, res); return sendJSON(res, 200, registration); }
      if (method === "POST" && route[5] === "restore") { const staff = staffFrom(payload); if (registration.status !== "Canceled") throw new Error("Only canceled registrations can be restored"); registration.status = "Registered"; registration.updatedAt = now(); audit(event, staff, "restore_registration", "registration", registration.id); await commitEvent(store, event, res); return sendJSON(res, 200, registration); }
      if (method === "POST" && route[5] === "scores") { requireRegistrationVersion(payload, registration, event); const staff = staffFrom(payload); assertEventLead(staff); const prelims = divisionFor(event, registration.bracket).prelims; if (event.brackets[registration.bracket]) throw new Error("Scores cannot change after the bracket is generated"); if (!Number.isInteger(payload.judgeNumber) || payload.judgeNumber < 1 || payload.judgeNumber > prelims.judgeCount || !Number.isInteger(payload.score) || payload.score < prelims.scoreMinimum || payload.score > prelims.scoreMaximum) throw new Error(`judgeNumber must be from 1 to ${prelims.judgeCount} and score must be an integer from ${prelims.scoreMinimum} to ${prelims.scoreMaximum}`); registration.scores.judgeScores ||= Array(prelims.judgeCount).fill(null); while (registration.scores.judgeScores.length < prelims.judgeCount) registration.scores.judgeScores.push(null); registration.scores.judgeScores[payload.judgeNumber - 1] = payload.score; if (payload.judgeNumber <= 2) registration.scores[`judge${payload.judgeNumber}`] = payload.score; registration.scores.average = scoreAverage(registration, prelims.judgeCount); if (registration.scores.average !== null && ["prelim_assigned", "performing"].includes(registration.competitionState)) transitionCompetitionState(registration, "scored"); registration.updatedAt = now(); audit(event, staff, "enter_legacy_event_lead_score", "registration", registration.id, { judgeNumber: payload.judgeNumber, score: payload.score, judgeName: payload.judgeName || "" }); await commitEvent(store, event, res); return sendJSON(res, 200, registration); }
    }
    if (method === "POST" && route[3] === "timers" && route[4] && route[5]) { const mutation = await commitMergeSafe(event.id, res, (latest) => ({ timer: controlTimer(latest, route[4], route[5], payload) })); return sendJSON(res, 200, mutation.result.timer); }
    if (method === "POST" && route[3] === "spectators" && route[4] === "undo" && !route[5]) {
      const mutation = await commitMergeSafe(event.id, res, (latest) => { undoSpectator(latest, payload); return { spectators: eventReadModel(latest).spectators }; });
      return sendJSON(res, 200, mutation.result.spectators);
    }
    if (method === "POST" && route[3] === "spectators" && !route[4]) { const staff = staffFrom(payload); const mutation = await commitMergeSafe(event.id, res, (latest) => { const fees = spectatorFees(latest); latest.spectators.count += 1; latest.spectators.entryMoney += fees.spectatorEntryFee; latest.spectators.drinkMoney += fees.spectatorDrinkFee; audit(latest, staff, "add_spectator", "event", latest.id, { count: 1, entryMoney: fees.spectatorEntryFee, drinkMoney: fees.spectatorDrinkFee }); return { spectators: eventReadModel(latest).spectators }; }); return sendJSON(res, 200, mutation.result.spectators); }
    if (method === "POST" && route[3] === "prelim-progress") { const order = advancePrelim(event, division(payload.bracket), payload); await commitEvent(store, event, res); return sendJSON(res, 200, order); }
    if (method === "POST" && route[3] === "prelim-order") { const staff = staffFrom(payload); const order = generatePrelimOrder(event, payload.bracket, staff); await commitEvent(store, event, res); return sendJSON(res, 200, order); }
    if (method === "POST" && route[3] === "prelim-tiebreak") { const result = recordPrelimTieBreak(event, { ...payload, ...normalizeTieBreakPayload(payload) }); await commitEvent(store, event, res); return sendJSON(res, 200, result); }
    if (method === "POST" && route[3] === "rankings" && route[4] === "override") { const staff = staffFrom(payload); const override = normalizeRankingOverride(payload); if (event.brackets[override.bracket]) throw new Error("Rank corrections cannot change after the bracket is generated"); const registration = findRegistration(event, override.registrationId); if (!registration || registration.bracket !== override.bracket) throw new Error("registrationId must refer to an entry in this bracket"); registration.rankOverride = { rank: override.rank, reason: override.reason, at: now(), staffName: staff.name }; registration.updatedAt = now(); audit(event, staff, "override_ranking", "registration", registration.id, registration.rankOverride); await commitEvent(store, event, res); return sendJSON(res, 200, registration); }
    if (method === "POST" && route[3] === "rankings") { const staff = staffFrom(payload); const bracketName = division(payload.bracket); if (event.brackets[bracketName]) throw new Error("Rankings cannot change after the bracket is generated"); const rankings = rankPrelims(event, bracketName, staff); await commitEvent(store, event, res); return sendJSON(res, 200, rankings); }
    if (method === "POST" && route[3] === "bracket-seeds") { const seeds = saveBracketSeeds(event, payload); await commitEvent(store, event, res); return sendJSON(res, 200, seeds); }
    if (method === "POST" && route[3] === "bracket" && !route[4]) { const staff = staffFrom(payload); const bracket = createBracket(event, division(payload.bracket), staff, Boolean(payload.replace)); await commitEvent(store, event, res); return sendJSON(res, 201, bracket); }
    if (method === "GET" && route[3] === "bracket" && route[4] && !route[5]) return sendJSON(res, 200, event.brackets[route[4]] || { error: "Bracket not found" });
    if (method === "POST" && route[3] === "bracket" && route[4] && route[5] === "matches" && route[6] && route[7] === "decision") { const decision = normalizeMatchDecision(payload); const match = decision.outcome === "tie" ? recordTieReplay(event, route[4], route[6], { ...payload, ...decision }) : decideMatch(event, route[4], route[6], { ...payload, ...decision, winnerId: decision.winnerId || decision.outcome, decisionMethod: decision.decisionMethod || "operator_choice" }); await commitEvent(store, event, res); return sendJSON(res, 200, match); }
    if (method === "POST" && route[3] === "bracket" && route[4] && route[5] === "matches" && route[6] && route[7] === "complete-performance-round") { const match = completePerformanceRound(event, route[4], route[6], payload); await commitEvent(store, event, res); return sendJSON(res, 200, match); }
    if (method === "POST" && route[3] === "bracket" && route[4] && route[5] === "matches" && route[6] && route[7] === "undo-decision") { const match = undoDecision(event, route[4], route[6], payload); await commitEvent(store, event, res); return sendJSON(res, 200, match); }
    if (method === "GET" && route[3] === "report") return sendJSON(res, 200, { ...reportFor(event), auditLog: event.auditLog });
    if (method === "GET" && route[3] === "exports" && route[4]) { const [kind, extension] = route[4].split("."); const language = query(req.url).get("lang") === "ja" ? "ja" : "en"; if (!extension || !["combined", "registrations", "rankings", "bracket", "staff", "finance"].includes(kind)) throw new Error("Unknown export"); if (!["csv", "pdf"].includes(extension)) throw new Error("Export format must be csv or pdf"); const filename = `${event.id}-${kind}-${language}.${extension}`; const content = extension === "csv" ? csvFor(event, kind, language) : simplePDF(`${event.name} — ${kind} ${exportCopy(language).report}`, pdfLinesFor(event, kind, language), { language, pageLabel: exportCopy(language).page }); await persistence.recordExport({ eventId: event.id, kind, format: extension, language, filename, content, createdBy: payload.staff }); return sendFile(res, extension === "csv" ? "text/csv; charset=utf-8" : "application/pdf", filename, content); }
    return sendJSON(res, 404, { error: "Route not found" });
  } catch (error) { if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds)); return sendJSON(res, error.statusCode || 400, { error: error.message, ...(error.code ? { code: error.code } : {}), ...(Number.isInteger(error.currentRevision) ? { currentRevision: error.currentRevision } : {}) }); }
}

async function start() {
  await initializePersistence();
  http.createServer(handle).listen(PORT, () => console.log(`The Menyu backend listening on http://localhost:${PORT}${process.env.STAFF_ACCESS_CODE ? "" : ` (generated staff access code: ${runtime.staffAccessCode})`}`));
}

if (require.main === module) start().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = handle;
