import { describe, expect, it, vi } from "vitest";
import type { EventSnapshot, Registration } from "../types";
import { OfflineClient, snapshotView } from "./client";
import type { OfflineStore } from "./store";
import { emptyDocument, type ActionCommand, type ActionReceipt, type OfflineDocument } from "./types";

class MemoryStore implements OfflineStore {
  values = new Map<string, OfflineDocument>();
  fail = false;
  async read(scope: string) { return structuredClone(this.values.get(scope) || emptyDocument()); }
  async update(scope: string, change: (document: OfflineDocument) => void) {
    if (this.fail) throw new Error("Storage full");
    const document = structuredClone(this.values.get(scope) || emptyDocument());
    change(document); this.values.set(scope, structuredClone(document)); return document;
  }
}
const actor = { name: "Door", role: "Staff" };
const registration = { id: "reg-1", notes: "original", entryName: "Name", fieldChanges: { notes: { revision: 2, at: "2026-09-24T00:00:00Z", staffName: "Door", staffRole: "Staff" } } } as unknown as Registration;
const fixture = { revision: 2, event: { id: "event", registrations: [registration] }, registrations: [registration], report: {} } as EventSnapshot;
const accepted = (command: ActionCommand): ActionReceipt => ({ actionId: command.id, registrationId: command.registrationId, status: "synced", at: new Date().toISOString(), revision: 3, patch: command.patch });
function setup(send = vi.fn(async (_id: string, action: ActionCommand) => accepted(action)), store = new MemoryStore()) {
  return { store, send, client: new OfflineClient(store, "/api", actor, send) };
}

