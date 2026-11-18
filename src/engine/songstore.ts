import type { ChartAnalysis } from './chart/pipeline';
import { normalizeSettings, songLevels } from './transcribe';
import type { LevelInfo, SongChart, SongSettings } from './transcribe';

export interface StoredSong {
  id: string;
  title: string;
  createdAt: number;
  bytes: ArrayBuffer;
  settings: SongSettings;
  /** chart at settings.level (what older code and the list read) */
  chart: SongChart;
  /** drum hits + beats; every level is arranged from this on demand */
  analysis?: ChartAnalysis;
  /** kick, snare and toms were read from a separated drum stem */
  stems?: boolean;
}

export interface SongMeta {
  id: string;
  title: string;
  createdAt: number;
  bpm: number;
  durationSec: number;
  noteCount: number;
  /** charted by the drum model (has tracked beats); older charts should be re-charted */
  modern: boolean;
  /** playable levels with their note counts (empty for single-chart songs) */
  levels: (LevelInfo & { notes: number })[];
  /** charted from a separated drum stem */
  stems: boolean;
}

const DB_NAME = 'drumlab-db';
const STORE = 'songs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function putSong(s: StoredSong): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(s);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('put failed'));
    });
  } finally {
    db.close();
  }
}

export async function getSong(id: string): Promise<StoredSong | null> {
  const db = await openDb();
  try {
    return await new Promise<StoredSong | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as StoredSong) ?? null);
      req.onerror = () => reject(req.error ?? new Error('get failed'));
    });
  } finally {
    db.close();
  }
}

export async function listSongs(): Promise<SongMeta[]> {
  const db = await openDb();
  try {
    return await new Promise<SongMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result as StoredSong[]) ?? [];
        resolve(
          all
            .map((s) => ({
              id: s.id,
              title: s.title,
              createdAt: s.createdAt,
              bpm: s.chart.bpm,
              durationSec: s.chart.durationSec,
              noteCount: s.chart.notes.length,
              modern: Array.isArray(s.chart.beats),
              stems: !!s.stems,
              levels: s.analysis
                ? songLevels(s.analysis, normalizeSettings(s.settings), s.title, s.id).map((l) => ({
                    level: l.level,
                    name: l.name,
                    blurb: l.blurb,
                    notes: l.chart.notes.length,
                  }))
                : [],
            }))
            .sort((a, b) => b.createdAt - a.createdAt),
        );
      };
      req.onerror = () => reject(req.error ?? new Error('list failed'));
    });
  } finally {
    db.close();
  }
}

export async function deleteSong(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('delete failed'));
    });
  } finally {
    db.close();
  }
}
