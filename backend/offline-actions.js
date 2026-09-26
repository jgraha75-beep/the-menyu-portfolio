const { digestJson } = require("./integrity");
const { invalidInput, isRecord, normalizeRegistrationFields } = require("./input-validation");

const EDIT_FIELDS = ["teamName", "memberNames", "entryName", "dob", "parentName", "genre", "region", "email", "phone", "instagramTeam", "instagramMembers", "notes", "needsReview", "reviewReasons"];
const same = (a, b) => digestJson(a ?? null) === digestJson(b ?? null);
const sameActor = (a, b) => a?.name === b?.name && a?.role === b?.role;

function fieldChanges(event, registration) {
  return Object.fromEntries(EDIT_FIELDS.map((field) => {
    const recorded = registration.fieldChanges?.[field];
    const legacy = [...event.auditLog].reverse().find((entry) => (entry.targetId === registration.id && (entry.action === "create_same_day_registration" || (entry.action === "edit_registration" && entry.details?.fields?.includes(field)))) || (entry.action === "import_csv" && entry.details?.registrationIds?.includes(registration.id)));
    return [field, recorded || { revision: 0, at: legacy?.at || registration.createdAt || null, staffName: legacy?.staffName || "Unknown (legacy record)", staffRole: legacy?.staffRole || "Unknown" }];
  }));
}

function stampFields(event, registration, fields, staff, at = new Date().toISOString()) {
  registration.fieldChanges ||= {};
  for (const field of fields) registration.fieldChanges[field] = { revision: event.revision + 1, at, staffName: staff.name, staffRole: staff.role };
}

// Pure aggregate operation: caller commits the result, receipt and audit together
// using the persistence driver's compare-and-swap transaction.
function evaluateAction(event, command, staff, { applyEdit, audit }) {
  if (!isRecord(command) || !/^[a-f0-9-]{36}$/i.test(command.id || "") || typeof command.registrationId !== "string") throw invalidInput("An action ID and registration ID are required");
  const digest = digestJson(command);
  const previous = event.offlineReceipts?.[command.id];
  if (previous) {
    if (previous.digest !== digest || !sameActor(previous.actor, staff)) {
      const error = invalidInput("This action ID was already used with different content or staff");
      error.statusCode = 409; error.code = "IDEMPOTENCY_KEY_REUSED"; throw error;
    }
    return { result: previous.result, replay: true };
  }
  if (!sameActor(command.actor, staff)) throw Object.assign(invalidInput("Sign in as the staff member who saved this edit"), { statusCode: 403 });
  const at = new Date().toISOString();
  const result = { actionId: command.id, registrationId: command.registrationId, status: "rejected", at, revision: event.revision + 1 };
  const registration = event.registrations.find((entry) => entry.id === command.registrationId);
  try {
    if (command.version !== 1 || !Number.isFinite(Date.parse(command.createdAt))) throw invalidInput("Unsupported action version or timestamp");
    const original = command.resolutionOf && event.offlineReceipts?.[command.resolutionOf];
    if (command.resolutionOf && (!original || !sameActor(original.actor, staff) || original.result.registrationId !== command.registrationId || !["conflict", "rejected"].includes(original.result.status))) throw invalidInput("Choose an unresolved action from this registration");
    if (original?.resolvedBy) throw invalidInput("This action was already resolved on another tab");
    if (command.kind === "keep_server") {
      if (!original) throw invalidInput("Choose an action to dismiss");
      result.status = "discarded";
    } else {
      if (command.kind !== "registration_edit") throw invalidInput("Unsupported offline action");
      if (!registration) throw invalidInput("Registration no longer exists");
      if (!["draft", "active"].includes(event.lifecycle.status)) throw invalidInput(`Event is ${event.lifecycle.status}; activate it before editing`);
      if (!isRecord(command.patch) || !isRecord(command.base)) throw invalidInput("Edit fields and base values are required");
      const fields = Object.keys(command.patch);
      if (!fields.length || fields.some((field) => !EDIT_FIELDS.includes(field))) throw invalidInput("Only registration details can be edited offline");
      const normalized = normalizeRegistrationFields(command.patch);
      const stamps = fieldChanges(event, registration);
      const comparisons = fields.map((field) => {
        if (!isRecord(command.base[field]) || !Number.isInteger(command.base[field].revision) || !Object.hasOwn(command.base[field], "value")) throw invalidInput(`Missing base value for ${field}`);
        return { field, localValue: normalized[field], serverValue: registration[field] ?? null, serverChange: stamps[field] };
      });
      const conflicts = comparisons.filter(({ field, serverValue, serverChange }) => !same(command.base[field].value, serverValue) || command.base[field].revision !== serverChange.revision);
      if (conflicts.length) {
        result.status = "conflict";
        // Include every edited field so a reviewed retry has a complete, precise base.
        result.comparisons = comparisons;
        result.message = "Another change overlaps this edit. Review both versions.";
      } else {
        applyEdit(event, registration, normalized, staff);
        result.status = "synced";
        result.patch = Object.fromEntries(fields.map((field) => [field, registration[field]]));
      }
    }
    if (original) original.resolvedBy = command.id;
  } catch (error) {
    if (error.code !== "INVALID_INPUT") throw error;
    result.message = error.message;
  }
  audit(event, staff, `offline_${result.status}`, "registration", command.registrationId, { actionId: command.id, queuedAt: command.createdAt, resolutionOf: command.resolutionOf || null, base: command.base, patch: command.patch, comparisons: result.comparisons, reason: result.message });
  event.offlineReceipts ||= {};
  event.offlineReceipts[command.id] = { digest, actor: { ...staff }, result };
  return { result, replay: false };
}

module.exports = { EDIT_FIELDS, fieldChanges, stampFields, evaluateAction };
