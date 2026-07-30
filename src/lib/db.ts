// IndexedDB persistence for the captured dataset — an impure edge, deliberately
// untested. Survives reloads; JSON export/import (serialize.ts) is the backup path.

import type { Sample } from "./dataset.ts";

const DB_NAME = "chord-cam";
const STORE = "samples";
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addSamples(samples: Sample[]): Promise<void> {
  if (samples.length === 0) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const s of samples) store.add(s);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getAllSamples(): Promise<Sample[]> {
  const db = await openDB();
  const rows = await new Promise<Sample[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Sample[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}

// Delete every sample belonging to one take. Returns how many were removed.
export async function deleteTake(takeId: string): Promise<number> {
  const db = await openDB();
  const removed = await new Promise<number>((resolve, reject) => {
    let count = 0;
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if ((cursor.value as Sample).takeId === takeId) {
        cursor.delete();
        count++;
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return removed;
}

export async function clearAll(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
