const assert = require("node:assert/strict");
const http = require("node:http");

const url = process.env.SUPABASE_TEST_URL;
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY;
if (!url || !secretKey) {
  throw new Error("SUPABASE_TEST_URL and SUPABASE_TEST_SECRET_KEY are required for the real Supabase HTTP test");
}

process.env.PERSISTENCE_DRIVER = "supabase";
process.env.SUPABASE_URL = url;
process.env.SUPABASE_SECRET_KEY = secretKey;
process.env.STAFF_ACCESS_CODE = "supabase-http-test-code";
process.env.SESSION_SECRET = "supabase-http-test-session-secret-at-least-32-characters";

const handler = require("./server");
const { SupabasePersistence } = require("./persistence/supabase-persistence");

const server = http.createServer(handler);
const persistence = new SupabasePersistence({ url, secretKey });
let base = "";
let eventId = "";

async function request(pathname, { token = "", method = "GET", body, revision } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  const responseBody = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  const responseRevision = Number(response.headers.get("x-event-revision"));
  return {
    status: response.status,
    contentType,
    revision: Number.isInteger(responseRevision) ? responseRevision : null,
    body: responseBody,
  };
}

async function login(name) {
  const response = await request("/auth/login", {
    method: "POST",
    body: { accessCode: "supabase-http-test-code", staff: { name, role: "Migration QA" } },
  });
  assert.equal(response.status, 200);
  return response.body.token;
}

async function currentEvent(token) {
  const response = await request(`/events/${eventId}`, { token });
  assert.equal(response.status, 200);
  return response.body;
}

