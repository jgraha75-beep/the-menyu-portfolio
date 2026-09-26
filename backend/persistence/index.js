const path = require("node:path");

const { JsonPersistence } = require("./json-persistence");

function createJsonPersistence(options = {}) {
  return new JsonPersistence({
    dataFile: options.dataFile || process.env.DATA_FILE || path.join(__dirname, "..", "data.json"),
    backupDirectory: options.backupDirectory || process.env.BACKUP_DIR || path.join(path.dirname(options.dataFile || process.env.DATA_FILE || path.join(__dirname, "..", "data.json")), "backups"),
  });
}

function createPersistenceFromEnv() {
  const driver = String(process.env.PERSISTENCE_DRIVER || "json").toLowerCase();
  if (driver === "json") return createJsonPersistence();
  if (driver === "supabase") {
    const { SupabasePersistence } = require("./supabase-persistence");
    return new SupabasePersistence({
      url: process.env.SUPABASE_URL,
      secretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }
  throw new Error(`Unknown PERSISTENCE_DRIVER: ${driver}`);
}

module.exports = { createJsonPersistence, createPersistenceFromEnv };
