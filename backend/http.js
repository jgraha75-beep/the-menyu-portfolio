function createHttpTools({ maxRequestBodyBytes, corsAllowedOrigins }) {
  const securityHeaders = { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'", "Cross-Origin-Resource-Policy": "same-origin", "Permissions-Policy": "camera=(), geolocation=(), microphone=()", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };
  const corsHeaders = { "Access-Control-Allow-Headers": "Content-Type, Authorization, If-Match", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Expose-Headers": "X-Event-Revision" };
  function applyResponseHeaders(req, res) {
    for (const [header, value] of Object.entries(securityHeaders)) res.setHeader(header, value);
    const origin = String(req.headers.origin || "");
    if (origin && corsAllowedOrigins.has(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); for (const [header, value] of Object.entries(corsHeaders)) res.setHeader(header, value); }
    return Boolean(origin && corsAllowedOrigins.has(origin));
  }
  function sendJSON(res, status, body) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body, null, 2)); }
  function sendFile(res, contentType, filename, body) { res.writeHead(200, { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"` }); res.end(body); }
  function requestError(message, statusCode, code = "") { const error = new Error(message); error.statusCode = statusCode; error.code = code; return error; }
  function readBody(req) {
    const contentLength = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) return Promise.reject(requestError("Request body is too large", 413, "REQUEST_TOO_LARGE"));
    return new Promise((resolve, reject) => {
      let size = 0; let complete = false; const chunks = [];
      req.on("data", (chunk) => {
        if (complete) return;
        size += chunk.length;
        if (size > maxRequestBodyBytes) { complete = true; reject(requestError("Request body is too large", 413, "REQUEST_TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      req.on("end", () => { if (!complete) { complete = true; resolve(Buffer.concat(chunks).toString("utf8")); } });
      req.on("error", (error) => { if (!complete) { complete = true; reject(error); } });
    });
  }
  return { applyResponseHeaders, sendJSON, sendFile, readBody, requestError };
}

module.exports = { createHttpTools };
