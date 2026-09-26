const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function loadServer(overrides) {
  return spawnSync(process.execPath, ["-e", "require('./server')"], {
    cwd: __dirname,
    env: {
      ...process.env,
      VERCEL: "1",
      NODE_ENV: "production",
      PERSISTENCE_DRIVER: "",
      STAFF_ACCESS_CODE: "",
      SESSION_SECRET: "",
      ...overrides,
    },
    encoding: "utf8",
  });
}

const missing = loadServer({});
assert.notEqual(missing.status, 0);
assert.match(`${missing.stdout}\n${missing.stderr}`, /STAFF_ACCESS_CODE is required/);

const shortSecret = loadServer({ STAFF_ACCESS_CODE: "private-code", SESSION_SECRET: "too-short" });
assert.notEqual(shortSecret.status, 0);
assert.match(`${shortSecret.stdout}\n${shortSecret.stderr}`, /SESSION_SECRET must contain at least 32 characters/);

const jsonPersistence = loadServer({ STAFF_ACCESS_CODE: "private-code", SESSION_SECRET: "a-stable-production-session-secret-32", PERSISTENCE_DRIVER: "json" });
assert.notEqual(jsonPersistence.status, 0);
assert.match(`${jsonPersistence.stdout}\n${jsonPersistence.stderr}`, /PERSISTENCE_DRIVER=supabase is required in production/);

const configured = loadServer({ STAFF_ACCESS_CODE: "private-code", SESSION_SECRET: "a-stable-production-session-secret-32", PERSISTENCE_DRIVER: "supabase", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" });
assert.equal(configured.status, 0, configured.stderr);

console.log("Production secret configuration tests passed");
