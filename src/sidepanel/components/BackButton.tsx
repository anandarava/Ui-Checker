import type { ReactNode } from "react";
import { ChevronLeftIcon } from "./icons";

interface Props {
  onClick(): void;
  /** Accessible name when "Back" alone is not enough, e.g. "Back to results". */
  ariaLabel?: string;
  children?: ReactNode;
  className?: string;
}

/** The "‹ Back" button used at the top of every secondary view. */
export function BackButton({ onClick, ariaLabel, children = "Back", className = "" }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-2 rounded-lg border border-slate-500 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:border-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${className}`}
    >
      <ChevronLeftIcon size={14} />
      {children}
    </button>
  );
}
