/**
 * Saved scans (chrome.storage.local, newest first, capped at SAVED_SCAN_LIMIT).
 *
 * The index holds only metadata, so listing never loads full results; each
 * result (screenshots included) lives under its own `savedScan:<id>` key.
 *
 * Same functions and names as the saved-scan part of the PalTech Accessibility
 * Testing extension's storage.ts.
 */
import { SAVED_SCAN_LIMIT, STORAGE_SAVED_INDEX, STORAGE_SAVED_PREFIX } from "@shared/constants";
import type { SavedScan, SavedScanMeta, ScanResult } from "@shared/types";

const savedKey = (id: string): string => `${STORAGE_SAVED_PREFIX}${id}`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function localGet<T>(key: string): Promise<T | undefined> {
  return (await chrome.storage.local.get(key))[key] as T | undefined;
}

/** Serialises read-modify-write cycles on one key, so two saves cannot lose each other's entry. */
const keyLocks = new Map<string, Promise<unknown>>();

function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  keyLocks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

function isSavedScanMeta(value: unknown): value is SavedScanMeta {
  return isPlainObject(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.savedAt === "string";
}

export async function listSavedScans(): Promise<SavedScanMeta[]> {
  const stored = await localGet<unknown>(STORAGE_SAVED_INDEX);
  return Array.isArray(stored) ? stored.filter(isSavedScanMeta) : [];
}

export async function getSavedScan(id: string): Promise<SavedScan | undefined> {
  const index = await listSavedScans();
  const meta = index.find((m) => m.id === id);
  if (!meta) return undefined;
  const result = await localGet<unknown>(savedKey(id));
  if (!isPlainObject(result) || !Array.isArray(result.findings)) return undefined;
  return { meta, result: result as unknown as ScanResult };
}

/** Builds the metadata of a saved scan; `id` and `savedAt` are given by the caller. */
export function savedScanMeta(id: string, name: string, result: ScanResult, savedAt: string): SavedScanMeta {
  return {
    id,
    name: name.trim() || result.title || result.url,
    url: result.url,
    title: result.title,
    scannedAt: result.scannedAt,
    savedAt,
    score: result.score,
    summary: result.summary,
    tolerancePreset: result.options.tolerancePreset,
    scope: result.options.scope,
    issueCount: result.findings.filter((f) => f.type === "Definite" && f.status === "new").length,
  };
}

/** Store a named copy of a result. Returns the metadata; the oldest saves beyond the limit are dropped. */
export async function saveScan(name: string, result: ScanResult): Promise<SavedScanMeta> {
  const id = `saved_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const meta = savedScanMeta(id, name, result, new Date().toISOString());
  await chrome.storage.local.set({ [savedKey(id)]: result });
  let dropped: SavedScanMeta[] = [];
  try {
    await withKeyLock(STORAGE_SAVED_INDEX, async () => {
      const index = [meta, ...(await listSavedScans())];
      dropped = index.splice(SAVED_SCAN_LIMIT);
      await chrome.storage.local.set({ [STORAGE_SAVED_INDEX]: index });
    });
  } catch (e) {
    await chrome.storage.local.remove(savedKey(id)).catch(() => undefined);
    throw e;
  }
  if (dropped.length) await chrome.storage.local.remove(dropped.map((m) => savedKey(m.id)));
  return meta;
}

export function renameSavedScan(id: string, name: string): Promise<SavedScanMeta> {
  return withKeyLock(STORAGE_SAVED_INDEX, async () => {
    const index = await listSavedScans();
    const meta = index.find((m) => m.id === id);
    if (!meta) throw new Error("That saved scan no longer exists.");
    meta.name = name.trim() || meta.name;
    await chrome.storage.local.set({ [STORAGE_SAVED_INDEX]: index });
    return meta;
  });
}

export async function deleteSavedScan(id: string): Promise<void> {
  await withKeyLock(STORAGE_SAVED_INDEX, async () => {
    const index = await listSavedScans();
    await chrome.storage.local.set({ [STORAGE_SAVED_INDEX]: index.filter((m) => m.id !== id) });
  });
  await chrome.storage.local.remove(savedKey(id));
}
