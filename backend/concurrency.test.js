const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const port = 3323;
const base = `http://localhost:${port}/api`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "the-menyu-concurrency-"));
const dataFile = path.join(directory, "data.json");
fs.writeFileSync(dataFile, JSON.stringify({ events: [] }));
const server = spawn(process.execPath, ["server.js"], { cwd: __dirname, env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, STAFF_ACCESS_CODE: "concurrency-code", SESSION_SECRET: "concurrency-secret-at-least-32-characters" }, stdio: ["ignore", "pipe", "pipe"] });

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Concurrency test server did not start");
}

async function json(pathname, token, method = "GET", body, revision) {
  const response = await fetch(`${base}${pathname}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, revision: Number(response.headers.get("x-event-revision")), body: await response.json() };
}

async function login(name) {
  const result = await json("/auth/login", "", "POST", { accessCode: "concurrency-code", staff: { name, role: "Operations" } });
  assert.equal(result.status, 200);
  return result.body.token;
}

async function run() {
  await waitForHealth();
  const [tokenA, tokenB] = await Promise.all([login("Staff A"), login("Staff B")]);
  const created = await json("/events", tokenA, "POST", { name: "Two sessions", eventTime: "", staff: {} });
  assert.equal(created.status, 201);
  const eventId = created.body.id;
  const registration = await json(`/events/${eventId}/registrations`, tokenA, "POST", { bracket: "under15", entryName: "Concurrent Dancer" }, created.revision);
  assert.equal(registration.status, 201);

  const checkInRevision = registration.revision;
  const checkIns = await Promise.all([
    json(`/events/${eventId}/registrations/${registration.body.id}/check-in`, tokenA, "POST", { memberIndex: 0 }, checkInRevision),
    json(`/events/${eventId}/registrations/${registration.body.id}/check-in`, tokenB, "POST", { memberIndex: 0 }, checkInRevision),
  ]);
  assert.deepEqual(checkIns.map((result) => result.status).sort(), [200, 409]);
  assert.equal(checkIns.find((result) => result.status === 409).body.code, "ALREADY_CHECKED_IN");

  const afterCheckIn = await json(`/events/${eventId}`, tokenA);
  const spectatorRevision = afterCheckIn.body.revision;
  const spectators = await Promise.all([
    json(`/events/${eventId}/spectators`, tokenA, "POST", {}, spectatorRevision),
    json(`/events/${eventId}/spectators`, tokenB, "POST", {}, spectatorRevision),
  ]);
  assert.ok(spectators.every((result) => result.status === 200), "Both merge-safe spectator increments must succeed");
  const report = await json(`/events/${eventId}/report`, tokenA);
  assert.equal(report.body.totals.spectators, 2);
  assert.equal(report.body.cashByCategory.under15.total, 3200, "Concurrent duplicate check-in must not duplicate same-day cash");

  const strictRevision = (await json(`/events/${eventId}`, tokenA)).body.revision;
  const edits = await Promise.all([
    json(`/events/${eventId}`, tokenA, "PATCH", { name: "Staff A edit" }, strictRevision),
    json(`/events/${eventId}`, tokenB, "PATCH", { name: "Staff B edit" }, strictRevision),
  ]);
  assert.deepEqual(edits.map((result) => result.status).sort(), [200, 409]);
  assert.equal(edits.find((result) => result.status === 409).body.code, "REVISION_CONFLICT");
}

run().then(() => console.log("Two-session concurrency tests passed")).catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { server.kill(); await new Promise((resolve) => setTimeout(resolve, 50)); fs.rmSync(directory, { recursive: true, force: true }); });
