/**
 * Waits until the page can be measured (PLAN.md, Phase 1): web fonts loaded,
 * images in view loaded and the layout no longer changing. Measuring before
 * fonts load gives wrong text sizes.
 *
 * The wait always ends: after `timeoutMs` the scan goes ahead and the report
 * says what was not ready.
 */

export interface ReadyOptions {
  /** Longest total wait. */
  timeoutMs?: number;
  /** How long the layout must stay unchanged. */
  settleMs?: number;
}

export interface ReadyReport {
  fontsLoaded: boolean;
  imagesLoaded: boolean;
  settled: boolean;
  waitedMs: number;
}

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_SETTLE_MS = 120;
const POLL_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves true when `work` finishes within `ms`, false otherwise. */
function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(false);
  return Promise.race([work.then(() => true, () => true), sleep(ms).then(() => false)]);
}

/** Images that are still loading and sit inside the viewport. */
function pendingImages(doc: Document): HTMLImageElement[] {
  const view = doc.defaultView;
  if (!view) return [];
  return Array.from(doc.images).filter((img) => {
    if (img.complete) return false;
    const r = img.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < view.innerHeight && r.left < view.innerWidth;
  });
}

function imageDone(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}

/** Changes when the page grows, shrinks or gains or loses elements. */
function layoutSignature(doc: Document): string {
  const root = doc.documentElement;
  const body = doc.body?.getBoundingClientRect();
  return `${root.scrollWidth}x${root.scrollHeight}|${body?.width ?? 0}x${body?.height ?? 0}|${doc.getElementsByTagName("*").length}`;
}

export async function waitUntilReady(doc: Document = document, options: ReadyOptions = {}): Promise<ReadyReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const started = performance.now();
  const left = (): number => timeoutMs - (performance.now() - started);

  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  const fontsLoaded = fonts && fonts.status !== "loaded" ? await within(fonts.ready, left()) : true;

  const images = pendingImages(doc);
  const imagesLoaded = images.length === 0 ? true : await within(Promise.all(images.map(imageDone)), left());

  let settled = false;
  let signature = layoutSignature(doc);
  let stableSince = performance.now();
  while (left() > 0) {
    if (performance.now() - stableSince >= settleMs) {
      settled = true;
      break;
    }
    await sleep(Math.min(POLL_MS, settleMs));
    const next = layoutSignature(doc);
    if (next !== signature) {
      signature = next;
      stableSince = performance.now();
    }
  }

  return { fontsLoaded, imagesLoaded, settled, waitedMs: Math.round(performance.now() - started) };
}
