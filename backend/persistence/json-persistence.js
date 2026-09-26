const fs = require("node:fs");
const path = require("node:path");

function revisionConflict(currentRevision) {
  const error = new Error("Another device updated this event. The latest data has been loaded; review it and retry");
  error.statusCode = 409;
  error.code = "REVISION_CONFLICT";
  error.currentRevision = currentRevision;
  return error;
}

class JsonPersistence {
  constructor({ dataFile, backupDirectory }) {
    this.driver = "json";
    this.dataFile = dataFile;
    this.backupDirectory = backupDirectory;
  }

  async initialize() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    if (!fs.existsSync(this.dataFile)) this.writeStoreAtomic({ events: [] });
  }

  async readStore() {
    return this.readStoreSync();
  }

  readStoreSync() {
    const store = JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
    store.events ||= [];
    return store;
  }

  writeStoreAtomic(store) {
    const temporary = `${this.dataFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(store, null, 2));
    fs.renameSync(temporary, this.dataFile);
  }

  async commitEvent(_loadedStore, event, { expectedRevision, create = false } = {}) {
    // Keep read/CAS/write in one event-loop turn. Awaiting the read allowed two
    // requests to compare the same revision and both commit successfully.
    const currentStore = this.readStoreSync();
    const index = currentStore.events.findIndex((candidate) => candidate.id === event.id);
    const current = index >= 0 ? currentStore.events[index] : null;

    if (create) {
      if (current) throw revisionConflict(current.revision);
      currentStore.events.push(event);
    } else {
      if (!current) {
        const error = new Error("Event not found");
        error.statusCode = 404;
        throw error;
      }
      if (current.revision !== expectedRevision) throw revisionConflict(current.revision);
      currentStore.events[index] = event;
    }

    this.writeStoreAtomic(currentStore);
  }

  async deleteEvent(eventId, expectedRevision) {
    const currentStore = this.readStoreSync();
    const index = currentStore.events.findIndex((candidate) => candidate.id === eventId);
    if (index < 0) return false;
    if (currentStore.events[index].revision !== expectedRevision) throw revisionConflict(currentStore.events[index].revision);
    currentStore.events.splice(index, 1);
    this.writeStoreAtomic(currentStore);
    await this.removeEventBackups(eventId);
    return true;
  }

  backupPath(eventId, backupId) {
    if (!/^backup_[a-f0-9]{12}$/.test(String(backupId || ""))) throw new Error("Invalid backup ID");
    return path.join(this.backupDirectory, eventId, `${backupId}.json`);
  }

  async saveBackup(backup) {
    const filePath = this.backupPath(backup.eventId, backup.backupId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(backup, null, 2));
    fs.renameSync(temporary, filePath);
  }

  async loadBackup(eventId, backupId) {
    const filePath = this.backupPath(eventId, backupId);
    if (!fs.existsSync(filePath)) throw new Error("Backup not found");
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  async listBackups(eventId) {
    const directory = path.join(this.backupDirectory, eventId);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((file) => /^backup_[a-f0-9]{12}\.json$/.test(file)).map((file) => file.slice(0, -5));
  }

  async removeEventBackups(eventId) {
    const directory = path.join(this.backupDirectory, eventId);
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  }

  async recordExport() {
    // Local JSON mode keeps exports ephemeral, matching the existing prototype.
  }
}

module.exports = { JsonPersistence, revisionConflict };
