// Uses an existing Playwright installation; never downloads browsers or packages.
// Run after VITE_API_URL=/api npm run build, with MENYU_PLAYWRIGHT_MODULE set if not locally installed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.MENYU_PLAYWRIGHT_MODULE || "playwright");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "menyu-offline-browser-"));
process.env.DATA_FILE = path.join(temporary, "events.json");
process.env.BACKUP_DIR = path.join(temporary, "backups");
process.env.PERSISTENCE_DRIVER = "json";
process.env.NODE_ENV = "test"; process.env.VERCEL = "0";
process.env.STAFF_ACCESS_CODE = "offline-browser-test";
process.env.SESSION_SECRET = "offline-browser-test-secret-at-least-32-characters";
const api = require("../backend/server");
const dist = path.resolve(__dirname, "../react-frontend/dist");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return api(req, res);
  const relative = new URL(req.url, "http://local").pathname;
  const candidate = path.join(dist, relative);
  const file = candidate.startsWith(dist + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(dist, "index.html");
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = "GET", body, revision) {
    const response = await fetch(`${origin}/api${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(revision === undefined ? {} : { "If-Match": String(revision) }) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  }
  let token;
  token = (await request("/auth/login", "POST", { accessCode: "offline-browser-test", staff: { name: "Remote staff", role: "General staff" } })).token;
  const event = await request("/events", "POST", { name: "Offline rehearsal", mode: "rehearsal" });
  const registration = await request(`/events/${event.id}/registrations`, "POST", { bracket: "under15", entryName: "Test dancer", notes: "Before", genre: "Hip hop" });
  const snapshot = () => request(`/events/${event.id}/snapshot`);
  const remoteEdit = async (notes) => { const current = await snapshot(); return request(`/events/${event.id}/registrations/${registration.id}`, "PATCH", { notes, expectedUpdatedAt: current.registrations[0].updatedAt }, current.revision); };
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const wait = (text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 25000 });
  try {
    await page.addInitScript(({ eventId }) => { localStorage.setItem("menyuEventId", eventId); localStorage.setItem("menyuWorkspace", "checkin"); localStorage.setItem("menyuDivision", "under15"); }, { eventId: event.id });
    await page.goto(origin);
    await page.locator('[name="staff-name"]').fill("Local staff");
    await page.locator('[name="staff-access-code"]').fill("offline-browser-test");
    await page.getByRole("button", { name: "Enter staff desk", exact: true }).click();
    await wait("Event saved on this device:");
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 20000 });
    console.log("Signed in; complete production shell is cached.");
    const edit = async (notes) => {
      await page.getByRole("button", { name: "Edit registration", exact: true }).click();
      await page.getByRole("dialog").getByLabel(/^Notes/).fill(notes);
      assert.equal(await page.getByRole("dialog").getByLabel("Battler name", { exact: true }).inputValue(), "Test dancer", "Editing notes must not type into a different field");
      assert.equal(await page.getByRole("dialog").getByLabel(/^Notes/).inputValue(), notes);
      await page.getByRole("button", { name: "Save on this device", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    };
    await context.setOffline(true); await wait("Offline · saved event");
    await edit("Local offline notes"); await wait("1 waiting to sync");
    await page.reload(); await wait("1 waiting to sync"); await wait("Local offline notes");
    console.log("Offline edit survived reload.");
    assert.equal((await snapshot()).registrations[0].notes, "Before");
    await remoteEdit("Remote staff notes");
    await context.setOffline(false); await wait("Compare conflicting edit");
    await wait("Your saved value"); await wait("Server value"); await wait("Remote staff notes");
    assert.ok(await page.getByRole("button", { name: /Record next arrival/ }).isDisabled(), "Do not check in an entry while its details are unresolved");
    await page.evaluate(() => { window.scrollTo(0, 0); document.getAnimations().forEach((animation) => animation.finish()); });
    assert.ok(await page.locator(".arrival-detail").evaluate((element) => element.getBoundingClientRect().right <= element.closest(".arrival-workbench").getBoundingClientRect().right + 1), "Desktop details and pending-edit warning must not be clipped by the activity rail");
    await page.screenshot({ path: path.join(temporary, "conflict-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.scrollTo(0, 0); document.getAnimations().forEach((animation) => animation.finish()); });
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".menyu-sidebar")).visibility === "hidden");
    await page.screenshot({ path: path.join(temporary, "conflict-mobile.png"), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile page must not overflow horizontally");
    await page.getByRole("button", { name: "Apply reviewed local values", exact: true }).click();
    await wait("0 waiting to sync · 0 need review");
    assert.equal((await snapshot()).registrations[0].notes, "Local offline notes");

    // Server commits but the browser loses the response: retry must not apply twice.
    let lost = false;
    await page.route("**/offline-actions", async (route) => {
      if (lost) return route.continue();
      lost = true; await route.fetch(); await route.abort("failed");
    });
    await edit("Lost response notes");
    await page.waitForFunction(() => document.querySelector(".offline-sync__history")?.textContent.includes("synced"));
    await wait("0 waiting to sync · 0 need review");
    const final = await snapshot();
    assert.equal(final.registrations[0].notes, "Lost response notes");
    assert.equal(final.report.auditLog.filter((entry) => entry.action === "offline_synced" && entry.details.patch?.notes === "Lost response notes").length, 1);
    assert.ok(lost, "The lost-response path ran");
    await page.getByRole("button", { name: "Edit registration", exact: true }).click();
    await page.getByRole("dialog").getByLabel(/^Notes/).fill("Must remain in the editor");
    await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException("Test device storage full", "QuotaExceededError"); }; });
    await page.getByRole("button", { name: "Save on this device", exact: true }).click();
    await wait("Test device storage full");
    assert.equal(await page.getByRole("dialog").getByLabel(/^Notes/).inputValue(), "Must remain in the editor");
    assert.equal((await snapshot()).registrations[0].notes, "Lost response notes");
    assert.deepEqual(errors, []);
    console.log(`PASS: offline reload, IndexedDB queue, reconnect conflict, resolution, lost acknowledgement, storage failure, desktop/mobile. Screenshots: ${temporary}`);
  } catch (error) {
    await page.screenshot({ path: path.join(temporary, "failure.png"), fullPage: true });
    console.error(await page.locator('[role="dialog"]').evaluateAll((elements) => elements.map((element) => ({ inert: element.closest("[inert]")?.tagName, labels: [...element.querySelectorAll("label")].map((label) => label.textContent), hidden: element.closest('[aria-hidden="true"]')?.tagName }))));
    console.error(`Browser failure evidence: ${temporary}`, errors); throw error;
  } finally { await browser.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { server.closeAllConnections(); server.close(); });
