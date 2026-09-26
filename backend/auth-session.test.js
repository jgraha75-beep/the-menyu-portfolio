const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const port = 3322;
const base = `http://localhost:${port}/api`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "the-menyu-auth-"));
const dataFile = path.join(directory, "data.json");
fs.writeFileSync(dataFile, JSON.stringify({ events: [] }));

function startServer() {
  return spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, STAFF_ACCESS_CODE: "auth-test-code", SESSION_SECRET: "auth-test-secret-at-least-32-characters" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* restarting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Auth test server did not start");
}

async function stopServer(server) {
  server.kill();
  await new Promise((resolve) => server.once("exit", resolve));
}

async function run() {
  let server = startServer();
  try {
    await waitForHealth();
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode: "auth-test-code", staff: { name: "Restart Staff", role: "Operations" } }) });
    assert.equal(login.status, 200);
    const token = (await login.json()).token;
    await stopServer(server);

    server = startServer();
    await waitForHealth();
    const afterRestart = await fetch(`${base}/events`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(afterRestart.status, 200, "A valid staff session must survive a backend function restart");
  } finally {
    if (server.exitCode === null) await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().then(() => console.log("Stateless staff session tests passed")).catch((error) => { console.error(error); process.exitCode = 1; });
