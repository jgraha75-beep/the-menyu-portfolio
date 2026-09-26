import { emptyDocument, type OfflineDocument } from "./types";

export interface OfflineStore {
  read(scope: string): Promise<OfflineDocument>;
  update(scope: string, change: (document: OfflineDocument) => void): Promise<OfflineDocument>;
}

export class IndexedDbStore implements OfflineStore {
  private database?: Promise<IDBDatabase>;
  private open() {
    this.database ||= new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error("Offline storage is unavailable on this device."));
      const request = indexedDB.open("the-menyu-offline", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("staff-data");
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other Menyu tabs to update offline storage."));
    });
    return this.database;
  }
  async read(scope: string) { return this.transaction(scope); }
  async update(scope: string, change: (document: OfflineDocument) => void) { return this.transaction(scope, change); }
  private async transaction(scope: string, change?: (document: OfflineDocument) => void): Promise<OfflineDocument> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("staff-data", change ? "readwrite" : "readonly");
      const store = tx.objectStore("staff-data");
      const request = store.get(scope);
      let document: OfflineDocument;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          document = request.result || emptyDocument();
          if (document.version !== 1) throw new Error("This saved queue needs a newer version of The Menyu.");
          if (change) { change(document); store.put(document, scope); }
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(document);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error("Could not save on this device. Your edit has not been queued."));
    });
  }
}
