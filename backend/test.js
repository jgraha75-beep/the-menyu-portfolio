const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 3321;
const BASE = `http://localhost:${PORT}/api`;
const STAFF = { name: "Regression QA", role: "Event lead" };
let authToken = "";
const eventRevisions = new Map();
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "the-menyu-test-"));
const dataFile = path.join(tempDirectory, "data.json");
const backupDirectory = path.join(tempDirectory, "backups");
fs.writeFileSync(dataFile, JSON.stringify({ events: [] }));

const server = spawn(process.execPath, ["server.js"], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT), DATA_FILE: dataFile, BACKUP_DIR: backupDirectory, STAFF_ACCESS_CODE: "test-access-code" },
  stdio: ["ignore", "pipe", "pipe"]
});

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function request(pathname, options = {}) {
  const { skipRevision = false, expectedRevision, captureRevision = true, ...fetchOptions } = options;
  const headers = { ...(options.headers || {}) }; if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const eventId = pathname.match(/^\/events\/([^/?]+)/)?.[1];
  const method = String(options.method || "GET").toUpperCase();
  if (!skipRevision && eventId && ["POST", "PATCH", "DELETE"].includes(method)) { const revision = expectedRevision ?? eventRevisions.get(eventId); if (revision !== undefined) headers["If-Match"] = `"${revision}"`; }
  const response = await fetch(`${BASE}${pathname}`, { ...fetchOptions, headers });
  const body = await response.json();
  const responseRevision = Number(response.headers.get("x-event-revision"));
  if (captureRevision && eventId && response.ok && Number.isInteger(responseRevision)) eventRevisions.set(eventId, responseRevision);
  return { status: response.status, body, revision: Number.isInteger(responseRevision) ? responseRevision : null };
}
function post(pathname, body, options = {}) { return request(pathname, { ...options, method: "POST", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, body: JSON.stringify(body) }); }
function patch(pathname, body, options = {}) { return request(pathname, { ...options, method: "PATCH", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, body: JSON.stringify(body) }); }
function del(pathname, body, options = {}) { return request(pathname, { ...options, method: "DELETE", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, body: JSON.stringify(body) }); }
async function requestText(pathname) {
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  const response = await fetch(`${BASE}${pathname}`, { headers });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}
async function requestPublicDisplay(eventId, bracket) {
  const response = await fetch(`${BASE}/public/events/${eventId}/display?division=${bracket}`);
  return { status: response.status, body: await response.json() };
}
function assertStructuredPdf(pdf) {
  assert.ok(pdf.startsWith("%PDF-1.4"));
  const objects = new Map([...pdf.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)].map((match) => [Number(match[1]), match[2]]));
  const pagesRoot = objects.get(2);
  assert.ok(pagesRoot?.includes("/Type /Pages"), "PDF must contain a pages root");
  const pageObjects = [...objects.entries()].filter(([, body]) => /\/Type \/Page(?:\s|\/)/.test(body));
  assert.ok(pageObjects.length, "PDF must contain at least one page");
  const kidIds = [...pagesRoot.matchAll(/(\d+) 0 R/g)].map((match) => Number(match[1]));
  assert.deepEqual(kidIds, pageObjects.map(([objectId]) => objectId), "Pages root must reference the emitted page objects");
  for (const [, page] of pageObjects) {
    const contentId = Number(page.match(/\/Contents (\d+) 0 R/)?.[1]);
    assert.ok(Number.isInteger(contentId) && objects.has(contentId), "Each page must reference an emitted content object");
  }
}
async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const result = await request("/health"); if (result.status === 200) return; } catch { /* Server is still starting. */ }
    await wait(50);
  }
  throw new Error("Test server did not start");
}
async function login() { const result = await post("/auth/login", { accessCode: "test-access-code", staff: STAFF }); assert.equal(result.status, 200); authToken = result.body.token; }
async function loginAs(staff) { const savedToken = authToken; authToken = ""; const result = await post("/auth/login", { accessCode: "test-access-code", staff }); authToken = savedToken; assert.equal(result.status, 200); return result.body.token; }
async function createEvent(name) { const result = await post("/events", { name, eventTime: "2026-09-20 18:00", staff: STAFF }); assert.equal(result.status, 201); eventRevisions.set(result.body.id, result.body.revision); return result.body; }
async function checkInAll(eventId, registrations, bracket, configuredTeamSize = bracket === "2v2" ? 2 : 1) {
  for (const registration of registrations) {
    for (let memberIndex = 0; memberIndex < configuredTeamSize; memberIndex += 1) {
      const result = await post(`/events/${eventId}/registrations/${registration.id}/check-in`, { memberIndex, staff: STAFF });
      assert.equal(result.status, 200);
      Object.assign(registration, result.body.registration);
    }
  }
}
async function saveScore(eventId, registration, judgeNumber, score) {
  const result = await post(`/events/${eventId}/registrations/${registration.id}/scores`, { judgeNumber, score, expectedUpdatedAt: registration.updatedAt, staff: STAFF });
  assert.equal(result.status, 200); Object.assign(registration, result.body); return result.body;
}
async function completeRound(eventId, division, matchId) {
  const result = await post(`/events/${eventId}/bracket/${division}/matches/${matchId}/complete-performance-round`, { staff: STAFF });
  assert.equal(result.status, 200);
  return result.body;
}
async function run() {
  await waitForHealth();
  const noAuth = await request("/events");
  assert.equal(noAuth.status, 401, "Event data must not be available without a staff session");
  const malformedLogin = await post("/auth/login", { accessCode: "test-access-code", staff: { name: 42, role: "Backend Test" } });
  assert.equal(malformedLogin.status, 400, "Login must reject a malformed staff identity");
  await login();

  const pdfEvent = await createEvent("PDF CSV regression");
  const pdfImport = await post(`/events/${pdfEvent.id}/import`, { bracket: "2v2", csv: '\uFEFF"確認","No","チーム名","メンバー","ジャンル"\r\n"","004","Crew","One /\nTwo","Hip hop"\r\n', staff: STAFF });
  assert.equal(pdfImport.status, 201);
  assert.equal(pdfImport.body.imported, 1);
  assert.equal(pdfImport.body.registrations[0].sourceNumber, "004");
  assert.deepEqual(pdfImport.body.registrations[0].members.map(member => member.name), ["One", "Two"]);
  const previewBefore = await request(`/events/${pdfEvent.id}/registrations`);
  const importPreview = await post(`/events/${pdfEvent.id}/import/preview`, { bracket: "2v2", csv: 'No,Team Name,Member Names\n7,Preview Crew,"A / B"', staff: STAFF });
  assert.equal(importPreview.status, 200);
  assert.equal(importPreview.body.canImport, true);
  assert.equal(importPreview.body.records[0].sourceNumber, "7");
  const previewAfter = await request(`/events/${pdfEvent.id}/registrations`);
  assert.deepEqual(previewAfter.body, previewBefore.body, "Import preview must not save registrations");
  assert.equal(pdfImport.body.importId.startsWith("backup_"), true);
  assert.equal((await request(`/events/${pdfEvent.id}/imports`)).body.imports[0].sourceType, "csv");
  const soloImport = await post(`/events/${pdfEvent.id}/import`, { bracket: "under15", csv: 'No,チーム名,代表者名(ソロの場合はエントリー名)\n1,001,AOI', staff: STAFF });
  assert.equal(soloImport.status, 201);
  assert.equal(soloImport.body.registrations[0].teamName, "");
  assert.equal(soloImport.body.registrations[0].members[0].name, "AOI");
  const beforeBadImport = await request(`/events/${pdfEvent.id}/registrations`);
  const badImport = await post(`/events/${pdfEvent.id}/import`, { bracket: "2v2", csv: 'No,Team Name\n2,Valid\n3,', staff: STAFF });
  assert.equal(badImport.status, 400);
  const afterBadImport = await request(`/events/${pdfEvent.id}/registrations`);
  assert.deepEqual(afterBadImport.body, beforeBadImport.body, "Invalid CSV must not partially import");

  const recoveryEvent = await createEvent("Import undo regression");
  const walkIn = await post(`/events/${recoveryEvent.id}/registrations`, { bracket: "under15", entryName: "Walk-in kept", staff: STAFF });
  assert.equal(walkIn.status, 201);
  const recoveryImport = await post(`/events/${recoveryEvent.id}/import`, { bracket: "under15", csv: "No,Entry Name\n020,Imported A\n021,Imported B", staff: STAFF });
  assert.equal(recoveryImport.status, 201);
  const recoveryHistory = await request(`/events/${recoveryEvent.id}/imports`);
  assert.equal(recoveryHistory.body.imports.length, 1);
  assert.equal(recoveryHistory.body.imports[0].backup.kind, "import");
  const undone = await post(`/events/${recoveryEvent.id}/imports/undo`, { staff: STAFF });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.removed, 2);
  const afterUndoImport = await request(`/events/${recoveryEvent.id}/registrations`);
  assert.deepEqual(afterUndoImport.body.map((registration) => registration.entryName), ["Walk-in kept"], "Undo must preserve registrations created outside the import");
  assert.equal((await post(`/events/${recoveryEvent.id}/imports/undo`, { staff: STAFF })).status, 409);

  const rehearsal = await post("/events", { name: "Rehearsal isolation", mode: "rehearsal", staff: STAFF });
  assert.equal(rehearsal.status, 201);
  assert.equal(rehearsal.body.mode, "rehearsal");
  eventRevisions.set(rehearsal.body.id, rehearsal.body.revision);
  const rehearsalLive = await patch(`/events/${rehearsal.body.id}`, { mode: "live", staff: STAFF });
  assert.equal(rehearsalLive.status, 200);
  assert.equal(rehearsalLive.body.mode, "live", "Rehearsal mode can be changed explicitly before launch");

  const financeEvent = await createEvent("Finance workflow regression");
  const eventLeadTokenForFinance = authToken;
  const generalFinanceToken = await loginAs({ name: "Read Only", role: "General staff" });
  authToken = generalFinanceToken;
  const financeDenied = await post(`/events/${financeEvent.id}/finance/transactions`, { category: "merchandise_income", description: "Shirts", actualAmount: 120, staff: { name: "Read Only", role: "General staff" } });
  assert.equal(financeDenied.status, 403, "General staff must not change financial records");
  authToken = eventLeadTokenForFinance;
  const financeEntry = await post(`/events/${financeEvent.id}/finance/transactions`, { category: "merchandise_income", description: "Shirts", expectedAmount: 100, actualAmount: 120, staff: STAFF });
  assert.equal(financeEntry.status, 201);
  const financePreview = await post(`/events/${financeEvent.id}/finance/import/preview`, { csv: "category,description,expected,actual,payee,date\nvenue,Venue,500,500,Studio,2026-09-25\nstaff,DJ,200,200,DJ,2026-09-25\nrefund,Refund,100,100,Battler,2026-09-25", staff: STAFF });
  assert.equal(financePreview.status, 200);
  assert.equal(financePreview.body.canImport, true);
  assert.equal(financePreview.body.records.length, 3);
  const financeImport = await post(`/events/${financeEvent.id}/finance/import`, { csv: "category,description,expected,actual,payee,date\nvenue,Venue,500,500,Studio,2026-09-25\nstaff,DJ,200,200,DJ,2026-09-25\nrefund,Refund,100,100,Battler,2026-09-25", staff: STAFF });
  assert.equal(financeImport.status, 201);
  assert.equal(financeImport.body.report.actual.netProfit, -680);
  const closeBeforeReview = await post(`/events/${financeEvent.id}/finance/close`, { staff: STAFF });
  assert.equal(closeBeforeReview.status, 409, "Closing requires an explicit final review");
  const financeReview = await post(`/events/${financeEvent.id}/finance/review`, { notes: "Counted with the event lead", staff: STAFF });
  assert.equal(financeReview.status, 200);
  assert.equal(financeReview.body.status, "review");
  const financeClose = await post(`/events/${financeEvent.id}/finance/close`, { staff: STAFF });
  assert.equal(financeClose.status, 200);
  assert.equal(financeClose.body.status, "closed");
  const closedEvent = await request(`/events/${financeEvent.id}`);
  assert.equal(closedEvent.body.lifecycle.status, "completed");
  const blockedClosedEntry = await post(`/events/${financeEvent.id}/finance/transactions`, { category: "other_cost", description: "Late cost", actualAmount: 10, staff: STAFF });
  assert.equal(blockedClosedEntry.status, 409, "Closed finance records must not accept normal entries");
  const merchandise = financeClose.body.transactions.find((transaction) => transaction.description === "Shirts");
  const financeCorrection = await post(`/events/${financeEvent.id}/finance/corrections`, { transactionId: merchandise.id, correctedActualAmount: 100, reason: "Final cash count", staff: STAFF });
  assert.equal(financeCorrection.status, 201);
  assert.equal(financeCorrection.body.correction.actualAmount, -20);
  assert.equal(financeCorrection.body.report.actual.netProfit, -700);
  assert.equal(financeCorrection.body.report.transactions.find((transaction) => transaction.id === merchandise.id).actualAmount, 120, "Correction must preserve the original transaction");
  const financeCsv = await requestText(`/events/${financeEvent.id}/exports/finance.csv`);
  assert.equal(financeCsv.status, 200);
  assert.match(financeCsv.body, /Gross Revenue/);
  authToken = generalFinanceToken;
  const reopenDenied = await post(`/events/${financeEvent.id}/finance/reopen`, { reason: "Need another pass", staff: { name: "Read Only", role: "General staff" } });
  assert.equal(reopenDenied.status, 403, "Only an Event lead can reopen a closed financial record");
  authToken = eventLeadTokenForFinance;
  const financeReopen = await post(`/events/${financeEvent.id}/finance/reopen`, { reason: "Add the final venue invoice", staff: STAFF });
  assert.equal(financeReopen.status, 200);
  assert.equal(financeReopen.body.status, "open");
  assert.equal((await request(`/events/${financeEvent.id}`)).body.lifecycle.status, "active");

  const judgingEvent = await createEvent("Judge workflow regression");
  const judgingEntries = [];
  for (let index = 1; index <= 9; index += 1) {
    const entry = await post(`/events/${judgingEvent.id}/registrations`, { bracket: "under15", entryName: `Judge entry ${index}`, staff: STAFF });
    assert.equal(entry.status, 201);
    judgingEntries.push(entry.body);
  }
  await checkInAll(judgingEvent.id, judgingEntries, "under15", 1);
  const judgingOrder = await post(`/events/${judgingEvent.id}/prelim-order`, { bracket: "under15", staff: STAFF });
  assert.equal(judgingOrder.status, 200);
  const eventLeadToken = authToken;
  const candDooToken = await loginAs({ name: "Jay-K", role: "Judge" });
  const kanoToken = await loginAs({ name: "Kano", role: "Judge" });
  const unassignedToken = await loginAs({ name: "Not Assigned", role: "Judge" });
  authToken = unassignedToken;
  assert.equal((await request(`/events/${judgingEvent.id}/judging/under15/session`)).status, 403, "Only assigned judge devices can open a judge sheet");
  authToken = candDooToken;
  const judgeSession = await request(`/events/${judgingEvent.id}/judging/under15/session`);
  assert.equal(judgeSession.status, 200);
  assert.equal(judgeSession.body.judge.judgeName, "Jay-K");
  assert.equal(judgeSession.body.current.title, "Judge entry 1");
  const invalidJudgeScore = await post(`/events/${judgingEvent.id}/judging/under15/score`, { registrationId: judgeSession.body.current.id, score: 11, state: "draft", expectedUpdatedAt: judgeSession.body.current.updatedAt });
  assert.equal(invalidJudgeScore.status, 400, "The judge scale is validated by the server");
  const judgeDraft = await post(`/events/${judgingEvent.id}/judging/under15/score`, { registrationId: judgeSession.body.current.id, score: 8, state: "draft", expectedUpdatedAt: judgeSession.body.current.updatedAt });
  assert.equal(judgeDraft.status, 200);
  assert.equal(judgeDraft.body.score.state, "draft");
  const judgeSubmitted = await post(`/events/${judgingEvent.id}/judging/under15/score`, { registrationId: judgeSession.body.current.id, score: 8, state: "submitted", expectedUpdatedAt: judgeDraft.body.registration.updatedAt });
  assert.equal(judgeSubmitted.status, 200);
  assert.equal(judgeSubmitted.body.score.state, "submitted");
  authToken = eventLeadToken;
  const monitor = await request(`/events/${judgingEvent.id}/judging/under15/status`);
  assert.equal(monitor.status, 200);
  assert.equal(monitor.body.entries[0].scores[0].state, "submitted");
  assert.equal(Object.hasOwn(monitor.body.entries[0].scores[0], "score"), false, "Staff monitoring does not expose judge score values");
  authToken = kanoToken;
  const secondJudgeSession = await request(`/events/${judgingEvent.id}/judging/under15/session`);
  const secondJudgeSubmit = await post(`/events/${judgingEvent.id}/judging/under15/score`, { registrationId: secondJudgeSession.body.current.id, score: 6, state: "submitted", expectedUpdatedAt: secondJudgeSession.body.current.updatedAt });
  assert.equal(secondJudgeSubmit.status, 200);
  assert.equal(secondJudgeSubmit.body.score.state, "locked", "All submitted scores lock together");
  authToken = candDooToken;
  const lockedReentry = await post(`/events/${judgingEvent.id}/judging/under15/score`, { registrationId: secondJudgeSession.body.current.id, score: 9, state: "draft", expectedUpdatedAt: secondJudgeSubmit.body.registration.updatedAt });
  assert.equal(lockedReentry.status, 409, "Judges cannot edit after the score locks");
  authToken = unassignedToken;
  const unauthorizedCorrection = await post(`/events/${judgingEvent.id}/judging/under15/corrections`, { registrationId: secondJudgeSession.body.current.id, judgeNumber: 1, score: 9, reason: "Typo", expectedUpdatedAt: secondJudgeSubmit.body.registration.updatedAt });
  assert.equal(unauthorizedCorrection.status, 403, "Only an Event lead can correct a locked score");
  authToken = eventLeadToken;
  const correctedScore = await post(`/events/${judgingEvent.id}/judging/under15/corrections`, { registrationId: secondJudgeSession.body.current.id, judgeNumber: 1, score: 9, reason: "Judge confirmed the intended score", expectedUpdatedAt: secondJudgeSubmit.body.registration.updatedAt });
  assert.equal(correctedScore.status, 200);
  assert.equal(correctedScore.body.registration.scores.average, 7.5);
  const judgingAudit = await request(`/events/${judgingEvent.id}/judging/under15/audit`);
  assert.equal(judgingAudit.status, 200);
  assert.ok(judgingAudit.body.entries.some((entry) => entry.action === "correct_locked_judge_score"));
  assert.equal(Object.hasOwn(judgingAudit.body.entries.find((entry) => entry.action === "correct_locked_judge_score").details, "score"), false, "The judge audit endpoint redacts score values for status review");
  authToken = eventLeadToken;

  const malformedEvent = await post("/events", { name: "Malformed event", judges: "not-an-array", staff: STAFF });
  assert.equal(malformedEvent.status, 400, "Event creation must reject a non-array judges value");
  const bracketEvent = await createEvent("Bracket regression");
  assert.equal(bracketEvent.location, "Tokyo, Japan");
  assert.equal(bracketEvent.timeZone, "Asia/Tokyo");
  const scheduledBracketEvent = await patch(`/events/${bracketEvent.id}`, { location: "Shibuya, Tokyo", timeZone: "Asia/Tokyo", prelimsStartTime: "2026-09-20T01:00:00.000Z", staff: STAFF });
  assert.equal(scheduledBracketEvent.status, 200);
  assert.equal(scheduledBracketEvent.body.location, "Shibuya, Tokyo");
  const malformedBackup = await post(`/events/${bracketEvent.id}/backups`, { reason: { not: "text" }, staff: STAFF });
  assert.equal(malformedBackup.status, 400, "Backups must reject non-text reasons before they reach the audit log");
  const malformedImport = await post(`/events/${bracketEvent.id}/import`, { bracket: "2v2", csv: { not: "csv" }, staff: STAFF });
  assert.equal(malformedImport.status, 400, "CSV imports must reject non-text input");
  const teamsCsv = "No,Team Name,Member Names,Genre\n1,Seed 1,One A / One B,Freestyle\n2,Seed 2,Two A / Two B,Freestyle\n3,Seed 3,Three A / Three B,Freestyle\n4,Seed 4,Four A / Four B,Freestyle";
  const importedTeams = await post(`/events/${bracketEvent.id}/import`, { bracket: "2v2", csv: teamsCsv, staff: STAFF });
  assert.equal(importedTeams.status, 201);
  assert.deepEqual(importedTeams.body.registrations.map((registration) => registration.displayCode), ["CC-0001", "CC-0002", "CC-0003", "CC-0004"]);
  const malformedRankOverride = await post(`/events/${bracketEvent.id}/rankings/override`, { bracket: "2v2", registrationId: importedTeams.body.registrations[0].id, rank: 1, reason: { not: "text" }, staff: STAFF });
  assert.equal(malformedRankOverride.status, 400, "Rank overrides must reject non-text reasons");
  const malformedRegistration = await post(`/events/${bracketEvent.id}/registrations`, { bracket: "under15", entryName: "Malformed registration", instagramMembers: "not-an-array", staff: STAFF });
  assert.equal(malformedRegistration.status, 400, "Registration creation must reject malformed array fields");
  const malformedUpdate = await patch(`/events/${bracketEvent.id}/registrations/${importedTeams.body.registrations[0].id}`, { reviewReasons: "not-an-array", expectedUpdatedAt: importedTeams.body.registrations[0].updatedAt, staff: STAFF });
  assert.equal(malformedUpdate.status, 400, "Registration edits must reject malformed array fields");
  const unchangedRegistration = await request(`/events/${bracketEvent.id}/registrations/${importedTeams.body.registrations[0].id}`);
  assert.deepEqual(unchangedRegistration.body.reviewReasons, [], "Rejected registration edits must not mutate saved data");
  await checkInAll(bracketEvent.id, importedTeams.body.registrations, "2v2");
  const createdBracket = await post(`/events/${bracketEvent.id}/bracket`, { bracket: "2v2", staff: STAFF });
  assert.equal(createdBracket.status, 201);
  const publicDisplay = await requestPublicDisplay(bracketEvent.id, "2v2");
  assert.equal(publicDisplay.status, 200, "The audience display must be readable without a staff session");
  assert.equal(publicDisplay.body.event.name, "Bracket regression");
  assert.equal(publicDisplay.body.entries.length, 4);
  assert.equal(publicDisplay.body.entries[0].email, undefined, "The audience display must not include registration contact data");
  assert.equal(publicDisplay.body.bracket.rounds[0].matches.length, createdBracket.body.rounds[0].matches.length);
  assert.equal(publicDisplay.body.projection.phase, "bracket", "The display projection identifies the playable bracket phase");
  assert.equal(publicDisplay.body.projection.current.state, "ready", "The display projection starts with a ready matchup");
  assert.equal(publicDisplay.body.projection.current.sideA.email, undefined, "The current display matchup does not expose private registration fields");
  assert.equal(publicDisplay.body.projection.current.score.kind, "pending", "The current display matchup identifies an unscored battle without leaking votes");
  const missingPublicDisplay = await requestPublicDisplay("event_missing", "2v2");
  assert.equal(missingPublicDisplay.status, 404, "Missing audience displays must not reveal another event");
  const duplicateBracket = await post(`/events/${bracketEvent.id}/bracket`, { bracket: "2v2", staff: STAFF });
  assert.equal(duplicateBracket.status, 400, "A generated bracket must not be silently replaced");
  const lateBracketEntry = await post(`/events/${bracketEvent.id}/registrations`, { bracket: "2v2", teamName: "Late Bracket Entry", memberNames: "Late A / Late B", staff: STAFF });
  const lateBracketCheckIn = await post(`/events/${bracketEvent.id}/registrations/${lateBracketEntry.body.id}/check-in`, { memberIndex: 0, staff: STAFF });
  assert.equal(lateBracketCheckIn.status, 400, "A late battler cannot be silently excluded after bracket generation");
  const cancelBracketParticipant = await post(`/events/${bracketEvent.id}/registrations/${importedTeams.body.registrations[0].id}/cancel`, { staff: STAFF });
  assert.equal(cancelBracketParticipant.status, 400, "Bracket participants cannot be canceled in place");
  const firstRound = createdBracket.body.rounds[0];
  assert.ok(firstRound.matches.every((match) => !match.winnerId), "Two-sided matches must not auto-advance as byes");
  const [matchOne, matchTwo] = firstRound.matches;
  const malformedDecision = await post(`/events/${bracketEvent.id}/bracket/2v2/matches/${matchOne.id}/decision`, { outcome: { not: "an id" }, staff: STAFF });
  assert.equal(malformedDecision.status, 400, "Bracket decisions must reject malformed outcome payloads");
  const prematureDecision = await post(`/events/${bracketEvent.id}/bracket/2v2/matches/${matchOne.id}/decision`, { outcome: matchOne.sideA, staff: STAFF });
  assert.equal(prematureDecision.status, 400, "A result cannot be recorded before the performance round finishes");
  await completeRound(bracketEvent.id, "2v2", matchOne.id);
  const decisionOne = await post(`/events/${bracketEvent.id}/bracket/2v2/matches/${matchOne.id}/decision`, { outcome: matchOne.sideA, staff: STAFF });
  assert.equal(decisionOne.status, 200);
  const afterFirstDecision = await request(`/events/${bracketEvent.id}/bracket/2v2`);
  assert.equal(afterFirstDecision.body.rounds[1].matches[0].sideA, matchOne.sideA);
  assert.equal(afterFirstDecision.body.rounds[1].matches[0].winnerId, null, "A final cannot auto-advance while the other semifinal is pending");
  await completeRound(bracketEvent.id, "2v2", matchTwo.id);
  const decisionTwo = await post(`/events/${bracketEvent.id}/bracket/2v2/matches/${matchTwo.id}/decision`, { outcome: matchTwo.sideB, staff: STAFF });
  assert.equal(decisionTwo.status, 200);
  const readyFinal = await request(`/events/${bracketEvent.id}/bracket/2v2`);
  assert.equal(readyFinal.body.rounds[1].matches[0].winnerId, null);
  assert.ok(readyFinal.body.rounds[1].matches[0].sideA && readyFinal.body.rounds[1].matches[0].sideB, "Both semifinal winners should reach the final");
  const finalMatch = readyFinal.body.rounds[1].matches[0];
  const firstFinalRound = await completeRound(bracketEvent.id, "2v2", finalMatch.id);
  assert.equal(firstFinalRound.performanceRoundsCompleted, 1);
  const stillPrematureFinal = await post(`/events/${bracketEvent.id}/bracket/2v2/matches/${finalMatch.id}/decision`, { outcome: finalMatch.sideA, staff: STAFF });
  assert.equal(stillPrematureFinal.status, 400, "The final requires both performance rounds");
  const secondFinalRound = await completeRound(bracketEvent.id, "2v2", finalMatch.id);
  assert.equal(secondFinalRound.performanceRoundsCompleted, 2);
  const finalDecision = await post(`/events/${bracketEvent.id}/bracket/2v2/matches/${finalMatch.id}/decision`, { outcome: finalMatch.sideA, staff: STAFF });
  assert.equal(finalDecision.status, 200);
  const unsafeReplacement = await post(`/events/${bracketEvent.id}/bracket`, { bracket: "2v2", replace: true, staff: STAFF });
  assert.equal(unsafeReplacement.status, 400, "A bracket with results must not be replaced");
  const duplicateDecision = await post(`/events/${bracketEvent.id}/bracket/2v2/matches/${matchOne.id}/decision`, { outcome: matchOne.sideA, staff: STAFF });
  assert.equal(duplicateDecision.status, 400, "A completed match cannot be overwritten without undo");
  const undoneDecision = await post(`/events/${bracketEvent.id}/bracket/2v2/matches/${matchOne.id}/undo-decision`, { staff: STAFF });
  assert.equal(undoneDecision.status, 200);
  const afterUndo = await request(`/events/${bracketEvent.id}/bracket/2v2`);
  assert.equal(afterUndo.body.rounds[1].matches[0].sideA, null, "Undo must remove the advanced entrant");
  assert.equal(afterUndo.body.rounds[1].matches[0].winnerId, null, "Undo must also clear a downstream final result");
  const bracketUndoAudit = await request(`/events/${bracketEvent.id}`);
  const reversedDecisionAudit = bracketUndoAudit.body.auditLog.filter((entry) => entry.action === "decide_bracket_match" && entry.targetId === matchOne.id).at(-1);
  const undoDecisionAudit = bracketUndoAudit.body.auditLog.filter((entry) => entry.action === "undo_bracket_decision" && entry.targetId === matchOne.id).at(-1);
  assert.equal(undoDecisionAudit.details.reversalOfAuditId, reversedDecisionAudit.id, "Undo must explicitly reference the audit entry it reverses");

  const byeEvent = await createEvent("True bye regression");
  const sixTeamsCsv = "No,Team Name,Member Names,Genre\n1,Seed 1,One A / One B,F\n2,Seed 2,Two A / Two B,F\n3,Seed 3,Three A / Three B,F\n4,Seed 4,Four A / Four B,F\n5,Seed 5,Five A / Five B,F\n6,Seed 6,Six A / Six B,F";
  const importedSixTeams = await post(`/events/${byeEvent.id}/import`, { bracket: "2v2", csv: sixTeamsCsv, staff: STAFF });
  await checkInAll(byeEvent.id, importedSixTeams.body.registrations, "2v2");
  const sixTeamBracket = await post(`/events/${byeEvent.id}/bracket`, { bracket: "2v2", staff: STAFF });
  const sixTeamFirstRound = sixTeamBracket.body.rounds[0].matches;
  assert.ok(sixTeamFirstRound.filter((match) => Boolean(match.sideA) !== Boolean(match.sideB)).every((match) => match.decisionMethod === "bye"), "Only one-sided first-round matches should become byes");
  assert.ok(sixTeamFirstRound.filter((match) => match.sideA && match.sideB).every((match) => !match.winnerId), "Two-sided first-round matches must remain undecided");
  assert.ok(sixTeamBracket.body.rounds[1].matches.every((match) => !match.winnerId), "A later round cannot auto-advance while a feeder match is pending");

  const prelimEvent = await createEvent("Prelim qualification regression");
  assert.deepEqual(prelimEvent.judgesByDivision, { "2v2": ["CanDoo", "D.MYST"], under15: ["Jay-K", "Kano"] });
  const names = Array.from({ length: 9 }, (_, index) => `${index + 1},,Battler ${index + 1},Freestyle`).join("\n");
  const battlersCsv = `No,Team Name,Entry Name,Genre\n${names}`;
  const importedBattlers = await post(`/events/${prelimEvent.id}/import`, { bracket: "under15", csv: battlersCsv, staff: STAFF });
  assert.equal(importedBattlers.status, 201);
  await checkInAll(prelimEvent.id, importedBattlers.body.registrations, "under15");
  const prelimOrder = await post(`/events/${prelimEvent.id}/prelim-order`, { bracket: "under15", staff: STAFF });
  assert.equal(prelimOrder.status, 200);
  const kidsDisplayResponse = await requestPublicDisplay(prelimEvent.id, "under15");
  const kidsDisplay = kidsDisplayResponse.body.prelim;
  assert.equal(kidsDisplay.status, "active");
  assert.equal(kidsDisplay.current.sideA.number, "1");
  assert.equal(kidsDisplay.current.sideB.number, "2");
  assert.equal(kidsDisplay.onDeck.sideA.number, "3");
  assert.equal(kidsDisplay.onDeck.sideB.number, "4");
  assert.equal(kidsDisplay.activeSide, "A");
  assert.equal(kidsDisplay.timer.durationSeconds, 90);
  assert.deepEqual(Object.keys(kidsDisplay.current.sideA).sort(), ["id", "name", "number"], "Public prelim entries expose no scores, staff or payment details");
  assert.equal(kidsDisplayResponse.body.projection.phase, "prelims", "The display projection identifies the active prelim phase");
  assert.equal(kidsDisplayResponse.body.projection.current.position, "Battle 1 of 5");
  assert.equal(kidsDisplayResponse.body.projection.onDeck.position, "Battle 2 of 5");
  assert.equal((await request(`/events/${prelimEvent.id}/handoff/under15`)).status, 400, "Unfinished performances block handoff");
  assert.deepEqual(prelimOrder.body.map((registration) => registration.sourceNumber), ["1", "2", "3", "4", "5", "6", "7", "8", "9"], "Prelims must follow imported entry numbers");
  const reRandomize = await post(`/events/${prelimEvent.id}/prelim-order`, { bracket: "under15", staff: STAFF });
  assert.equal(reRandomize.status, 400, "Prelim order must remain fixed after it is locked");
  const lateBattler = await post(`/events/${prelimEvent.id}/registrations`, { bracket: "under15", entryName: "Late Battler", staff: STAFF });
  assert.equal(lateBattler.status, 201);
  assert.equal(lateBattler.body.sourceNumber, "10", "Walk-in numbers follow the imported numbers");
  const lateCheckIn = await post(`/events/${prelimEvent.id}/registrations/${lateBattler.body.id}/check-in`, { memberIndex: 0, staff: STAFF });
  assert.equal(lateCheckIn.status, 200);
  const afterLateArrival = await request(`/events/${prelimEvent.id}`);
  assert.equal(afterLateArrival.body.registrations.find((registration) => registration.id === lateBattler.body.id).prelimOrder, 10, "A fully checked-in late arrival appends to the locked prelim order");
  const noScores = await post(`/events/${prelimEvent.id}/bracket`, { bracket: "under15", staff: STAFF });
  assert.equal(noScores.status, 400, "A prelim bracket requires every eligible battler to be scored");
  const scoreBoundaryEntry = importedBattlers.body.registrations[0];
  const progressPath = `/events/${prelimEvent.id}/prelim-progress`;
  const oldRevision = eventRevisions.get(prelimEvent.id);
  const firstSide = await post(progressPath, { bracket: "under15", action: "next", staff: STAFF });
  assert.equal(firstSide.status, 200);
  assert.equal(firstSide.body.currentEntryIndex, 1, "Team B follows Team A");
  assert.equal((await requestPublicDisplay(prelimEvent.id, "under15")).body.prelim.activeSide, "B");
  const duplicateAdvance = await post(progressPath, { bracket: "under15", action: "next", staff: STAFF }, { expectedRevision: oldRevision });
  assert.equal(duplicateAdvance.status, 409, "A stale device cannot skip a performance");
  const live = await request(`/events/${prelimEvent.id}`);
  const prelimTimer = live.body.timers.prelims.under15;
  assert.equal(prelimTimer.remainingSeconds, 90);
  const running = await post(`/events/${prelimEvent.id}/timers/prelims/under15`, { action: "start", expectedTimerVersion: prelimTimer.version, staff: STAFF });
  assert.equal(running.status, 200);
  assert.equal((await post(progressPath, { bracket: "under15", action: "next", staff: STAFF })).status, 400);
  await post(`/events/${prelimEvent.id}/timers/prelims/under15`, { action: "pause", expectedTimerVersion: running.body.version, staff: STAFF });
  for (let index = 2; index <= 10; index++) {
    const advanced = await post(progressPath, { bracket: "under15", action: "next", staff: STAFF });
    assert.equal(advanced.status, 200);
    assert.equal(advanced.body.currentEntryIndex, index);
  }
  assert.equal((await post(progressPath, { bracket: "under15", action: "next", staff: STAFF })).status, 400);
  const reopened = await post(progressPath, { bracket: "under15", action: "previous", staff: STAFF });
  assert.equal(reopened.body.currentEntryIndex, 9, "An accidental finish can be reversed");
  await post(progressPath, { bracket: "under15", action: "next", staff: STAFF });
  const completed = await request(`/events/${prelimEvent.id}`);
  assert.equal(completed.body.prelimOrders.under15.currentEntryIndex, 10);
  assert.equal(completed.body.timers.prelims.under15.remainingSeconds, 90);
  assert.equal(completed.body.timers.prelims.under15.status, "idle");
  const finishedDisplay = (await requestPublicDisplay(prelimEvent.id, "under15")).body.prelim;
  assert.equal(finishedDisplay.status, "complete");
  assert.equal(finishedDisplay.current, null);
  assert.equal(finishedDisplay.onDeck, null);
  await saveScore(prelimEvent.id, scoreBoundaryEntry, 1, 10);
  await saveScore(prelimEvent.id, scoreBoundaryEntry, 2, 10);
  assert.equal(scoreBoundaryEntry.scores.average, 10);
  for (const score of [0, 11, 1.5, "10"]) {
    const invalid = await post(`/events/${prelimEvent.id}/registrations/${scoreBoundaryEntry.id}/scores`, { judgeNumber: 1, score, expectedUpdatedAt: scoreBoundaryEntry.updatedAt, staff: STAFF });
    assert.equal(invalid.status, 400, "Only whole-number scores from 1 to 10 are accepted");
  }
  for (const registration of importedBattlers.body.registrations) {
    await saveScore(prelimEvent.id, registration, 1, 4);
    await saveScore(prelimEvent.id, registration, 2, 4);
  }
  await post(`/events/${prelimEvent.id}/rankings`, { bracket: "under15", staff: STAFF });
  const incompleteScores = await post(`/events/${prelimEvent.id}/bracket`, { bracket: "under15", staff: STAFF });
  assert.equal(incompleteScores.status, 400, "Nine scores cannot qualify a ten-battler prelim");
  assert.equal((await request(`/events/${prelimEvent.id}/handoff/under15`)).status, 400, "Missing scores block handoff");
  Object.assign(lateBattler.body, lateCheckIn.body.registration);
  await saveScore(prelimEvent.id, lateBattler.body, 1, 4);
  await saveScore(prelimEvent.id, lateBattler.body, 2, 4);
  const rankings = await post(`/events/${prelimEvent.id}/rankings`, { bracket: "under15", staff: STAFF });
  assert.equal(rankings.status, 200);
  const unresolvedTie = await post(`/events/${prelimEvent.id}/bracket`, { bracket: "under15", staff: STAFF });
  assert.equal(unresolvedTie.status, 400, "A tie spanning the qualification cutoff requires a tie-break result");
  assert.equal((await request(`/events/${prelimEvent.id}/handoff/under15`)).status, 400, "Cutoff ties block handoff");
  const tieBreak = await post(`/events/${prelimEvent.id}/prelim-tiebreak`, { bracket: "under15", registrationIds: rankings.body.map((registration) => registration.id), staff: STAFF });
  assert.equal(tieBreak.status, 200);
  const handoffBefore = await request(`/events/${prelimEvent.id}`);
  const handoff = await request(`/events/${prelimEvent.id}/handoff/under15`);
  assert.equal(handoff.status, 200);
  assert.equal(handoff.body.cutoff, 8);
  assert.equal(handoff.body.entries.length, 8);
  assert.deepEqual((await request(`/events/${prelimEvent.id}`)).body, handoffBefore.body, "Preparing handoff does not mutate event data");
  const qualifiedBracket = await post(`/events/${prelimEvent.id}/bracket`, { bracket: "under15", staff: STAFF });
  assert.equal(qualifiedBracket.status, 201);
  assert.equal(qualifiedBracket.body.participantIds.length, 8);
  const frozenScore = await post(`/events/${prelimEvent.id}/registrations/${importedBattlers.body.registrations[0].id}/scores`, { judgeNumber: 1, score: 5, expectedUpdatedAt: importedBattlers.body.registrations[0].updatedAt, staff: STAFF });
  assert.equal(frozenScore.status, 400, "Prelim scores cannot change after bracket generation");
  const frozenRankings = await post(`/events/${prelimEvent.id}/rankings`, { bracket: "under15", staff: STAFF });
  assert.equal(frozenRankings.status, 400, "Prelim rankings cannot change after bracket generation");
  const frozenOverride = await post(`/events/${prelimEvent.id}/rankings/override`, { bracket: "under15", registrationId: importedBattlers.body.registrations[0].id, rank: 1, reason: "Regression freeze check", staff: STAFF });
  assert.equal(frozenOverride.status, 400, "Rank corrections cannot change after bracket generation");

  const operatorEvent = await createEvent("Operator tie replay regression");
  const top16Event = await createEvent("2v2 Top 16 handoff");
  const judgeConfig = { "2v2": ["CanDoo", "D.MYST"], under15: ["Jay-K", "Kano"] };
  assert.equal((await patch(`/events/${top16Event.id}`, { judgesByDivision: { under15: ["Only one"] }, staff: STAFF })).status, 400);
  assert.equal((await patch(`/events/${top16Event.id}`, { judgesByDivision: judgeConfig, staff: STAFF })).status, 200);
  assert.deepEqual((await request(`/events/${top16Event.id}`)).body.judgesByDivision, judgeConfig);
  const top16Import = await post(`/events/${top16Event.id}/import`, { bracket: "2v2", csv: "No,Team Name,Member Names,Genre\n" + Array.from({ length: 17 }, (_, i) => `${i + 1},Team ${i + 1},A${i} / B${i},Hip hop`).join("\n"), staff: STAFF });
  assert.equal(top16Import.status, 201);
  await checkInAll(top16Event.id, top16Import.body.registrations, "2v2");
  assert.equal((await request(`/events/${top16Event.id}/handoff/2v2`)).status, 400);
  assert.equal((await post(`/events/${top16Event.id}/prelim-order`, { bracket: "2v2", staff: STAFF })).status, 200);
  for (const entry of top16Import.body.registrations) {
    const visible = (await requestPublicDisplay(top16Event.id, "2v2")).body.prelim;
    assert.equal(visible.status, "active");
    if (entry.sourceNumber === "17") {
      assert.equal(visible.current.sideA.number, "17");
      assert.equal(visible.current.sideB, null, "Odd final entry has no invented opponent");
      assert.equal(visible.onDeck, null);
    }
    assert.equal((await post(`/events/${top16Event.id}/prelim-progress`, { bracket: "2v2", action: "next", staff: STAFF })).status, 200);
    await saveScore(top16Event.id, entry, 1, entry.sourceNumber === "17" ? 1 : 10);
    await saveScore(top16Event.id, entry, 2, entry.sourceNumber === "17" ? 1 : 10);
  }
  const top16Handoff = await request(`/events/${top16Event.id}/handoff/2v2`);
  assert.equal(top16Handoff.status, 200);
  assert.equal(top16Handoff.body.entries.length, 16);
  assert.equal(top16Handoff.body.cutoff, 16);
  assert.ok(top16Handoff.body.entries.every((entry) => entry.number !== "17"));
  assert.equal((await post(`/events/${top16Event.id}/rankings`, { bracket: "2v2", staff: STAFF })).status, 200);
  const top16Bracket = await post(`/events/${top16Event.id}/bracket`, { bracket: "2v2", staff: STAFF });
  assert.equal(top16Bracket.status, 201);
  assert.equal(top16Bracket.body.participantIds.length, 16);
  const numberedEvent = await createEvent("Imported numbers and pre-lock walk-ins");
  const reversedNumbers = ["020", "18", "16", "14", "12", "10", "8", "6", "4"];
  const numberedImport = await post(`/events/${numberedEvent.id}/import`, { bracket: "under15", csv: "No,Entry Name\n" + reversedNumbers.map((number) => `${number},Entry ${number}`).join("\n"), staff: STAFF });
  assert.deepEqual(numberedImport.body.registrations.map((entry) => entry.sourceNumber), reversedNumbers, "Import preserves gaps and leading zeroes exactly");
  const earlyWalkIn = await post(`/events/${numberedEvent.id}/registrations`, { bracket: "under15", entryName: "Walk-in before order lock", staff: STAFF });
  assert.equal(earlyWalkIn.body.sourceNumber, "21");
  await checkInAll(numberedEvent.id, [earlyWalkIn.body, ...numberedImport.body.registrations], "under15");
  const numberedOrder = await post(`/events/${numberedEvent.id}/prelim-order`, { bracket: "under15", staff: STAFF });
  assert.equal(numberedOrder.status, 200);
  assert.deepEqual(numberedOrder.body.map((entry) => entry.sourceNumber), ["4", "6", "8", "10", "12", "14", "16", "18", "020", "21"], "Arrival order cannot reorder the imported entries or move a walk-in ahead of them");
  const otherDivisionWalkIn = await post(`/events/${numberedEvent.id}/registrations`, { bracket: "2v2", teamName: "Other division", memberNames: "First / Second", staff: STAFF });
  assert.equal(otherDivisionWalkIn.body.sourceNumber, "1", "Each division has its own entry numbers");
  const operatorTeams = await post(`/events/${operatorEvent.id}/import`, { bracket: "2v2", csv: "No,Team Name,Member Names\n1,Operator A,A One / A Two\n2,Operator B,B One / B Two", staff: STAFF });
  await checkInAll(operatorEvent.id, operatorTeams.body.registrations, "2v2");
  const operatorBracket = await post(`/events/${operatorEvent.id}/bracket`, { bracket: "2v2", staff: STAFF });
  const operatorMatch = operatorBracket.body.rounds[0].matches[0];
  await completeRound(operatorEvent.id, "2v2", operatorMatch.id);
  await completeRound(operatorEvent.id, "2v2", operatorMatch.id);
  const tieReplay = await post(`/events/${operatorEvent.id}/bracket/2v2/matches/${operatorMatch.id}/decision`, { outcome: "tie", staff: STAFF });
  assert.equal(tieReplay.status, 200);
  assert.equal(tieReplay.body.winnerId, null);
  assert.equal(tieReplay.body.tieBreakActive, true);
  assert.equal(tieReplay.body.requiredPerformanceRounds, 1);
  const prematureReplayDecision = await post(`/events/${operatorEvent.id}/bracket/2v2/matches/${operatorMatch.id}/decision`, { outcome: operatorMatch.sideA, staff: STAFF });
  assert.equal(prematureReplayDecision.status, 400, "A tie replay requires its performance round before selecting a winner");
  const undoneTieReplay = await post(`/events/${operatorEvent.id}/bracket/2v2/matches/${operatorMatch.id}/undo-decision`, { staff: STAFF });
  assert.equal(undoneTieReplay.status, 200);
  assert.equal(undoneTieReplay.body.tieBreakActive, false);
  assert.equal(undoneTieReplay.body.performanceRoundsCompleted, 2, "Undoing a tie restores the previous completed rounds");
  const tieReplayAgain = await post(`/events/${operatorEvent.id}/bracket/2v2/matches/${operatorMatch.id}/decision`, { outcome: "tie", staff: STAFF });
  assert.equal(tieReplayAgain.status, 200);
  await completeRound(operatorEvent.id, "2v2", operatorMatch.id);
  const operatorDecision = await post(`/events/${operatorEvent.id}/bracket/2v2/matches/${operatorMatch.id}/decision`, { outcome: operatorMatch.sideB, staff: STAFF });
  assert.equal(operatorDecision.status, 200);
  assert.equal(operatorDecision.body.decisionMethod, "tie_break_operator_choice");
  assert.equal(operatorDecision.body.judgeVotes.length, 0, "Operator decisions do not require judge vote records");

  const syncEvent = await createEvent("Multi-device integrity regression");
  const syncRegistration = await post(`/events/${syncEvent.id}/registrations`, { bracket: "under15", entryName: "Shared Device Battler", email: "original@example.com", staff: STAFF });
  assert.equal(syncRegistration.status, 201);
  const sharedBaseRevision = eventRevisions.get(syncEvent.id);
  const firstDeviceEdit = await patch(`/events/${syncEvent.id}/registrations/${syncRegistration.body.id}`, { email: "device-one@example.com", expectedUpdatedAt: syncRegistration.body.updatedAt, staff: STAFF }, { expectedRevision: sharedBaseRevision });
  assert.equal(firstDeviceEdit.status, 200);
  const staleDeviceEdit = await patch(`/events/${syncEvent.id}/registrations/${syncRegistration.body.id}`, { email: "device-two@example.com", expectedUpdatedAt: syncRegistration.body.updatedAt, staff: STAFF }, { expectedRevision: sharedBaseRevision, captureRevision: false });
  assert.equal(staleDeviceEdit.status, 409, "A stale device must not overwrite a newer registration edit");
  assert.equal(staleDeviceEdit.body.code, "REVISION_CONFLICT");
  const staleEditorEdit = await patch(`/events/${syncEvent.id}/registrations/${syncRegistration.body.id}`, { email: "stale-editor@example.com", expectedUpdatedAt: syncRegistration.body.updatedAt, staff: STAFF });
  assert.equal(staleEditorEdit.status, 409, "An editor opened before a background sync must not overwrite the current registration");
  assert.equal(staleEditorEdit.body.code, "RESOURCE_CONFLICT");
  const missingRevisionEdit = await patch(`/events/${syncEvent.id}/registrations/${syncRegistration.body.id}`, { email: "missing-revision@example.com", expectedUpdatedAt: firstDeviceEdit.body.updatedAt, staff: STAFF }, { skipRevision: true, captureRevision: false });
  assert.equal(missingRevisionEdit.status, 428, "Protected writes require a known event revision");
  const syncStatus = await request(`/events/${syncEvent.id}/sync?after=${sharedBaseRevision}`);
  assert.equal(syncStatus.status, 200);
  assert.equal(syncStatus.body.changed, true);
  const snapshot = await request(`/events/${syncEvent.id}/snapshot`);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.revision, snapshot.body.event.revision);
  assert.equal(snapshot.body.registrations.find((registration) => registration.id === syncRegistration.body.id).email, "device-one@example.com");
  const simultaneousCheckInRevision = eventRevisions.get(syncEvent.id);
  const firstDeviceCheckIn = await post(`/events/${syncEvent.id}/registrations/${syncRegistration.body.id}/check-in`, { memberIndex: 0, staff: STAFF }, { expectedRevision: simultaneousCheckInRevision });
  assert.equal(firstDeviceCheckIn.status, 200);
  const secondDeviceCheckIn = await post(`/events/${syncEvent.id}/registrations/${syncRegistration.body.id}/check-in`, { memberIndex: 0, staff: STAFF }, { expectedRevision: simultaneousCheckInRevision, captureRevision: false });
  assert.equal(secondDeviceCheckIn.status, 409);
  assert.equal(secondDeviceCheckIn.body.code, "ALREADY_CHECKED_IN", "The second device sees Already checked in instead of double charging");
  const beforeCheckInUndo = await request(`/events/${syncEvent.id}`);
  const checkInAudit = beforeCheckInUndo.body.auditLog.filter((entry) => entry.action === "check_in" && entry.targetId === syncRegistration.body.id).at(-1);
  const undoneCheckIn = await post(`/events/${syncEvent.id}/registrations/${syncRegistration.body.id}/undo-check-in`, { memberIndex: 0, staff: STAFF });
  assert.equal(undoneCheckIn.status, 200);
  const afterCheckInUndo = await request(`/events/${syncEvent.id}`);
  const undoCheckInAudit = afterCheckInUndo.body.auditLog.filter((entry) => entry.action === "undo_check_in" && entry.targetId === syncRegistration.body.id).at(-1);
  assert.equal(undoCheckInAudit.details.reversalOfAuditId, checkInAudit.id, "Check-in undo must be an explicit audited reversal");
  const checkedInAgain = await post(`/events/${syncEvent.id}/registrations/${syncRegistration.body.id}/check-in`, { memberIndex: 0, staff: STAFF });
  assert.equal(checkedInAgain.status, 200);
  const spectatorBaseRevision = eventRevisions.get(syncEvent.id);
  const firstSpectator = await post(`/events/${syncEvent.id}/spectators`, { staff: STAFF }, { expectedRevision: spectatorBaseRevision });
  const secondSpectator = await post(`/events/${syncEvent.id}/spectators`, { staff: STAFF }, { expectedRevision: spectatorBaseRevision });
  assert.equal(firstSpectator.status, 200);
  assert.equal(secondSpectator.status, 200);
  assert.equal(secondSpectator.body.count, 2, "Merge-safe increments from two devices must both be preserved");
  const undoPath = `/events/${syncEvent.id}/spectators/undo`;
  const staleUndo = await post(undoPath, { auditId: firstSpectator.body.undoAuditId, staff: STAFF });
  assert.equal(staleUndo.status, 409, "A new addition must be reviewed before undoing");
  const undoPayload = { auditId: secondSpectator.body.undoAuditId, staff: STAFF };
  const undoResults = await Promise.all([post(undoPath, undoPayload), post(undoPath, undoPayload)]);
  assert.ok(undoResults.every((result) => result.status === 200));
  const afterSpectatorUndo = await request(`/events/${syncEvent.id}`);
  assert.deepEqual(afterSpectatorUndo.body.spectators, { count: 1, entryMoney: 2000, drinkMoney: 700, undoAuditId: firstSpectator.body.undoAuditId });
  const reversals = afterSpectatorUndo.body.auditLog.filter((entry) => entry.action === "undo_spectator");
  assert.equal(reversals.length, 1, "Concurrent undo retries reverse the same addition only once");
  assert.equal(reversals[0].details.reversalOfAuditId, secondSpectator.body.undoAuditId);
  const lastUndo = await post(undoPath, { auditId: firstSpectator.body.undoAuditId, staff: STAFF });
  assert.deepEqual(lastUndo.body, { count: 0, entryMoney: 0, drinkMoney: 0, undoAuditId: null });
  assert.equal((await post(undoPath, { staff: STAFF })).status, 400);
  assert.equal((await post(undoPath, { auditId: "nonexistent", staff: STAFF })).status, 400);
  const zeroTotals = await request(`/events/${syncEvent.id}/report`);
  assert.equal(zeroTotals.body.cashByCategory.spectator.total, 0);
  const thirdSpectator = await post(`/events/${syncEvent.id}/spectators`, { staff: STAFF });
  assert.equal(thirdSpectator.body.count, 1);
  const repeatedOldUndo = await post(undoPath, undoPayload);
  assert.equal(repeatedOldUndo.body.count, 1, "Retrying an old undo cannot remove a newly added spectator");
  await post(undoPath, { auditId: thirdSpectator.body.undoAuditId, staff: STAFF });
  const startedTimer = await post(`/events/${syncEvent.id}/timers/bracket/under15`, { action: "start", expectedTimerVersion: 0, staff: STAFF });
  assert.equal(startedTimer.status, 200);
  assert.equal(startedTimer.body.status, "running");
  assert.equal(startedTimer.body.version, 1);
  const staleTimerCommand = await post(`/events/${syncEvent.id}/timers/bracket/under15`, { action: "reset", expectedTimerVersion: 0, staff: STAFF }, { captureRevision: false });
  assert.equal(staleTimerCommand.status, 409, "Two devices cannot silently overwrite shared timer controls");
  assert.equal(staleTimerCommand.body.code, "TIMER_CONFLICT");
  const pausedTimer = await post(`/events/${syncEvent.id}/timers/bracket/under15`, { action: "pause", expectedTimerVersion: 1, staff: STAFF });
  assert.equal(pausedTimer.status, 200);
  assert.equal(pausedTimer.body.status, "paused");
  assert.equal(pausedTimer.body.version, 2);

  const backupEvent = await createEvent("Backup restore regression");
  const backupRegistration = await post(`/events/${backupEvent.id}/registrations`, { bracket: "under15", entryName: "Original Backup Name", email: "before@example.com", staff: STAFF });
  assert.equal(backupRegistration.status, 201);
  const createdBackup = await post(`/events/${backupEvent.id}/backups`, { reason: "Before test edit", staff: STAFF });
  assert.equal(createdBackup.status, 201);
  assert.equal(createdBackup.body.backup.kind, "manual");
  const backupsBeforeRestore = await request(`/events/${backupEvent.id}/backups`);
  assert.equal(backupsBeforeRestore.status, 200);
  assert.equal(backupsBeforeRestore.body.backups.length, 1);
  const changedRegistration = await patch(`/events/${backupEvent.id}/registrations/${backupRegistration.body.id}`, { entryName: "Changed After Backup", email: "after@example.com", expectedUpdatedAt: backupRegistration.body.updatedAt, staff: STAFF });
  assert.equal(changedRegistration.status, 200);
  const restoredBackup = await post(`/events/${backupEvent.id}/backups/${createdBackup.body.backup.backupId}/restore`, { staff: STAFF });
  assert.equal(restoredBackup.status, 200);
  assert.equal(restoredBackup.body.event.registrations.find((registration) => registration.id === backupRegistration.body.id).entryName, "Original Backup Name");
  assert.equal(restoredBackup.body.safetyBackup.kind, "pre_restore");
  assert.ok(restoredBackup.body.event.auditLog.some((entry) => entry.action === "edit_registration"), "Restoring state must preserve the current audit trail");
  assert.ok(restoredBackup.body.event.auditLog.some((entry) => entry.action === "restore_event_backup"));
  const backupsAfterRestore = await request(`/events/${backupEvent.id}/backups`);
  assert.equal(backupsAfterRestore.status, 200);
  assert.equal(backupsAfterRestore.body.backups.length, 2, "Restore creates a safety backup before replacing state");
  const corruptBackup = await post(`/events/${backupEvent.id}/backups`, { reason: "Corruption check", staff: STAFF });
  const corruptPath = path.join(backupDirectory, backupEvent.id, `${corruptBackup.body.backup.backupId}.json`);
  const corruptFile = JSON.parse(fs.readFileSync(corruptPath, "utf8")); corruptFile.event.name = "Tampered backup"; fs.writeFileSync(corruptPath, JSON.stringify(corruptFile));
  const corruptRestore = await post(`/events/${backupEvent.id}/backups/${corruptBackup.body.backup.backupId}/restore`, { staff: STAFF });
  assert.equal(corruptRestore.status, 400, "A backup with a failed integrity digest cannot be restored");

  const cashEvent = await createEvent("Cross-division cash regression");
  const cashTeams = await post(`/events/${cashEvent.id}/import`, { bracket: "2v2", csv: "No,Team Name,Member Names,Instagram\n1,Shared Team,Shared Name / Partner Name,@sharedteam", staff: STAFF });
  const cashKids = await post(`/events/${cashEvent.id}/import`, { bracket: "under15", csv: "No,Entry Name,Instagram\n1,Shared Name,@sharedkid", staff: STAFF });
  assert.equal(cashTeams.body.registrations[0].instagramTeam, "@sharedteam");
  assert.equal(cashKids.body.registrations[0].members[0].instagram, "@sharedkid");
  const beforeArrivalQuotes = await request(`/events/${cashEvent.id}/snapshot`);
  const twoVTwoBeforeArrival = beforeArrivalQuotes.body.registrations.find((registration) => registration.id === cashTeams.body.registrations[0].id);
  const under15BeforeArrival = beforeArrivalQuotes.body.registrations.find((registration) => registration.id === cashKids.body.registrations[0].id);
  const twoVTwoQuote = { entryMoney: 4000, drinkMoney: 700, total: 4700, currency: "JPY" };
  assert.deepEqual(twoVTwoBeforeArrival.members.map((member) => member.checkInQuote), [twoVTwoQuote, twoVTwoQuote], "Each unchecked 2v2 member receives an authoritative pre-check-in quote");
  assert.deepEqual(under15BeforeArrival.members[0].checkInQuote, { entryMoney: 2000, drinkMoney: 700, total: 2700, currency: "JPY" });
  const [eventListQuotes, eventQuotes, registrationListQuotes, registrationQuotes] = await Promise.all([
    request("/events"),
    request(`/events/${cashEvent.id}`),
    request(`/events/${cashEvent.id}/registrations?bracket=2v2`),
    request(`/events/${cashEvent.id}/registrations/${cashTeams.body.registrations[0].id}`)
  ]);
  const readModels = [
    eventListQuotes.body.find((event) => event.id === cashEvent.id).registrations.find((registration) => registration.id === cashTeams.body.registrations[0].id),
    eventQuotes.body.registrations.find((registration) => registration.id === cashTeams.body.registrations[0].id),
    registrationListQuotes.body.find((registration) => registration.id === cashTeams.body.registrations[0].id),
    registrationQuotes.body
  ];
  for (const readModel of readModels) assert.deepEqual(readModel.members[0].checkInQuote, twoVTwoQuote, "Every registration read route provides the same authoritative arrival quote");
  const staffSignIn = await post(`/events/${cashEvent.id}/staff-attendance`, { staff: { name: "Door Helper", role: "Check-in" } });
  assert.equal(staffSignIn.status, 200);
  const aliasRegistration = await post(`/events/${cashEvent.id}/registrations`, { bracket: "under15", entryName: "Shared Name Jr", staff: STAFF });
  const linkedAlias = await post(`/events/${cashEvent.id}/registrations/${aliasRegistration.body.id}/link-person`, { memberIndex: 0, personId: cashKids.body.registrations[0].members[0].personId, staff: STAFF });
  assert.equal(linkedAlias.status, 200);
  assert.equal(linkedAlias.body.members[0].personId, cashKids.body.registrations[0].members[0].personId);
  await checkInAll(cashEvent.id, cashTeams.body.registrations, "2v2");
  const afterTwoVTwoQuotes = await request(`/events/${cashEvent.id}/snapshot`);
  const checkedTwoVTwo = afterTwoVTwoQuotes.body.registrations.find((registration) => registration.id === cashTeams.body.registrations[0].id);
  const under15AfterTwoVTwo = afterTwoVTwoQuotes.body.registrations.find((registration) => registration.id === cashKids.body.registrations[0].id);
  assert.equal(checkedTwoVTwo.members[0].checkInQuote, null, "Already checked-in members do not receive another arrival quote");
  assert.deepEqual(under15AfterTwoVTwo.members[0].checkInQuote, { entryMoney: 2000, drinkMoney: 0, total: 2000, currency: "JPY" }, "A shared person is not quoted a second drink across divisions");
  await checkInAll(cashEvent.id, cashKids.body.registrations, "under15");
  const cashReport = await request(`/events/${cashEvent.id}/report`);
  assert.equal(cashReport.status, 200);
  assert.equal(cashReport.body.cashByCategory.twoVTwo.entryMoney, 8000);
  assert.equal(cashReport.body.cashByCategory.under15.entryMoney, 2000);
  assert.equal(cashReport.body.totals.drinkMoney, 1400, "The first drink is charged once per linked person across divisions");
  assert.equal(cashReport.body.totals.totalCash, 11400);
  assert.ok(cashReport.body.staffAttendance.some((attendance) => attendance.name === STAFF.name));
  const combinedCsv = await requestText(`/events/${cashEvent.id}/exports/combined.csv`);
  assert.equal(combinedCsv.status, 200);
  assert.ok(combinedCsv.body.includes("STAFF ATTENDANCE"));
  const combinedPdf = await requestText(`/events/${cashEvent.id}/exports/combined.pdf`);
  assert.equal(combinedPdf.status, 200);
  assert.ok(combinedPdf.contentType.includes("application/pdf"));
  assertStructuredPdf(combinedPdf.body);
  const japaneseCsv = await requestText(`/events/${cashEvent.id}/exports/combined.csv?lang=ja`);
  assert.equal(japaneseCsv.status, 200);
  assert.ok(japaneseCsv.body.includes("スタッフ出席"));
  assert.ok(japaneseCsv.body.includes("受付済み"));
  const japanesePdf = await requestText(`/events/${cashEvent.id}/exports/combined.pdf?lang=ja`);
  assert.equal(japanesePdf.status, 200);
  assertStructuredPdf(japanesePdf.body);

  const customConfiguration = {
    competitionFormat: "head_to_head",
    divisions: [{
      id: "open-3v3", name: "Open 3v3", ageGroup: "Open", teamSize: 3, registrationLimit: 2,
      prelims: { enabled: true, qualifierCount: 4, secondsPerSide: 75, scoreMinimum: 1, scoreMaximum: 20 },
      bracket: { enabled: true, type: "single_elimination", qualifierCount: 4, regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 40, movesPerBattler: 1 },
      judges: ["A", "B"], financial: { earlyEntryFee: 3000, sameDayEntryFee: 3500, drinkFee: 500 },
    }],
    staffRoles: ["Lead", "DJ"], display: { showEntryNumbers: true, showOnDeck: true, showTimer: true, theme: "chip_chop" },
    financial: { currency: "JPY", spectatorEntryFee: 1000, spectatorDrinkFee: 500 },
  };
  const configured = await post("/events", { name: "Configurable event", configuration: customConfiguration, state: "draft", staff: STAFF });
  assert.equal(configured.status, 201);
  const configuredEvent = configured.body;
  eventRevisions.set(configuredEvent.id, configuredEvent.revision);
  assert.equal(configuredEvent.lifecycle.status, "draft");
  assert.equal(configuredEvent.configuration.divisions[0].teamSize, 3);
  const customImport = await post(`/events/${configuredEvent.id}/import`, { bracket: "open-3v3", csv: "No,Team Name,Member Names\n1,Trio A,A / B / C\n2,Trio B,D / E / F", staff: STAFF });
  assert.equal(customImport.status, 201, "Custom division imports use configured team size");
  assert.equal(customImport.body.registrations[0].members.length, 3);
  await checkInAll(configuredEvent.id, customImport.body.registrations, "open-3v3", 3);
  const customReport = await request(`/events/${configuredEvent.id}/report`);
  assert.equal(customReport.body.divisionSummaries["open-3v3"].registrations, 2, "Reports include configured divisions rather than only legacy presets");
  assert.equal(customReport.body.cashByDivision["open-3v3"].entryMoney, 18000, "Configured fees are included in the division cash total");
  assert.equal(customReport.body.totals.totalBattlers, 6);
  const registrationLimit = await post(`/events/${configuredEvent.id}/registrations`, { bracket: "open-3v3", teamName: "Trio C", memberNames: "G / H / I", staff: STAFF });
  assert.equal(registrationLimit.status, 400, "Configured registration limits block extra walk-ins");
  const structuralChange = await patch(`/events/${configuredEvent.id}`, { configuration: { ...customConfiguration, divisions: [{ ...customConfiguration.divisions[0], teamSize: 2 }] }, staff: STAFF });
  assert.equal(structuralChange.status, 400, "Team size cannot change after registrations exist");
  const safePresentationChange = await patch(`/events/${configuredEvent.id}`, { configuration: { ...customConfiguration, staffRoles: ["Lead", "DJ", "Runner"], display: { ...customConfiguration.display, showTimer: false } }, staff: STAFF });
  assert.equal(safePresentationChange.status, 200, "Display and staff settings remain editable after registrations");
  const paused = await patch(`/events/${configuredEvent.id}`, { state: "paused", staff: STAFF });
  assert.equal(paused.status, 200);
  const pausedWrite = await post(`/events/${configuredEvent.id}/spectators`, { staff: STAFF });
  assert.equal(pausedWrite.status, 409, "Paused events reject event-day changes");
  const resumed = await patch(`/events/${configuredEvent.id}`, { state: "active", staff: STAFF });
  assert.equal(resumed.status, 200);
  const sevenToSmoke = await post("/events", { name: "Seven to smoke", configuration: { ...customConfiguration, competitionFormat: "seven_to_smoke", divisions: [{ ...customConfiguration.divisions[0], prelims: { ...customConfiguration.divisions[0].prelims, enabled: false }, bracket: { ...customConfiguration.divisions[0].bracket, enabled: false } }] }, staff: STAFF });
  assert.equal(sevenToSmoke.status, 201);
  eventRevisions.set(sevenToSmoke.body.id, sevenToSmoke.body.revision);
  const noFakeBracket = await post(`/events/${sevenToSmoke.body.id}/bracket`, { bracket: "open-3v3", staff: STAFF });
  assert.equal(noFakeBracket.status, 400, "7-to-smoke does not pretend to use the head-to-head bracket engine");

  const lifecycleEvent = await createEvent("Event lifecycle regression");
  const archivedEvent = await post(`/events/${lifecycleEvent.id}/archive`, { action: "archive", staff: STAFF });
  assert.equal(archivedEvent.status, 200);
  assert.equal(archivedEvent.body.lifecycle.status, "archived");
  const blockedArchivedWrite = await post(`/events/${lifecycleEvent.id}/registrations`, { bracket: "under15", entryName: "Should not be added", staff: STAFF });
  assert.equal(blockedArchivedWrite.status, 409, "Archived events must reject operational changes");
  const restoredEvent = await post(`/events/${lifecycleEvent.id}/archive`, { action: "restore", staff: STAFF });
  assert.equal(restoredEvent.status, 200);
  assert.equal(restoredEvent.body.lifecycle.status, "active");
  const renamedEvent = await patch(`/events/${lifecycleEvent.id}`, { name: "Renamed lifecycle event", staff: STAFF });
  assert.equal(renamedEvent.status, 200);
  assert.equal(renamedEvent.body.name, "Renamed lifecycle event");
  const lifecycleBackup = await post(`/events/${lifecycleEvent.id}/backups`, { reason: "Delete lifecycle test", staff: STAFF });
  assert.equal(lifecycleBackup.status, 201);
  const deletedEvent = await del(`/events/${lifecycleEvent.id}`, { staff: STAFF });
  assert.equal(deletedEvent.status, 200);
  assert.equal(deletedEvent.body.deleted, true);
  assert.equal(fs.existsSync(path.join(backupDirectory, lifecycleEvent.id)), false, "Deleting an event must also remove its backups");
  const deletedLookup = await request(`/events/${lifecycleEvent.id}`);
  assert.equal(deletedLookup.status, 404);
}

run().then(() => { console.log("Backend regression tests passed"); }).catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { server.kill(); await wait(50); fs.rmSync(tempDirectory, { recursive: true, force: true }); });
