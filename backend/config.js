const crypto = require("node:crypto");

function positiveNumber(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function loadRuntimeConfig(environment = process.env) {
  const productionRuntime = environment.VERCEL === "1" || environment.NODE_ENV === "production";
  if (productionRuntime && !environment.STAFF_ACCESS_CODE) throw new Error("STAFF_ACCESS_CODE is required in production");
  if (productionRuntime && String(environment.SESSION_SECRET || "").length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters in production");
  if (productionRuntime && String(environment.PERSISTENCE_DRIVER || "").toLowerCase() !== "supabase") throw new Error("PERSISTENCE_DRIVER=supabase is required in production");

  const localOrigins = "http://localhost:4175,http://127.0.0.1:4175";
  return {
    port: positiveNumber(environment.PORT, 3000, 1),
    productionRuntime,
    staffAccessCode: environment.STAFF_ACCESS_CODE || crypto.randomBytes(6).toString("hex"),
    sessionSecret: environment.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    sessionTtlSeconds: positiveNumber(environment.SESSION_TTL_SECONDS, 60 * 60 * 12, 1),
    maxRequestBodyBytes: positiveNumber(environment.MAX_REQUEST_BODY_BYTES, 1024 * 1024, 1024),
    loginMaxAttempts: positiveNumber(environment.LOGIN_MAX_ATTEMPTS, 5, 1),
    loginWindowMs: positiveNumber(environment.LOGIN_WINDOW_MS, 15 * 60 * 1000, 1_000),
    corsAllowedOrigins: new Set(String(environment.CORS_ALLOWED_ORIGINS || (productionRuntime ? "" : localOrigins)).split(",").map((origin) => origin.trim()).filter(Boolean)),
  };
}

module.exports = { loadRuntimeConfig };