describe("durable offline edits", () => {
  it("shows queued solo and team names without changing confirmed members or payments", async () => {
    for (const names of [1, 2]) {
      const { client } = setup();
      const original = { ...registration, memberNames: "One、Two", members: Array.from({ length: names }, (_, index) => ({ name: `Original ${index}`, personId: `person-${index}`, checkedIn: true })), payment: { total: 4000 } } as Registration;
      await client.cache({ ...fixture, registrations: [original] });
      const edited = names === 1 ? { ...original, entryName: "New solo" } : { ...original, memberNames: "New one、New two" };
      const document = await client.enqueue("event", original, edited);
      const view = snapshotView(document, "event")!.registrations[0];
      expect(view.members.map((member) => member.name)).toEqual(names === 1 ? ["New solo"] : ["New one", "New two"]);
      expect(view.members[0]).toMatchObject({ personId: "person-0", checkedIn: true });
      expect(view.payment.total).toBe(4000);
      expect(document.snapshots.event.snapshot.registrations[0].members[0].name).toBe("Original 0");
    }
  });

  it("saves a local overlay without replacing the server snapshot; reload/reconnect uses the original key", async () => {
    const { client, store, send } = setup();
    await client.cache(fixture);
    await client.enqueue("event", registration, { ...registration, notes: "offline" });
    const local = await client.read();
    expect(local.snapshots.event.snapshot.registrations[0].notes).toBe("original");
    expect(snapshotView(local, "event")?.registrations[0].notes).toBe("offline");
    const reloaded = setup(send, store).client;
    await reloaded.sync("event");
    expect(send.mock.calls[0][1].id).toBe(local.actions[0].command.id);
    expect((await reloaded.read()).actions[0].receipt?.status).toBe("synced");
    await reloaded.sync("event"); expect(send).toHaveBeenCalledOnce();
    expect(snapshotView(await reloaded.read(), "event")?.registrations[0].notes).toBe("offline");
    await reloaded.cache({ ...fixture, revision: 3, registrations: [{ ...registration, notes: "normalized" }] });
    expect(snapshotView(await reloaded.read(), "event")?.registrations[0].notes).toBe("normalized");
  });

  it("retains pending commands after lost response and receipt-write failures", async () => {
    const { client, store, send } = setup(); await client.cache(fixture);
    await client.enqueue("event", registration, { ...registration, notes: "pending" });
    send.mockRejectedValueOnce(new TypeError("Network disconnected"));
    await expect(client.sync("event")).rejects.toThrow("Network disconnected");
    expect((await client.read()).actions[0].receipt).toBeUndefined();
    store.fail = true;
    await expect(client.sync("event")).rejects.toThrow("Storage full");
    store.fail = false; await client.sync("event");
    expect(send.mock.calls.map((call) => call[1].id)).toEqual(Array(3).fill(send.mock.calls[0][1].id));
  });

  it("keeps successful work on partial failure and resumes only unacknowledged actions", async () => {
    const { client, send } = setup(); await client.cache(fixture);
    for (let index = 0; index < 3; index++) await client.enqueue("event", { ...registration, id: `reg-${index}` }, { ...registration, notes: String(index) });
    send.mockImplementationOnce(async (_id, action) => accepted(action)).mockRejectedValueOnce(new Error("503"));
    await expect(client.sync("event")).rejects.toThrow("503");
    expect((await client.read()).actions.map((action) => action.receipt?.status)).toEqual(["synced", undefined, undefined]);
    await client.sync("event");
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[1][1].id).toBe(send.mock.calls[2][1].id);
  });

  it("continues independent actions after conflict and makes resolution a new, reviewed command", async () => {
    const { client, send } = setup(); await client.cache(fixture);
    await client.enqueue("event", registration, { ...registration, notes: "local" });
    await client.enqueue("event", { ...registration, id: "reg-2" }, { ...registration, notes: "independent" });
    send.mockImplementationOnce(async (_id, action) => ({ ...accepted(action), status: "conflict", comparisons: [{ field: "notes", localValue: "local", serverValue: "remote", serverChange: { revision: 9, at: "2026-09-24T01:00:00Z", staffName: "Other", staffRole: "Staff" } }] }));
    await client.sync("event");
    const original = (await client.read()).actions[0];
    expect(send).toHaveBeenCalledTimes(2);
    await expect(client.enqueue("event", registration, { ...registration, notes: "another" })).rejects.toThrow("Sync or resolve");
    const resolved = await client.resolve(original.command.id, "local");
    const resolution = resolved.actions.at(-1)!.command;
    expect(resolution.id).not.toBe(original.command.id);
    expect(resolution.base.notes).toEqual({ value: "remote", revision: 9 });
    expect(resolved.actions[0].command).toEqual(original.command);
    expect(resolution.resolutionOf).toBe(original.command.id);
  });

  it("isolates staff, API and events, preserves neighboring tab writes and reports storage failure", async () => {
    const { client, store, send } = setup(); await client.cache(fixture);
    const secondTab = setup(send, store).client;
    await Promise.all([client.enqueue("event", registration, { ...registration, notes: "first" }), secondTab.enqueue("event", { ...registration, id: "reg-2" }, { ...registration, notes: "second" })]);
    expect((await client.read()).actions).toHaveLength(2);
    expect(snapshotView(await client.read(), "another-event")).toBeNull();
    expect((await new OfflineClient(store, "/api", { name: "Other", role: "Staff" }, send).read()).actions).toHaveLength(0);
    expect((await new OfflineClient(store, "https://other/api", actor, send).read()).actions).toHaveLength(0);
    store.fail = true;
    await expect(client.enqueue("event", { ...registration, id: "reg-3" }, { ...registration, notes: "lost" })).rejects.toThrow("Storage full");
    expect((await client.read()).actions).toHaveLength(2);
  });

  it("does not lose a queued edit when authentication expires", async () => {
    const { client, send } = setup(); await client.cache(fixture);
    await client.enqueue("event", registration, { ...registration, notes: "keep" });
    send.mockRejectedValueOnce(Object.assign(new Error("Sign in again"), { status: 401 }));
    await expect(client.sync("event")).rejects.toThrow("Sign in again");
    expect((await client.read()).actions[0].receipt).toBeUndefined();
    await client.sync("event"); expect((await client.read()).actions[0].receipt?.status).toBe("synced");
  });
  it("records permanent rejection locally, continues independent edits and allows explicit dismissal", async () => {
    const { client, send } = setup(); await client.cache(fixture);
    await client.enqueue("event", registration, { ...registration, notes: "gone" });
    await client.enqueue("event", { ...registration, id: "reg-2" }, { ...registration, notes: "next" });
    send.mockRejectedValueOnce(Object.assign(new Error("Event not found"), { status: 404 }));
    await client.sync("event");
    const document = await client.read();
    expect(document.actions.map((action) => action.receipt?.status)).toEqual(["rejected", "synced"]);
    expect(document.actions[0].receipt?.serverRecorded).toBe(false);
    const dismissed = await client.resolve(document.actions[0].command.id, "server");
    expect(dismissed.actions.at(-1)?.receipt?.status).toBe("discarded");
    await client.sync("event"); expect(send).toHaveBeenCalledTimes(2);
  });
  it("keeps uncertain server failures pending and blocks edits until an acknowledged snapshot arrives", async () => {
    const { client, send } = setup(); await client.cache(fixture);
    await client.enqueue("event", registration, { ...registration, notes: "pending" });
    for (const status of [500, 400]) {
      send.mockRejectedValueOnce(Object.assign(new Error("Persistence unavailable"), { status }));
      await expect(client.sync("event")).rejects.toThrow("Persistence unavailable");
      expect((await client.read()).actions[0].receipt).toBeUndefined();
    }
    await client.sync("event");
    await expect(client.enqueue("event", registration, { ...registration, notes: "second" })).rejects.toThrow("Refresh the event");
  });
});
