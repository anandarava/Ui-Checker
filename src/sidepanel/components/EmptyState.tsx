import type { ReactNode } from "react";

/** Centered empty state: a pale-blue circular backdrop holding a decorative illustration, then real text. */
export function EmptyState({ illustration, heading, children }: { illustration: ReactNode; heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      <div aria-hidden="true" className="flex h-36 w-36 items-center justify-center rounded-full bg-blue-100">
        {illustration}
      </div>
      <h3 className="mt-4 text-base font-bold text-slate-900">{heading}</h3>
      <p className="mt-1 text-xs text-slate-700">{children}</p>
    </div>
  );
}

/** Keyboard with a few spark lines above it. Decorative. */
export function KeyboardIllustration() {
  return (
    <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false">
      <g stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round">
        <path d="M48 12v8M33 17l4 6M63 17l-4 6M22 28l6 3M74 28l-6 3" />
      </g>
      <rect x="12" y="38" width="72" height="40" rx="7" fill="#fff" stroke="#2563eb" strokeWidth="3" />
      <g fill="#93c5fd">
        <rect x="20" y="46" width="8" height="7" rx="2" />
        <rect x="32" y="46" width="8" height="7" rx="2" />
        <rect x="44" y="46" width="8" height="7" rx="2" />
        <rect x="56" y="46" width="8" height="7" rx="2" />
        <rect x="68" y="46" width="8" height="7" rx="2" />
        <rect x="20" y="57" width="8" height="7" rx="2" />
        <rect x="32" y="57" width="8" height="7" rx="2" />
        <rect x="44" y="57" width="8" height="7" rx="2" />
        <rect x="56" y="57" width="8" height="7" rx="2" />
        <rect x="68" y="57" width="8" height="7" rx="2" />
      </g>
      <rect x="28" y="67" width="40" height="6" rx="3" fill="#2563eb" />
    </svg>
  );
}

/** Document with a blue bookmark ribbon and small plus / sparkle marks. Decorative. */
export function SavedScansIllustration() {
  return (
    <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false">
      <path d="M26 16h30l14 14v50a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4Z" fill="#fff" stroke="#2563eb" strokeWidth="3" strokeLinejoin="round" />
      <path d="M56 16v14h14" fill="none" stroke="#2563eb" strokeWidth="3" strokeLinejoin="round" />
      <g stroke="#93c5fd" strokeWidth="3" strokeLinecap="round">
        <path d="M31 44h28M31 54h28M31 64h18" />
      </g>
      <path d="M56 56h14v22l-7-5-7 5Z" fill="#2563eb" />
      <g stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round">
        <path d="M80 14v8M76 18h8M14 50v6M11 53h6" />
      </g>
      <path d="M16 24l1.6 3.4L21 29l-3.4 1.6L16 34l-1.6-3.4L11 29l3.4-1.6Z" fill="#60a5fa" />
    </svg>
  );
}

/** Browser window with a mouse pointer clicking it, plus small sparkles. Decorative. */
export function LandingIllustration() {
  return (
    <svg viewBox="0 0 128 128" width="124" height="124" aria-hidden="true" focusable="false">
      <rect x="20" y="28" width="74" height="60" rx="8" fill="#fff" stroke="#2563eb" strokeWidth="3" />
      <path d="M20 44h74" stroke="#2563eb" strokeWidth="3" />
      <g fill="#93c5fd"><circle cx="30" cy="36" r="2.5" /><circle cx="39" cy="36" r="2.5" /><circle cx="48" cy="36" r="2.5" /></g>
      <g stroke="#93c5fd" strokeWidth="3.5" strokeLinecap="round"><path d="M30 55h42M30 65h54M30 75h30" /></g>
      <path d="M76 66l0 36 9-9 6 13 7-3-6-13 13 0Z" fill="#2563eb" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" />
      <g stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"><path d="M104 22v8M100 26h8M16 98v6M13 101h6" /></g>
      <path d="M22 14l1.6 3.4L27 19l-3.4 1.6L22 24l-1.6-3.4L17 19l3.4-1.6Z" fill="#60a5fa" />
      <path d="M108 70l3 3-3 3-3-3Z" fill="#93c5fd" />
      <circle cx="100" cy="108" r="2.5" fill="#60a5fa" />
    </svg>
  );
}
