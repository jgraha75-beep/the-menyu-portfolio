const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { SupabasePersistence } = require("./persistence/supabase-persistence");
const { projectEvent } = require("./persistence/project-event");

const url = process.env.SUPABASE_TEST_URL;
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY;
if (!url || !secretKey) throw new Error("SUPABASE_TEST_URL and SUPABASE_TEST_SECRET_KEY are required for the real Supabase contract test");

const suffix = crypto.randomBytes(5).toString("hex");
const eventId = `event_supabase_${suffix}`;
const at = new Date().toISOString();
const event = {
  id: eventId, name: "Supabase contract", eventTime: "", prelimsStartTime: "", location: "Tokyo, Japan", timeZone: "Asia/Tokyo", judges: [], nextRegistrationNumber: 2,
  lifecycle: { status: "active", archivedAt: null, archivedBy: null }, revision: 1,
  people: [{ id: `person_${suffix}`, name: "Contract Dancer", nameKey: "contract dancer", createdAt: at }],
  registrations: [{
    id: `reg_${suffix}`, displayCode: "CC-0001", eventId, bracket: "under15", registrationSource: "early", sourceNumber: "1", teamName: "", memberNames: "", entryName: "Contract Dancer",
    dob: "", parentName: "", genre: "", region: "", email: "", phone: "", instagramTeam: "", instagramMembers: [""], status: "Checked in", needsReview: false, reviewReasons: [], notes: "", duplicateOf: [], duplicateIgnored: false,
    members: [{ name: "Contract Dancer", personId: `person_${suffix}`, instagram: "", checkedIn: true, arrivedAt: at, drinkCharged: true }], payment: { battlerEntry: 2000, drink: 700, total: 2700, paidAt: at },
    prelimOrder: 1, prelimRank: 1, rankOverride: null, scores: { judge1: 5, judge2: 4, average: 4.5 }, createdAt: at, updatedAt: at,
  }],
  spectators: { count: 0, entryMoney: 0, drinkMoney: 0 }, prelimOrders: {}, prelimTieBreaks: {}, brackets: {}, timers: { prelims: {}, bracket: {} }, auditLog: [], staffAttendance: [], finance: { status: "open", review: { reviewedAt: null, reviewedBy: null, notes: "" }, transactions: [{ id: `finance_${suffix}`, category: "venue_expense", description: "Venue", expectedAmount: 1000, actualAmount: 1200, party: "Studio", occurredAt: at, source: "manual", sourceId: null, correctionOf: null, correctionReason: null, createdBy: { name: "QA", role: "Finance lead" }, createdAt: at }] }, createdAt: at, updatedAt: at,
};

async function run() {
  const persistence = new SupabasePersistence({ url, secretKey });
  await persistence.initialize();
  try {
    await persistence.commitEvent({ events: [event] }, event, { expectedRevision: 0, create: true });
    assert.equal((await persistence.readStore()).events.find((item) => item.id === eventId)?.name, event.name);

    const updated = { ...event, name: "Supabase contract updated", revision: 2, updatedAt: new Date().toISOString(), registrations: event.registrations.map((entry) => ({ ...entry, scores: { judge1: 10, judge2: 10, average: 10 } })) };
    await persistence.commitEvent({ events: [updated] }, updated, { expectedRevision: 1 });
    const savedScores = await persistence.client.from("prelim_scores").select("score").eq("event_id", eventId);
    assert.equal(savedScores.error, null);
    assert.deepEqual(savedScores.data.map((entry) => entry.score), [10, 10]);
    const savedRankings = await persistence.client.from("rankings").select("average_score").eq("event_id", eventId);
    assert.equal(savedRankings.error, null);
    assert.equal(Number(savedRankings.data[0].average_score), 10, "Database must store a perfect 10 average");
    const savedFinance = await persistence.client.from("financial_transactions").select("category, actual_amount").eq("event_id", eventId);
    assert.equal(savedFinance.error, null);
    assert.deepEqual(savedFinance.data, [{ category: "venue_expense", actual_amount: 1200 }]);
    await assert.rejects(
      persistence.commitEvent({ events: [{ ...updated, revision: 3 }] }, { ...updated, revision: 3 }, { expectedRevision: 1 }),
      (error) => error?.code === "REVISION_CONFLICT" && error?.currentRevision === 2,
    );

    const projection = projectEvent(updated);
    const member = projection.registration_members[0];
    const checkIn = projection.check_ins[0];
    const drink = projection.charges.find((charge) => charge.charge_type === "drink");
    const duplicateCheckIn = await persistence.client.from("check_ins").insert({ ...checkIn, id: `checkin_duplicate_${suffix}` });
    assert.equal(duplicateCheckIn.error?.code, "23505", "Database must reject a second active check-in for one member");
    const duplicateDrink = await persistence.client.from("charges").insert({ ...drink, id: `charge_duplicate_${suffix}` });
    assert.equal(duplicateDrink.error?.code, "23505", "Database must reject a second active drink for one person");
    const invalidJudge = await persistence.client.from("prelim_scores").insert({ ...projection.prelim_scores[0], id: `score_invalid_judge_${suffix}`, judge_number: 3, score: 10 });
    assert.equal(invalidJudge.error?.code, "23514", "Database must enforce judge bounds");
    for (const score of [0, 11]) {
      const invalidScore = await persistence.client.from("prelim_scores").update({ score }).eq("id", projection.prelim_scores[0].id);
      assert.equal(invalidScore.error?.code, "23514", "Database must enforce score bounds independently of judge bounds");
    }

    const backup = { schemaVersion: 1, backupId: `backup_${suffix.padEnd(12, "0").slice(0, 12)}`, eventId, eventName: event.name, createdAt: at, reason: "Contract", kind: "manual", createdBy: { name: "QA", role: "Test" }, integrity: { algorithm: "sha256", eventDigest: "a".repeat(64) }, event: updated };
    await persistence.saveBackup(backup);
    assert.equal((await persistence.loadBackup(eventId, backup.backupId)).backupId, backup.backupId);
    await persistence.recordExport({ eventId, kind: "combined", format: "csv", language: "en", filename: "contract.csv", content: "ok", createdBy: { name: "QA", role: "Test" } });
    const exportResult = await persistence.client.from("exports").select("id").eq("event_id", eventId);
    assert.equal(exportResult.error, null);
    assert.ok(exportResult.data.length >= 1);
    void member;
  } finally {
    await persistence.deleteEvent(eventId, 2).catch(() => {});
  }
}

run().then(() => console.log("Supabase read/write contract tests passed")).catch((error) => { console.error(error); process.exitCode = 1; });
