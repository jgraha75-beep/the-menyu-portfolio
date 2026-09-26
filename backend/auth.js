const crypto = require("node:crypto");

function createAuthenticator({ staffAccessCode, sessionSecret, sessionTtlSeconds, loginMaxAttempts, loginWindowMs, requestError, now }) {
  const failedLoginAttempts = new Map();
  function bearerToken(req) { const header = String(req.headers.authorization || ""); return header.startsWith("Bearer ") ? header.slice(7).trim() : ""; }
  function clientAddress(req) {
    const platformForwardedAddress = process.env.VERCEL === "1" ? req.headers["x-vercel-forwarded-for"] : "";
    return String(platformForwardedAddress || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  }
  function requireLoginCapacity(req) {
    const key = clientAddress(req); const cutoff = Date.now() - loginWindowMs; const attempts = (failedLoginAttempts.get(key) || []).filter((attempt) => attempt > cutoff); failedLoginAttempts.set(key, attempts);
    if (attempts.length < loginMaxAttempts) return;
    const error = requestError("Too many failed login attempts. Try again shortly.", 429, "LOGIN_THROTTLED"); error.retryAfterSeconds = Math.max(1, Math.ceil((attempts[0] + loginWindowMs - Date.now()) / 1000)); throw error;
  }
  function recordFailedLogin(req) { const key = clientAddress(req); const cutoff = Date.now() - loginWindowMs; const attempts = (failedLoginAttempts.get(key) || []).filter((attempt) => attempt > cutoff); attempts.push(Date.now()); failedLoginAttempts.set(key, attempts); }
  function clearFailedLogins(req) { failedLoginAttempts.delete(clientAddress(req)); }
  function accessCodeMatches(supplied) { const actualDigest = crypto.createHash("sha256").update(staffAccessCode).digest(); const suppliedDigest = crypto.createHash("sha256").update(String(supplied || "")).digest(); return crypto.timingSafeEqual(suppliedDigest, actualDigest); }
  function signSession(staff) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ version: 1, staff, issuedAt, expiresAt: issuedAt + sessionTtlSeconds, nonce: crypto.randomBytes(8).toString("hex") })).toString("base64url");
    const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }
  function verifySession(token) {
    const [payload, suppliedSignature, extra] = String(token || "").split(".");
    if (!payload || !suppliedSignature || extra) return null;
    const expectedSignature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
    const supplied = Buffer.from(suppliedSignature); const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (session.version !== 1 || !session.staff?.name || !session.staff?.role || !Number.isInteger(session.expiresAt) || session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
      return { token, staff: session.staff, createdAt: new Date(session.issuedAt * 1000).toISOString(), lastActiveAt: now() };
    } catch { return null; }
  }
  function authenticate(req) { const session = verifySession(bearerToken(req)); if (!session) throw requestError("Authentication required", 401); return session; }
  return { authenticate, accessCodeMatches, clearFailedLogins, recordFailedLogin, requireLoginCapacity, signSession };
}

module.exports = { createAuthenticator };
