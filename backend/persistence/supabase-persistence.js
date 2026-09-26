const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const { projectEvent } = require("./project-event");

function persistenceError(error) {
  const message = String(error?.message || error || "Supabase persistence failed");
  const conflict = /REVISION_CONFLICT:(\d+)/.exec(message);
  if (conflict) {
    const mapped = new Error("Another device updated this event. The latest data has been loaded; review it and retry");
    mapped.statusCode = 409;
    mapped.code = "REVISION_CONFLICT";
    mapped.currentRevision = Number(conflict[1]);
    return mapped;
  }
  const mapped = new Error(message);
  mapped.statusCode = error?.code === "P0002" ? 404 : 500;
  mapped.code = error?.code || "SUPABASE_PERSISTENCE_ERROR";
  return mapped;
}

class SupabasePersistence {
  constructor({ url, secretKey }) {
    if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required when PERSISTENCE_DRIVER=supabase");
    this.driver = "supabase";
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "the-menyu-backend" } },
    });
  }

  async initialize() {
    const { error } = await this.client.from("events").select("id").limit(1);
    if (error) throw persistenceError(error);
  }

  async readStore() {
    const { data, error } = await this.client.from("events").select("domain_snapshot").order("created_at", { ascending: true });
    if (error) throw persistenceError(error);
    return { events: (data || []).map((row) => row.domain_snapshot) };
  }

  async commitEvent(_loadedStore, event, { expectedRevision, create = false } = {}) {
    const projection = projectEvent(event);
    const { data, error } = await this.client.rpc("commit_event_aggregate", {
      p_event_id: event.id,
      p_expected_revision: expectedRevision,
      p_create: create,
      p_event: event,
      p_projection: projection,
    });
    if (error) throw persistenceError(error);
    return data;
  }

  async deleteEvent(eventId, expectedRevision) {
    const { data, error } = await this.client.rpc("delete_event_aggregate", { p_event_id: eventId, p_expected_revision: expectedRevision });
    if (error) throw persistenceError(error);
    return Boolean(data);
  }

  async saveBackup(backup) {
    const { error } = await this.client.from("backups").insert({
      id: backup.backupId,
      event_id: backup.eventId,
      kind: backup.kind || "manual",
      reason: backup.reason || "",
      source_revision: backup.event?.revision ?? 0,
      event_name: backup.eventName,
      created_by_name: backup.createdBy?.name || "Unknown",
      created_by_role: backup.createdBy?.role || "Unknown",
      event_digest: backup.integrity?.eventDigest,
      payload: backup,
      created_at: backup.createdAt,
    });
    if (error) throw persistenceError(error);
  }

  async loadBackup(eventId, backupId) {
    const { data, error } = await this.client.from("backups").select("payload").eq("event_id", eventId).eq("id", backupId).maybeSingle();
    if (error) throw persistenceError(error);
    if (!data) throw new Error("Backup not found");
    return data.payload;
  }

  async listBackups(eventId) {
    const { data, error } = await this.client.from("backups").select("id").eq("event_id", eventId).order("created_at", { ascending: false });
    if (error) throw persistenceError(error);
    return (data || []).map((row) => row.id);
  }

  async removeEventBackups(eventId) {
    const { error } = await this.client.from("backups").delete().eq("event_id", eventId);
    if (error) throw persistenceError(error);
  }

  async recordExport({ eventId, kind, format, language, filename, content, createdBy }) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    const createdAt = new Date().toISOString();
    const id = `export_${crypto.randomBytes(8).toString("hex")}`;
    const { error } = await this.client.from("exports").insert({
      id,
      event_id: eventId,
      kind,
      format,
      language,
      filename,
      content_base64: bytes.toString("base64"),
      content_digest: crypto.createHash("sha256").update(bytes).digest("hex"),
      created_by_name: createdBy?.name || "Unknown",
      created_by_role: createdBy?.role || "Unknown",
      created_at: createdAt,
    });
    if (error) throw persistenceError(error);
    return { id, createdAt };
  }
}

module.exports = { SupabasePersistence, persistenceError };
