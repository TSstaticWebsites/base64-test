// IndexedDB utilities for storing base64 chunks

const DB_NAME = 'Base64DecodingTest';
const DB_VERSION = 1;
const CHUNK_STORE = 'chunks';

export interface StoredChunk {
  fileId: string;
  chunkNumber: number;
  data: string;
  timestamp: number;
}

export class ChunkStorage {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create chunks store
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          const store = db.createObjectStore(CHUNK_STORE, { keyPath: ['fileId', 'chunkNumber'] });
          store.createIndex('fileId', 'fileId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async storeChunk(fileId: string, chunkNumber: number, data: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([CHUNK_STORE], 'readwrite');
      const store = transaction.objectStore(CHUNK_STORE);
      
      const chunk: StoredChunk = {
        fileId,
        chunkNumber,
        data,
        timestamp: Date.now()
      };

      const request = store.put(chunk);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getChunk(fileId: string, chunkNumber: number): Promise<string | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([CHUNK_STORE], 'readonly');
      const store = transaction.objectStore(CHUNK_STORE);
      
      const request = store.get([fileId, chunkNumber]);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllChunksForFile(fileId: string): Promise<string[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([CHUNK_STORE], 'readonly');
      const store = transaction.objectStore(CHUNK_STORE);
      const index = store.index('fileId');
      
      const request = index.getAll(fileId);
      request.onsuccess = () => {
        const chunks = request.result as StoredChunk[];
        // Sort by chunk number and return just the data
        chunks.sort((a, b) => a.chunkNumber - b.chunkNumber);
        resolve(chunks.map(chunk => chunk.data));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getStoredChunkCount(fileId: string): Promise<number> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([CHUNK_STORE], 'readonly');
      const store = transaction.objectStore(CHUNK_STORE);
      const index = store.index('fileId');
      
      const request = index.count(fileId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteFileChunks(fileId: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([CHUNK_STORE], 'readwrite');
      const store = transaction.objectStore(CHUNK_STORE);
      const index = store.index('fileId');
      
      const request = index.openCursor(fileId);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllData(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([CHUNK_STORE], 'readwrite');
      const store = transaction.objectStore(CHUNK_STORE);
      
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getDatabaseSize(): Promise<number> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([CHUNK_STORE], 'readonly');
      const store = transaction.objectStore(CHUNK_STORE);
      
      let totalSize = 0;
      const request = store.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const chunk = cursor.value as StoredChunk;
          totalSize += chunk.data.length * 2; // Approximate byte size (UTF-16)
          cursor.continue();
        } else {
          resolve(totalSize);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export const chunkStorage = new ChunkStorage();