import type { EventSnapshot, Staff } from "../types";

export const EDIT_FIELDS = ["teamName", "memberNames", "entryName", "dob", "parentName", "genre", "region", "email", "phone", "instagramTeam", "instagramMembers", "notes", "needsReview", "reviewReasons"] as const;
export type EditField = typeof EDIT_FIELDS[number];
export type FieldValue = string | string[] | boolean | null;
export type FieldChange = { revision: number; at: string | null; staffName: string; staffRole: string };
export type ActionCommand = {
  version: 1; id: string; registrationId: string; actor: Staff; createdAt: string;
  kind: "registration_edit" | "keep_server"; resolutionOf?: string;
  patch: Partial<Record<EditField, FieldValue>>;
  base: Partial<Record<EditField, { value: FieldValue; revision: number }>>;
};
export type ActionReceipt = {
  actionId: string; registrationId: string; status: "synced" | "conflict" | "rejected" | "discarded";
  at: string; revision: number; message?: string; patch?: ActionCommand["patch"];
  serverRecorded?: boolean;
  comparisons?: Array<{ field: EditField; localValue: FieldValue; serverValue: FieldValue; serverChange: FieldChange }>;
};
export type LocalAction = { eventId: string; command: ActionCommand; receipt?: ActionReceipt; supersededBy?: string };
export type OfflineDocument = { version: 1; snapshots: Record<string, { snapshot: EventSnapshot; cachedAt: string }>; actions: LocalAction[] };
export const emptyDocument = (): OfflineDocument => ({ version: 1, snapshots: {}, actions: [] });
export const unresolved = (action: LocalAction) => !action.supersededBy && (!action.receipt || ["conflict", "rejected"].includes(action.receipt.status));
