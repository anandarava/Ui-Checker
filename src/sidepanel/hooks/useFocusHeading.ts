import { useEffect, useRef, type RefObject } from "react";

/**
 * Returns a ref to attach to a view's heading (`tabIndex={-1}`); the heading
 * receives focus when the view mounts so screen-reader and keyboard users
 * land at the top of the new view.
 */
export function useFocusHeading<T extends HTMLElement = HTMLHeadingElement>(deps: unknown[] = []): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => el.focus({ preventScroll: false }));
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
