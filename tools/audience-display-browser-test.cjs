// Runs against the production build without contacting a real event database.
// Use: VITE_API_URL=/api npm run build && node tools/audience-display-browser-test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.MENYU_PLAYWRIGHT_MODULE || "playwright");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "menyu-audience-display-"));
process.env.DATA_FILE = path.join(temporary, "events.json");
process.env.BACKUP_DIR = path.join(temporary, "backups");
process.env.PERSISTENCE_DRIVER = "json";
process.env.NODE_ENV = "test";
process.env.VERCEL = "0";
process.env.STAFF_ACCESS_CODE = "audience-display-test";
process.env.SESSION_SECRET = "audience-display-test-secret-at-least-32-characters";

const api = require("../backend/server");
const dist = path.resolve(__dirname, "../react-frontend/dist");
const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return api(req, res);
  const pathname = new URL(req.url, "http://local").pathname;
  const candidate = path.join(dist, pathname);
  const file = candidate.startsWith(`${dist}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(dist, "index.html");
  res.setHeader("Content-Type", contentTypes[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let token = "";
  let revision;
  const request = async (route, method = "GET", body) => {
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(revision === undefined || method === "GET" ? {} : { "If-Match": String(revision) }) };
    const response = await fetch(`${origin}/api${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(payload)}`);
    const nextRevision = Number(response.headers.get("x-event-revision"));
    if (Number.isInteger(nextRevision)) revision = nextRevision;
    return payload;
  };
  token = (await request("/auth/login", "POST", { accessCode: "audience-display-test", staff: { name: "Projection QA", role: "Test" } })).token;
  const event = await request("/events", "POST", { name: "CHIP CHOP ALL STYLES", eventTime: "2026-09-24 19:00" });
  const registrations = [];
  for (const [sourceNumber, teamName] of [["01", "Bamboo Crew"], ["02", "Crimson Step"], ["03", "Jade Motion"], ["04", "Golden Hour"]]) {
    registrations.push(await request(`/events/${event.id}/registrations`, "POST", { bracket: "2v2", sourceNumber, teamName, memberNames: `${teamName} A / ${teamName} B` }));
  }
  for (const registration of registrations) {
    await request(`/events/${event.id}/registrations/${registration.id}/check-in`, "POST", { memberIndex: 0 });
    await request(`/events/${event.id}/registrations/${registration.id}/check-in`, "POST", { memberIndex: 1 });
  }
  const bracket = await request(`/events/${event.id}/bracket`, "POST", { bracket: "2v2" });
  assert.ok(bracket.rounds.length, "A generated bracket supplies a live audience matchup");

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}/display?event=${event.id}&division=2v2`, { waitUntil: "networkidle" });
    await page.getByText("CHIP CHOP ALL STYLES", { exact: true }).waitFor();
    await page.getByText("Bamboo Crew", { exact: true }).waitFor();
    await page.getByText("On deck", { exact: true }).waitFor();
    await page.getByRole("timer").waitFor();
    assert.equal(await page.getByRole("button").count(), 0, "The audience projection includes no staff actions");
    const audienceText = (await page.locator("main.audience-display").innerText()).toLowerCase();
    for (const privateTerm of ["staff", "audit", "configuration", "settings", "controls"]) assert.equal(audienceText.includes(privateTerm), false, `Audience display does not show ${privateTerm}`);
    assert.ok(await page.locator(".audience-display__header img").count() >= 2, "Event branding and mascot art are both rendered");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Desktop display has no horizontal overflow");
    await page.screenshot({ path: path.join(temporary, "audience-1920x1080.png") });

    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Large-screen display has no horizontal overflow");
    const board = await page.locator(".audience-display__board").boundingBox();
    assert.ok(board && board.width > 2400, "Large-screen display uses the available projection width");
    await page.screenshot({ path: path.join(temporary, "audience-2560x1440.png") });

    await context.setOffline(true);
    await page.waitForFunction(() => document.body.textContent.includes("Connection interrupted"), { timeout: 12000 });
    assert.equal(await page.getByRole("button").count(), 0, "Disconnected display remains read-only");
    assert.deepEqual(errors, []);
    console.log(`PASS: audience projection, branding, desktop/large-screen layout, and disconnect state. Screenshots: ${temporary}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { server.closeAllConnections(); server.close(); });
