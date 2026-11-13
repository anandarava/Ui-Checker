import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "action";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/* All colour pairs are >= 4.5:1 against their background (UI borders >= 3:1). */
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-500 disabled:text-white",
  secondary: "bg-white text-slate-800 border border-slate-500 hover:bg-slate-50 disabled:text-slate-500 disabled:border-slate-300",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-500",
  ghost: "bg-transparent text-blue-700 hover:bg-blue-50 disabled:text-slate-500",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
  /** Same height as the popover triggers in the action row. */
  action: "px-2 py-1.5 text-xs",
};

export function Button({ variant = "secondary", size = "md", className = "", type = "button", children, ...rest }: Props) {
  // A caller that sets its own whitespace-* utility (e.g. to let a label wrap) replaces the default no-wrap.
  const wrap = /(^|\s)whitespace-/.test(className) ? "" : "whitespace-nowrap";
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1 rounded-md font-medium ${wrap} disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
