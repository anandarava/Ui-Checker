import type { ReactNode } from "react";

/**
 * Small inline SVG icons for the side panel. All are decorative (aria-hidden):
 * the control or heading that contains them always carries the text label.
 * They inherit the surrounding text colour through currentColor.
 */
interface IconProps {
  /** Pixel size (width and height). */
  size?: number;
  className?: string;
}

function Svg({ size = 14, className = "", children, filled = false }: IconProps & { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

export function PlayIcon(p: IconProps) {
  return (
    <Svg {...p} filled>
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .92.5l8.1-5.2a.6.6 0 0 0 0-1L5.42 2.3a.6.6 0 0 0-.92.5Z" />
    </Svg>
  );
}

export function RefreshIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
      <path d="M13.2 1.8v3h-3" />
    </Svg>
  );
}

export function KeyboardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M4.5 9.5h7" />
    </Svg>
  );
}

/** A speaker with sound waves: the Screen reader view. */
export function ScreenReaderIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5Z" />
      <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" />
    </Svg>
  );
}

/** A gear: settings. */
export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </Svg>
  );
}

/** The half-filled contrast circle: the Contrast checker. */
export function DropperIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
    </Svg>
  );
}

export function BookmarkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 2.5h8a.5.5 0 0 1 .5.5v10.5L8 10.8 3.5 13.5V3a.5.5 0 0 1 .5-.5Z" />
    </Svg>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </Svg>
  );
}

export function CrosshairIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
    </Svg>
  );
}

export function ScopeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.5" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </Svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3.5 6 4.5 4.5L12.5 6" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3 8.4 3.2 3.2L13 4.6" />
    </Svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.4 1.6" />
    </Svg>
  );
}

export function DownloadIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2v8M4.8 7 8 10.2 11.2 7M2.5 13h11" />
    </Svg>
  );
}

/** Blue circle with a white "i". */
export function InfoCircleIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="7.5" fill="#2563eb" />
      <path d="M8 7.2v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="4.8" r="1" fill="#fff" />
    </svg>
  );
}

/** Red circle with a white "!" (Critical severity). */
export function AlertCircleIcon({ size = 18, className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="7.5" fill="#dc2626" />
      <path d="M8 4.2v4.4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="1" fill="#fff" />
    </svg>
  );
}

export function LightbulbIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 11.5h5M6.3 14h3.4" />
      <path d="M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.5.4.9 1 .9 1.6v.5h3V11c0-.6.4-1.2.9-1.6A4.2 4.2 0 0 0 8 1.8Z" />
    </Svg>
  );
}

export function ArrowLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13 8H3M7 3.8 2.8 8 7 12.2" />
    </Svg>
  );
}

/** Play triangle drawn as an outline (for use on solid buttons). */
export function PlayOutlineIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .92.5l8.1-5.2a.6.6 0 0 0 0-1L5.42 2.3a.6.6 0 0 0-.92.5Z" />
    </Svg>
  );
}

/** Two opposing arrows: compare. */
export function CompareIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 5h10.5M10.2 2.2 13 5l-2.8 2.8M13.5 11H3M5.8 8.2 3 11l2.8 2.8" />
    </Svg>
  );
}

export function ResetIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
      <path d="M2.8 1.8v3h3" />
    </Svg>
  );
}

export function MonitorIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" />
      <path d="M5.5 14h5M8 11v3" />
    </Svg>
  );
}

/** Globe: a whole site. */
export function GlobeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8h12.5M8 1.75c1.8 1.7 2.6 3.8 2.6 6.25S9.8 12.55 8 14.25M8 1.75C6.2 3.45 5.4 5.55 5.4 8s.8 4.55 2.6 6.25" />
    </Svg>
  );
}

/** Filter funnel. */
export function FilterIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 3h12l-4.6 5.4V13l-2.8-1.4V8.4L2 3Z" />
    </Svg>
  );
}

/** Monitor with a highlighted region: "Part of page". */
export function PartOfPageIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <rect x="6" y="6.5" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.2" />
    </svg>
  );
}

export function ChevronLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </Svg>
  );
}

export function MoreVerticalIcon(p: IconProps) {
  return (
    <Svg {...p} filled>
      <circle cx="8" cy="3.5" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.5" r="1.3" />
    </Svg>
  );
}

export function PencilIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 13.5 3 10l7.3-7.3a1.2 1.2 0 0 1 1.7 0l1.3 1.3a1.2 1.2 0 0 1 0 1.7L6 13l-3.5.5ZM9.3 3.7l3 3" />
    </Svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.6 8.2a1 1 0 0 0 1 .8h4.8a1 1 0 0 0 1-.8l.6-8.2M6.7 7v4M9.3 7v4" />
    </Svg>
  );
}
