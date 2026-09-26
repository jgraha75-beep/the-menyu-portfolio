import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicDisplay, MenyuApi } from "./api";

const staff = { name: "Test Staff", role: "Operations" };
const eventId = "event_test";
const response = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...init.headers }, ...init });

function installFetch(...responses: Response[]) {
  const mock = vi.fn();
  responses.forEach((item) => mock.mockResolvedValueOnce(item));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function apiWithRevision() {
  const api = new MenyuApi("https://menyu.example/api");
  api.setToken("staff-session");
  return api;
}

describe("staff workflow API calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("logs a staff member in", async () => {
    const fetchMock = installFetch(response({ token: "staff-session", staff }));
    const api = new MenyuApi("https://menyu.example/api");

    await expect(api.login("access-code", staff)).resolves.toEqual({ token: "staff-session", staff });
    expect(fetchMock).toHaveBeenCalledWith("https://menyu.example/api/auth/login", expect.objectContaining({ method: "POST", body: JSON.stringify({ accessCode: "access-code", staff }) }));
  });

  it("records a check-in with the active staff session", async () => {
    const fetchMock = installFetch(response({ message: "Checked in", registration: { id: "reg_1" } }));
    const api = apiWithRevision();

    await api.checkIn(eventId, "reg_1", 0, staff);
    expect(fetchMock).toHaveBeenCalledWith(`https://menyu.example/api/events/${eventId}/registrations/reg_1/check-in`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer staff-session" }), body: JSON.stringify({ memberIndex: 0, staff }) }));
  });

  it("downloads authenticated exports as files", async () => {
    const fetchMock = installFetch(new Response("name\nCHIP CHOP", { status: 200, headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=chip-chop.csv" } }));
    const createObjectURL = vi.fn(() => "blob:export"); const revokeObjectURL = vi.fn(); const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const api = apiWithRevision();

    await api.downloadExport(eventId, "combined", "csv", "en");
    expect(fetchMock).toHaveBeenCalledWith(`https://menyu.example/api/events/${eventId}/exports/combined.csv?lang=en`, expect.objectContaining({ headers: { Authorization: "Bearer staff-session" } }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    click.mockRestore();
  });

  it("sends prelim order and score decisions with the current event revision", async () => {
    const fetchMock = installFetch(response([{ id: eventId, revision: 7 }]), response([], { headers: { "X-Event-Revision": "8" } }), response({ id: "reg_1" }));
    const api = apiWithRevision();
    await api.events();

    await api.generatePrelimOrder(eventId, "2v2", staff);
    await api.saveScore(eventId, "reg_1", 1, 5, "Judge One", "2026-08-27T00:00:00.000Z", staff);
    expect(fetchMock.mock.calls[1]).toEqual([`https://menyu.example/api/events/${eventId}/prelim-order`, expect.objectContaining({ headers: expect.objectContaining({ "If-Match": '"7"' }), body: JSON.stringify({ bracket: "2v2", staff }) })]);
    expect(fetchMock.mock.calls[2]).toEqual([`https://menyu.example/api/events/${eventId}/registrations/reg_1/scores`, expect.objectContaining({ headers: expect.objectContaining({ "If-Match": '"8"' }), body: JSON.stringify({ judgeNumber: 1, score: 5, judgeName: "Judge One", expectedUpdatedAt: "2026-08-27T00:00:00.000Z", staff }) })]);
  });

  it("records bracket performance completion and the operator decision", async () => {
    const fetchMock = installFetch(response([{ id: eventId, revision: 9 }]), response({ id: "match_1" }, { headers: { "X-Event-Revision": "10" } }), response({ id: "match_1", winnerId: "reg_1" }));
    const api = apiWithRevision();
    await api.events();

    await api.completePerformanceRound(eventId, "2v2", "match_1", staff);
    await api.recordMatchOutcome(eventId, "2v2", "match_1", "reg_1", staff);
    expect(fetchMock.mock.calls[1][0]).toBe(`https://menyu.example/api/events/${eventId}/bracket/2v2/matches/match_1/complete-performance-round`);
    expect(fetchMock.mock.calls[2][0]).toBe(`https://menyu.example/api/events/${eventId}/bracket/2v2/matches/match_1/decision`);
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer staff-session", "If-Match": '"10"' }), body: JSON.stringify({ outcome: "reg_1", staff }) }));
  });

  it("loads the public display without a staff session", async () => {
    const fetchMock = installFetch(response({ event: { id: eventId }, entries: [], bracket: null, timer: null }));

    await fetchPublicDisplay("https://menyu.example/api", eventId, "2v2");

    expect(fetchMock).toHaveBeenCalledWith(`https://menyu.example/api/public/events/${eventId}/display?division=2v2`, expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
  });

  it("previews PDF imports without advancing the event revision and sends undo requests", async () => {
    const fetchMock = installFetch(response([{ id: eventId, revision: 4 }]), response({ canImport: true, records: [], warnings: [], errors: [] }), response({ imports: [] }), response({ importId: "backup_1", removed: 2, imports: [] }));
    const api = apiWithRevision();
    await api.events();
    await api.previewImport(eventId, "2v2", { type: "pdf", content: "JVBERi0=" }, staff);
    await api.importHistory(eventId);
    await api.undoLastImport(eventId, staff);
    expect(fetchMock.mock.calls[1]).toEqual([`https://menyu.example/api/events/${eventId}/import/preview`, expect.objectContaining({ method: "POST", body: JSON.stringify({ bracket: "2v2", source: "pdf", fileBase64: "JVBERi0=", staff }) })]);
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty("If-Match");
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ method: "POST", body: JSON.stringify({ staff }) }));
  });

  it("uses the narrow judge endpoints for a current entry and submitted score", async () => {
    const fetchMock = installFetch(
      response({ event: { id: eventId }, division: { id: "under15" }, judge: { judgeNumber: 1 }, current: { id: "reg_1", updatedAt: "2026-09-20T00:00:00.000Z" } }, { headers: { "X-Event-Revision": "4" } }),
      response({ registration: { id: "reg_1" }, score: { state: "submitted", score: 8 }, locked: false }, { headers: { "X-Event-Revision": "5" } }),
    );
    const api = apiWithRevision();

    await api.judgeSession(eventId, "under15");
    await api.saveJudgeScore(eventId, "under15", "reg_1", 8, "submitted", "2026-09-20T00:00:00.000Z");

    expect(fetchMock.mock.calls[0][0]).toBe(`https://menyu.example/api/events/${eventId}/judging/under15/session`);
    expect(fetchMock.mock.calls[1]).toEqual([`https://menyu.example/api/events/${eventId}/judging/under15/score`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer staff-session", "If-Match": '"4"' }), body: JSON.stringify({ registrationId: "reg_1", score: 8, state: "submitted", expectedUpdatedAt: "2026-09-20T00:00:00.000Z" }) })]);
  });

  it("uses revision-protected finance entry, review, and close endpoints", async () => {
    const report = { eventId, status: "open", transactions: [] };
    const fetchMock = installFetch(
      response([{ id: eventId, revision: 12 }]),
      response({ report }, { headers: { "X-Event-Revision": "13" } }),
      response({ ...report, status: "review" }, { headers: { "X-Event-Revision": "14" } }),
      response({ ...report, status: "closed" }, { headers: { "X-Event-Revision": "15" } }),
    );
    const api = apiWithRevision(); await api.events();
    await api.addFinancialTransaction(eventId, { category: "venue_expense", description: "Venue", expectedAmount: 1000, actualAmount: 1200 }, staff);
    await api.reviewFinances(eventId, "Counted", staff);
    await api.closeEventFinances(eventId, staff);

    expect(fetchMock.mock.calls[1]).toEqual([`https://menyu.example/api/events/${eventId}/finance/transactions`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "If-Match": '"12"' }), body: JSON.stringify({ category: "venue_expense", description: "Venue", expectedAmount: 1000, actualAmount: 1200, staff }) })]);
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ "If-Match": '"13"' }), body: JSON.stringify({ notes: "Counted", staff }) }));
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ "If-Match": '"14"' }), body: JSON.stringify({ staff }) }));
  });
});
