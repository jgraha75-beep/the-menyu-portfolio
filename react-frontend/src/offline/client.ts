import type { EventSnapshot, Registration, Staff } from "../types";
import type { OfflineStore } from "./store";
import { EDIT_FIELDS, unresolved, type ActionCommand, type ActionReceipt, type LocalAction, type OfflineDocument } from "./types";

export function snapshotView(document: OfflineDocument, eventId: string): EventSnapshot | null {
  const cached = document.snapshots[eventId];
  if (!cached) return null;
  const snapshot = structuredClone(cached.snapshot);
  for (const action of document.actions) {
    if (action.eventId !== eventId || action.supersededBy || action.command.kind !== "registration_edit") continue;
    const needsOverlay = unresolved(action) || (action.receipt?.status === "synced" && action.receipt.revision > snapshot.revision);
    if (!needsOverlay) continue;
    for (const registration of snapshot.registrations) {
      if (registration.id !== action.command.registrationId) continue;
      const patch = action.receipt?.patch || action.command.patch;
      Object.assign(registration, patch);
      if (registration.members && ("memberNames" in patch || "entryName" in patch)) {
        const names = registration.members.length > 1
          ? String(registration.memberNames || "").split(/\s*(?:,|&|\/|、)\s*/).map((name) => name.trim()).filter(Boolean)
          : [registration.entryName];
        // Display the queued names without changing server-owned person links,
        // arrival state or payment calculations. Those actions stay blocked.
        registration.members = registration.members.map((member, index) => ({ ...member, name: names[index] || member.name }));
      }
    }
  }
  snapshot.event.registrations = snapshot.registrations;
  return snapshot;
}

export class OfflineClient {
  readonly scope: string;
  private running = false;
  constructor(private store: OfflineStore, apiBase: string, private actor: Staff, private send: (eventId: string, command: ActionCommand) => Promise<ActionReceipt>) {
    this.scope = JSON.stringify([apiBase.replace(/\/$/, ""), actor.name, actor.role]);
  }
  read() { return this.store.read(this.scope); }
  cache(snapshot: EventSnapshot) {
    return this.store.update(this.scope, (document) => {
      const old = document.snapshots[snapshot.event.id];
      if (!old || old.snapshot.revision <= snapshot.revision) document.snapshots[snapshot.event.id] = { snapshot, cachedAt: new Date().toISOString() };
    });
  }
  async enqueue(eventId: string, original: Registration, edited: Registration) {
    const command: ActionCommand = { version: 1, id: crypto.randomUUID(), registrationId: original.id, actor: { ...this.actor }, createdAt: new Date().toISOString(), kind: "registration_edit", patch: {}, base: {} };
    for (const field of EDIT_FIELDS) {
      if (JSON.stringify(original[field]) === JSON.stringify(edited[field])) continue;
      command.patch[field] = edited[field] ?? null;
      command.base[field] = { value: original[field] ?? null, revision: original.fieldChanges?.[field]?.revision ?? 0 };
    }
    if (!Object.keys(command.patch).length) return this.read();
    return this.store.update(this.scope, (document) => {
      if (!document.snapshots[eventId]) throw new Error("Load this event online once before saving offline edits.");
      if (document.actions.some((action) => action.eventId === eventId && action.command.registrationId === original.id && unresolved(action))) throw new Error("Sync or resolve the saved edit for this registration first.");
      if (document.actions.some((action) => action.eventId === eventId && action.command.registrationId === original.id && action.receipt?.status === "synced" && action.receipt.revision > document.snapshots[eventId].snapshot.revision)) throw new Error("The edit synced. Refresh the event before editing this registration again.");
      document.actions.push({ eventId, command });
    });
  }
  resolve(actionId: string, choice: "local" | "server") {
    return this.store.update(this.scope, (document) => {
      const original = document.actions.find((action) => action.command.id === actionId);
      if (!original?.receipt || !unresolved(original)) throw new Error("This edit has already been resolved. Refresh the queue.");
      if (choice === "local" && original.receipt.status !== "conflict") throw new Error("Dismiss the rejected edit, then make a new edit.");
      const command: ActionCommand = { version: 1, id: crypto.randomUUID(), registrationId: original.command.registrationId, actor: { ...this.actor }, createdAt: new Date().toISOString(), kind: choice === "server" ? "keep_server" : "registration_edit", resolutionOf: original.command.id, patch: {}, base: {} };
      for (const comparison of choice === "local" ? original.receipt.comparisons || [] : []) {
        command.patch[comparison.field] = comparison.localValue;
        command.base[comparison.field] = { value: comparison.serverValue, revision: comparison.serverChange.revision };
      }
      original.supersededBy = command.id;
      document.actions.push({ eventId: original.eventId, command, ...(original.receipt.serverRecorded === false ? { receipt: { actionId: command.id, registrationId: command.registrationId, status: "discarded" as const, at: command.createdAt, revision: 0, serverRecorded: false, message: "Discarded on this device; no server audit was available." } } : {}) });
    });
  }
  async sync(eventId: string) {
    if (this.running) return;
    this.running = true;
    try {
      const actions = (await this.read()).actions.filter((action) => action.eventId === eventId && !action.receipt && !action.supersededBy).slice(0, 20);
      for (const action of actions) {
        // Persisting the acknowledgement may fail too. Retry the immutable command.
        let receipt: ActionReceipt;
        try { receipt = await this.send(eventId, action.command); }
        catch (error) {
          const failure = error as { status?: number; code?: string; message?: string };
          const permanent = (failure.status === 404 && failure.message === "Event not found") || failure.status === 413 || ["INVALID_INPUT", "IDEMPOTENCY_KEY_REUSED"].includes(failure.code || "");
          if (!permanent) throw error;
          receipt = { actionId: action.command.id, registrationId: action.command.registrationId, status: "rejected", at: new Date().toISOString(), revision: 0, serverRecorded: false, message: `${failure.message || "Edit rejected"}. Kept in device history; server acknowledgement unavailable.` };
        }
        if (receipt.actionId !== action.command.id || !["synced", "conflict", "rejected", "discarded"].includes(receipt.status)) throw new Error("Unrecognized sync response. Edit remains queued.");
        await this.store.update(this.scope, (document) => {
          const saved = document.actions.find((entry) => entry.command.id === action.command.id);
          if (saved) saved.receipt = receipt;
        });
      }
    } finally { this.running = false; }
  }
}

export const eventActions = (document: OfflineDocument, eventId: string): LocalAction[] => document.actions.filter((action) => action.eventId === eventId);
