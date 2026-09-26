const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const port = 3323;
const base = `http://127.0.0.1:${port}/api`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "the-menyu-security-"));
const dataFile = path.join(directory, "data.json");
fs.writeFileSync(dataFile, JSON.stringify({ events: [] }));

function startServer() {
  return spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port), DATA_FILE: dataFile, STAFF_ACCESS_CODE: "security-test-code", SESSION_SECRET: "security-test-secret-at-least-32-characters",
      CORS_ALLOWED_ORIGINS: "https://staff.example", MAX_REQUEST_BODY_BYTES: "1024", LOGIN_MAX_ATTEMPTS: "2", LOGIN_WINDOW_MS: "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* restarting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Security test server did not start");
}

async function run() {
  const server = startServer();
  try {
    await waitForHealth();
    const allowed = await fetch(`${base}/health`, { headers: { Origin: "https://staff.example" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://staff.example");
    assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
    assert.equal(allowed.headers.get("x-frame-options"), "DENY");
    assert.match(allowed.headers.get("content-security-policy") || "", /default-src 'none'/);

    const deniedPreflight = await fetch(`${base}/health`, { method: "OPTIONS", headers: { Origin: "https://untrusted.example", "Access-Control-Request-Method": "GET" } });
    assert.equal(deniedPreflight.status, 403);

    const oversized = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode: "x".repeat(2048) }) });
    assert.equal(oversized.status, 413);

    const login = (forwardedAddress) => fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", ...(forwardedAddress ? { "X-Forwarded-For": forwardedAddress } : {}) }, body: JSON.stringify({ accessCode: "wrong", staff: { name: "Security Tester", role: "Operations" } }) });
    assert.equal((await login("198.51.100.1")).status, 401);
    assert.equal((await login("198.51.100.2")).status, 401);
    const throttled = await login("198.51.100.3");
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get("retry-after") !== null, true, "Untrusted forwarded headers must not bypass local login throttling");
    assert.ok(Number(throttled.headers.get("retry-after")) > 0);
  } finally {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().then(() => console.log("HTTP security tests passed")).catch((error) => { console.error(error); process.exitCode = 1; });