async function run() {
  await persistence.initialize();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;

  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal((await request("/events")).status, 401, "Event data must remain staff-only");

  const [tokenA, tokenB] = await Promise.all([login("Supabase Staff A"), login("Supabase Staff B")]);
  const created = await request("/events", {
    token: tokenA,
    method: "POST",
    body: { name: `Supabase HTTP ${Date.now()}`, eventTime: "2026-09-20 18:00" },
  });
  assert.equal(created.status, 201);
  eventId = created.body.id;
  const originalName = created.body.name;

  const attendance = await request(`/events/${eventId}/staff-attendance`, { token: tokenB, method: "POST", body: {} });
  assert.equal(attendance.status, 200);

  const registration = await request(`/events/${eventId}/registrations`, {
    token: tokenA,
    method: "POST",
    body: { bracket: "under15", entryName: "Supabase HTTP Dancer", instagramMembers: ["@supabase_http_test"] },
  });
  assert.equal(registration.status, 201);

  const beforeBackup = await currentEvent(tokenA);
  const backup = await request(`/events/${eventId}/backups`, {
    token: tokenA,
    method: "POST",
    revision: beforeBackup.revision,
    body: { reason: "Supabase HTTP recovery test" },
  });
  assert.equal(backup.status, 201);
  const backupId = backup.body.backup.backupId;

  const renamed = await request(`/events/${eventId}`, {
    token: tokenA,
    method: "PATCH",
    revision: backup.revision,
    body: { name: `${originalName} changed` },
  });
  assert.equal(renamed.status, 200);

  const restored = await request(`/events/${eventId}/backups/${backupId}/restore`, {
    token: tokenB,
    method: "POST",
    revision: renamed.revision,
    body: {},
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.event.name, originalName);
  assert.ok(restored.body.safetyBackup.backupId);

  const duplicateCheckIns = await Promise.all([
    request(`/events/${eventId}/registrations/${registration.body.id}/check-in`, { token: tokenA, method: "POST", body: { memberIndex: 0 } }),
    request(`/events/${eventId}/registrations/${registration.body.id}/check-in`, { token: tokenB, method: "POST", body: { memberIndex: 0 } }),
  ]);
  assert.deepEqual(duplicateCheckIns.map((result) => result.status).sort(), [200, 409]);
  assert.equal(duplicateCheckIns.find((result) => result.status === 409).body.code, "ALREADY_CHECKED_IN");

  const spectatorAdds = await Promise.all([
    request(`/events/${eventId}/spectators`, { token: tokenA, method: "POST", body: {} }),
    request(`/events/${eventId}/spectators`, { token: tokenB, method: "POST", body: {} }),
  ]);
  assert.ok(spectatorAdds.every((result) => result.status === 200));

  const report = await request(`/events/${eventId}/report`, { token: tokenA });
  assert.equal(report.status, 200);
  assert.equal(report.body.totals.spectators, 2);
  assert.equal(report.body.cashByCategory.under15.total, 3200, "One U-15 same-day check-in must charge exactly one entry and one drink");

  const csv = await request(`/events/${eventId}/exports/combined.csv?lang=en`, { token: tokenA });
  assert.equal(csv.status, 200);
  assert.match(csv.contentType, /text\/csv/);
  assert.match(csv.body.toString("utf8"), /Supabase HTTP Dancer/);
  const pdf = await request(`/events/${eventId}/exports/combined.pdf?lang=ja`, { token: tokenB });
  assert.equal(pdf.status, 200);
  assert.match(pdf.contentType, /application\/pdf/);
  assert.equal(pdf.body.subarray(0, 4).toString("ascii"), "%PDF");

  const exportRows = await persistence.client.from("exports").select("format, language, content_digest").eq("event_id", eventId);
  assert.equal(exportRows.error, null);
  assert.deepEqual(new Set(exportRows.data.map((row) => row.format)), new Set(["csv", "pdf"]));
  assert.ok(exportRows.data.every((row) => /^[a-f0-9]{64}$/.test(row.content_digest)));
  const backupRows = await persistence.client.from("backups").select("kind, event_digest").eq("event_id", eventId);
  assert.equal(backupRows.error, null);
  assert.ok(backupRows.data.some((row) => row.kind === "manual"));
  assert.ok(backupRows.data.some((row) => row.kind === "pre_restore"));
  assert.ok(backupRows.data.every((row) => /^[a-f0-9]{64}$/.test(row.event_digest)));

  const beforeArchive = await currentEvent(tokenA);
  const archived = await request(`/events/${eventId}/archive`, {
    token: tokenA,
    method: "POST",
    revision: beforeArchive.revision,
    body: { action: "archive" },
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.lifecycle.status, "archived");
  const blockedMutation = await request(`/events/${eventId}/spectators`, { token: tokenB, method: "POST", body: {} });
  assert.equal(blockedMutation.status, 409);
  assert.equal(blockedMutation.body.code, "EVENT_ARCHIVED");
  const unarchived = await request(`/events/${eventId}/archive`, {
    token: tokenB,
    method: "POST",
    revision: archived.revision,
    body: { action: "restore" },
  });
  assert.equal(unarchived.status, 200);

  const strictRevision = unarchived.revision;
  const strictEdits = await Promise.all([
    request(`/events/${eventId}`, { token: tokenA, method: "PATCH", revision: strictRevision, body: { name: `${originalName} A` } }),
    request(`/events/${eventId}`, { token: tokenB, method: "PATCH", revision: strictRevision, body: { name: `${originalName} B` } }),
  ]);
  assert.deepEqual(strictEdits.map((result) => result.status).sort(), [200, 409]);
  assert.equal(strictEdits.find((result) => result.status === 409).body.code, "REVISION_CONFLICT");

  const finalEvent = await currentEvent(tokenA);
  const downloadedBackup = await request(`/events/${eventId}/backups/${backupId}`, { token: tokenA });
  assert.equal(downloadedBackup.status, 200);
  assert.equal(downloadedBackup.body.eventId, eventId);
  assert.ok(finalEvent.auditLog.some((entry) => entry.action === "restore_event_backup"));
}

run()
  .then(() => console.log("Supabase HTTP, two-session, export, and recovery tests passed"))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    if (eventId) {
      try {
        const row = await persistence.client.from("events").select("revision").eq("id", eventId).maybeSingle();
        if (row.data) await persistence.deleteEvent(eventId, Number(row.data.revision));
      } catch (error) {
        console.error("Failed to remove Supabase HTTP test event", error);
        process.exitCode = 1;
      }
    }
    await new Promise((resolve) => server.close(resolve));
  });
