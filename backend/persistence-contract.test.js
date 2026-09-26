const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createJsonPersistence } = require("./persistence");
const { projectEvent } = require("./persistence/project-event");

async function runContract() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "the-menyu-persistence-"));
  const dataFile = path.join(directory, "data.json");
  const backupDirectory = path.join(directory, "backups");

  try {
    const persistence = createJsonPersistence({ dataFile, backupDirectory });
    await persistence.initialize();
    assert.deepEqual(await persistence.readStore(), { events: [] });

    const created = {
      id: "event_contract",
      name: "Persistence contract",
      revision: 1,
      createdAt: "2026-08-24T12:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z",
    };
    await persistence.commitEvent({ events: [created] }, created, { expectedRevision: 0, create: true });
    assert.equal((await persistence.readStore()).events[0].revision, 1);

    const updated = { ...created, name: "Updated", revision: 2, updatedAt: "2026-08-24T12:01:00.000Z" };
    await persistence.commitEvent({ events: [updated] }, updated, { expectedRevision: 1 });
    assert.equal((await persistence.readStore()).events[0].name, "Updated");

    await assert.rejects(
      persistence.commitEvent({ events: [{ ...updated, revision: 3 }] }, { ...updated, revision: 3 }, { expectedRevision: 1 }),
      (error) => error?.code === "REVISION_CONFLICT" && error?.currentRevision === 2,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function runProjectionContract() {
  const event = {
    id: "event_projection",
    name: "Projection contract",
    eventTime: "2026-09-20T09:00:00.000Z",
    prelimsStartTime: "2026-09-20T10:00:00.000Z",
    location: "Tokyo, Japan",
    timeZone: "Asia/Tokyo",
    judges: ["Judge One", "Judge Two"],
    nextRegistrationNumber: 3,
    revision: 7,
    lifecycle: { status: "active", archivedAt: null, archivedBy: null },
    people: [{ id: "person_shared", name: "Shared Dancer", nameKey: "shared dancer", createdAt: "2026-08-24T12:00:00.000Z" }],
    registrations: [
      {
        id: "reg_team", displayCode: "CC-0001", eventId: "event_projection", bracket: "2v2", registrationSource: "early", sourceNumber: "1",
        teamName: "Shared Team", memberNames: "Shared Dancer / Partner", entryName: "", dob: "", parentName: "", genre: "Hip Hop", region: "Tokyo", email: "team@example.com", phone: "", instagramTeam: "@sharedteam", instagramMembers: ["@shared", "@partner"], status: "Checked in", needsReview: false, reviewReasons: [], notes: "", duplicateOf: [], duplicateIgnored: false,
        members: [
          { name: "Shared Dancer", personId: "person_shared", instagram: "@shared", checkedIn: true, arrivedAt: "2026-09-20T08:00:00.000Z", drinkCharged: true },
          { name: "Partner", personId: "person_partner", instagram: "@partner", checkedIn: true, arrivedAt: "2026-09-20T08:01:00.000Z", drinkCharged: true },
        ],
        payment: { battlerEntry: 8000, drink: 1400, total: 9400, paidAt: "2026-09-20T08:00:00.000Z" }, prelimOrder: 1, prelimRank: 1, rankOverride: null,
        scores: { judge1: 5, judge2: 4, average: 4.5 }, createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-09-20T08:01:00.000Z",
      },
      {
        id: "reg_kid", displayCode: "CC-0002", eventId: "event_projection", bracket: "under15", registrationSource: "early", sourceNumber: "1",
        teamName: "", memberNames: "", entryName: "Shared Dancer", dob: "", parentName: "", genre: "Freestyle", region: "Tokyo", email: "kid@example.com", phone: "", instagramTeam: "", instagramMembers: ["@shared"], status: "Checked in", needsReview: false, reviewReasons: [], notes: "", duplicateOf: [], duplicateIgnored: false,
        members: [{ name: "Shared Dancer", personId: "person_shared", instagram: "@shared", checkedIn: true, arrivedAt: "2026-09-20T08:02:00.000Z", drinkCharged: false }],
        payment: { battlerEntry: 2000, drink: 0, total: 2000, paidAt: "2026-09-20T08:02:00.000Z" }, prelimOrder: null, prelimRank: null, rankOverride: null,
        scores: { judge1: null, judge2: null, average: null }, createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-09-20T08:02:00.000Z",
      },
    ],
    spectators: { count: 1, entryMoney: 2000, drinkMoney: 700 },
    prelimOrders: { "2v2": { lockedAt: "2026-09-20T08:30:00.000Z", registrationIds: ["reg_team"] } }, prelimTieBreaks: {}, brackets: {},
    timers: { prelims: { "2v2": { version: 1, durationSeconds: 45, remainingSeconds: 45, status: "idle", startedAt: null, updatedAt: "2026-09-20T08:30:00.000Z" } }, bracket: {} },
    auditLog: [{ id: "audit_1", at: "2026-09-20T08:00:00.000Z", staffName: "Door Staff", staffRole: "Check-in", action: "check_in", targetType: "registration", targetId: "reg_team", details: { memberIndex: 0 } }],
    staffAttendance: [{ id: "attendance_1", key: "door staff:check-in", name: "Door Staff", role: "Check-in", signedInAt: "2026-09-20T07:50:00.000Z", lastActiveAt: "2026-09-20T08:00:00.000Z" }],
    finance: { status: "open", review: { reviewedAt: null, reviewedBy: null, notes: "" }, transactions: [{ id: "finance_1", category: "venue_expense", description: "Venue", expectedAmount: 10000, actualAmount: 12000, party: "Studio", occurredAt: "2026-09-20T07:00:00.000Z", source: "manual", sourceId: null, correctionOf: null, correctionReason: null, createdBy: { name: "Door Staff", role: "Check-in" }, createdAt: "2026-09-20T07:00:00.000Z" }] },
    createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-09-20T08:30:00.000Z",
  };

  const projection = projectEvent(event);
  const eventOwnedTables = ["event_staff", "people", "registrations", "registration_members", "check_ins", "charges", "prelim_scores", "rankings", "brackets", "matches", "match_rounds", "timers", "audit_log", "financial_transactions"];
  for (const table of eventOwnedTables) assert.ok(projection[table].every((row) => row.event_id === event.id), `${table} must carry event_id`);
  assert.equal(projection.check_ins.length, 3);
  assert.equal(projection.charges.filter((charge) => charge.charge_type === "entry").length, 3);
  assert.equal(projection.charges.filter((charge) => charge.charge_type === "drink").length, 2, "A linked dancer receives only one included drink across divisions");
  assert.equal(projection.charges.filter((charge) => charge.charge_type === "spectator_entry").length, 1);
  assert.deepEqual(projection.prelim_scores.map((score) => score.score), [5, 4]);
  assert.deepEqual(projection.financial_transactions[0], { id: "finance_1", event_id: event.id, category: "venue_expense", description: "Venue", expected_amount: 10000, actual_amount: 12000, party: "Studio", occurred_at: "2026-09-20T07:00:00.000Z", source: "manual", source_id: null, correction_of: null, correction_reason: null, created_by_name: "Door Staff", created_by_role: "Check-in", created_at: "2026-09-20T07:00:00.000Z" });
}

runContract()
  .then(runProjectionContract)
  .then(() => console.log("Persistence contract tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
