const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { JsonPersistence } = require("./persistence/json-persistence");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "menyu-offline-test-"));
process.env.DATA_FILE = path.join(directory, "events.json");
process.env.BACKUP_DIR = path.join(directory, "backups");
process.env.PERSISTENCE_DRIVER = "json";
process.env.STAFF_ACCESS_CODE = "offline-test-only";
process.env.SESSION_SECRET = "offline-test-only-at-least-32-characters";
const server = createServer(require("./server"));
let base, token, otherToken;
const staff = { name: "Door A", role: "Staff" };
const other = { name: "Door B", role: "Staff" };
async function request(route, method = "GET", body, auth = token, revision) {
  const response = await fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}`, ...(revision === undefined ? {} : { "If-Match": String(revision) }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = (await request("/auth/login", "POST", { accessCode: "offline-test-only", staff })).body.token;
  otherToken = (await request("/auth/login", "POST", { accessCode: "offline-test-only", staff: other })).body.token;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
async function fixture() {
  const event = (await request("/events", "POST", { name: "Offline rehearsal", mode: "rehearsal" })).body;
  const registration = (await request(`/events/${event.id}/registrations`, "POST", { bracket: "under15", entryName: "Original", notes: "before" })).body;
  const snapshot = (await request(`/events/${event.id}/snapshot`)).body;
  return { eventId: event.id, registration: snapshot.registrations.find((entry) => entry.id === registration.id) };
}
function command(registration, patch, actor = staff) {
  return { version: 1, id: randomUUID(), kind: "registration_edit", registrationId: registration.id, actor, createdAt: new Date().toISOString(), patch, base: Object.fromEntries(Object.keys(patch).map((field) => [field, { value: registration[field], revision: registration.fieldChanges[field].revision }])) };
}
const sync = (eventId, value, auth) => request(`/events/${eventId}/offline-actions`, "POST", { command: value }, auth);
const snapshot = async (eventId) => (await request(`/events/${eventId}/snapshot`)).body;

test("duplicate and concurrent deliveries persist one edit and one audit, including after restart/restore", async () => {
  const { eventId, registration } = await fixture();
  const initial = await snapshot(eventId);
  const backup = (await request(`/events/${eventId}/backups`, "POST", {}, token, initial.revision)).body.backup;
  const action = command(registration, { notes: "one edit" });
  const [a, b] = await Promise.all([sync(eventId, action), sync(eventId, action)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(a.body, b.body);
  const saved = await snapshot(eventId);
  assert.equal(saved.registrations[0].notes, "one edit");
  assert.equal(saved.report.auditLog.filter((entry) => entry.details.actionId === action.id).length, 1);
  assert.equal(saved.event.offlineReceipts, undefined, "Private receipts are not sent in snapshots");
  const disk = new JsonPersistence({ dataFile: process.env.DATA_FILE, backupDirectory: process.env.BACKUP_DIR });
  assert.equal((await disk.readStore()).events.find((entry) => entry.id === eventId).offlineReceipts[action.id].result.status, "synced");
  assert.equal((await request(`/events/${eventId}/backups/${backup.backupId}/restore`, "POST", {}, token, saved.revision)).status, 200);
  assert.deepEqual((await sync(eventId, action)).body, a.body);
  assert.equal((await snapshot(eventId)).registrations[0].notes, "before", "Old receipt must not reapply an edit after restore");
  assert.equal((await sync(eventId, { ...action, patch: { notes: "reused" } })).status, 409);
  assert.equal((await sync(eventId, action, otherToken)).status, 409);
});

test("unrelated fields merge; overlapping fields include author/time and resolution checks fresh state", async () => {
  const { eventId, registration } = await fixture();
  const local = command(registration, { notes: "offline", region: "Tokyo" });
  const remote = command(registration, { notes: "server" }, other);
  assert.equal((await sync(eventId, remote, otherToken)).body.status, "synced");
  assert.equal((await sync(eventId, command(registration, { genre: "Hip hop" }))).body.status, "synced");
  const conflict = (await sync(eventId, local)).body;
  assert.equal(conflict.status, "conflict");
  const comparison = conflict.comparisons.find((entry) => entry.field === "notes");
  assert.equal(comparison.localValue, "offline"); assert.equal(comparison.serverValue, "server");
  assert.equal(comparison.serverChange.staffName, other.name); assert.ok(Date.parse(comparison.serverChange.at));
  assert.equal((await snapshot(eventId)).registrations[0].region, "", "A conflict applies none of the edit");
  const resolution = { ...local, id: randomUUID(), resolutionOf: local.id, base: Object.fromEntries(conflict.comparisons.map((entry) => [entry.field, { value: entry.serverValue, revision: entry.serverChange.revision }])) };
  const newer = (await snapshot(eventId)).registrations[0];
  await sync(eventId, command(newer, { notes: "newer" }, other), otherToken);
  assert.equal((await sync(eventId, resolution)).body.status, "conflict", "Reviewing old values is not a force overwrite");
  const keep = { ...local, id: randomUUID(), kind: "keep_server", resolutionOf: resolution.id, patch: {}, base: {} };
  assert.equal((await sync(eventId, keep)).body.status, "discarded");
  const final = await snapshot(eventId);
  assert.equal(final.registrations[0].notes, "newer");
  assert.ok(final.report.auditLog.some((entry) => entry.action === "offline_discarded"));
  assert.equal((await sync(eventId, { ...resolution, id: randomUUID() })).body.status, "rejected", "A second tab cannot resolve the original conflict twice");
});

test("online PATCH stamps fields and catches change-away-and-back", async () => {
  const { eventId, registration } = await fixture();
  for (const notes of ["temporary", "before"]) {
    const current = await snapshot(eventId);
    const result = await request(`/events/${eventId}/registrations/${registration.id}`, "PATCH", { notes, expectedUpdatedAt: current.registrations[0].updatedAt }, otherToken, current.revision);
    assert.equal(result.status, 200);
  }
  assert.equal((await sync(eventId, command(registration, { notes: "offline" }))).body.status, "conflict");
});

test("rejections are durable and independent edits continue; invalid identity cannot mutate", async () => {
  const { eventId, registration } = await fixture();
  const bad = command(registration, { notes: 123 });
  assert.equal((await sync(eventId, bad)).body.status, "rejected");
  assert.equal((await sync(eventId, bad)).body.status, "rejected");
  const wrongActor = command(registration, { notes: "wrong identity" }, other);
  assert.equal((await sync(eventId, wrongActor)).status, 403);
  assert.equal((await sync(eventId, command(registration, { notes: "accepted" }))).body.status, "synced");
  const current = await snapshot(eventId);
  assert.equal(current.report.auditLog.filter((entry) => entry.details.actionId === bad.id).length, 1);
  await request(`/events/${eventId}`, "PATCH", { state: "paused" }, token, current.revision);
  assert.equal((await sync(eventId, command(current.registrations[0], { notes: "paused edit" }))).body.status, "rejected");
  assert.equal((await sync(eventId, bad)).body.status, "rejected");
});

test("JSON persistence compares revisions atomically for simultaneous commits", async () => {
  const persistence = new JsonPersistence({ dataFile: path.join(directory, "atomic.json"), backupDirectory: path.join(directory, "atomic-backups") });
  await persistence.initialize();
  await persistence.commitEvent(null, { id: "event", revision: 1 }, { create: true });
  const results = await Promise.allSettled([persistence.commitEvent(null, { id: "event", revision: 2, name: "A" }, { expectedRevision: 1 }), persistence.commitEvent(null, { id: "event", revision: 2, name: "B" }, { expectedRevision: 1 })]);
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
});
