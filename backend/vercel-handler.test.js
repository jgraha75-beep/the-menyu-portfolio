const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "the-menyu-vercel-handler-"));
process.env.DATA_FILE = path.join(directory, "data.json");
process.env.BACKUP_DIR = path.join(directory, "backups");
process.env.STAFF_ACCESS_CODE = "handler-code";
process.env.SESSION_SECRET = "handler-secret-at-least-32-characters";

const handler = require("../api/[...path].js");

async function run() {
  assert.equal(typeof handler, "function");
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().then(() => console.log("Vercel handler tests passed")).catch((error) => { console.error(error); process.exitCode = 1; });
