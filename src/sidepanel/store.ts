/**
 * Side panel state (zustand). Field and action names follow the PalTech
 * Accessibility Testing extension's store, so components copied from it work
 * unchanged.
 */
import { create } from "zustand";
import { DEFAULT_SETTINGS, type ScanResult, type Settings } from "@shared/types";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  link?: { href: string; label: string };
  /** When false the toast stays until dismissed. Defaults to true. */
  autoDismiss?: boolean;
}

export interface Progress {
  percent: number;
  stage: string;
}

interface State {
  tabId: number | null;
  settings: Settings;
  scanning: boolean;
  progress: Progress | null;
  result: ScanResult | null;
  toast: Toast | null;

  setTabId(tabId: number | null): void;
  setSettings(settings: Settings): void;
  setScanning(scanning: boolean): void;
  setProgress(progress: Progress | null): void;
  setResult(result: ScanResult | null): void;
  showToast(toast: Omit<Toast, "id">): void;
  dismissToast(): void;
}

let toastCounter = 0;

export const useStore = create<State>((set, get) => ({
  tabId: null,
  settings: { ...DEFAULT_SETTINGS },
  scanning: false,
  progress: null,
  result: null,
  toast: null,

  // Another tab has its own result: drop the one on screen until it is restored for the new tab.
  setTabId: (tabId) => {
    if (get().tabId === tabId) return;
    set({ tabId, result: null, scanning: false, progress: null });
  },
  setSettings: (settings) => set({ settings }),
  setScanning: (scanning) => set({ scanning }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) => set({ result, scanning: false, progress: null }),
  showToast: (toast) => set({ toast: { ...toast, id: ++toastCounter } }),
  dismissToast: () => set({ toast: null }),
}));
