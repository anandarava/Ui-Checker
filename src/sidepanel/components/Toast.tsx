import { useEffect } from "react";
import { useStore, type ToastKind } from "@src/sidepanel/store";
import { CheckIcon } from "./icons";

/* Icon chip colours: >= 3:1 against their tint, text stays slate-900/700 on white. */
const KIND_ICON: Record<ToastKind, { chip: string; border: string }> = {
  info: { chip: "bg-blue-100 text-blue-800", border: "border-slate-300" },
  success: { chip: "bg-green-100 text-green-800", border: "border-slate-300" },
  error: { chip: "bg-red-100 text-red-800", border: "border-red-300" },
};

const KIND_TEXT = { info: "Info", success: "Success", error: "Error" } as const;

function KindIcon({ kind }: { kind: ToastKind }) {
  return (
    <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${KIND_ICON[kind].chip}`}>
      {kind === "success" ? <CheckIcon size={12} /> : kind === "error" ? "!" : "i"}
    </span>
  );
}

/**
 * Single toast rendered inside a persistent aria-live region (the region exists
 * even when empty so assistive tech announces later insertions).
 */
export function Toast() {
  const toast = useStore((s) => s.toast);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast || toast.autoDismiss === false || toast.link) return;
    const t = window.setTimeout(dismiss, 7000);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);

  return (
    <div aria-live="polite" aria-atomic="true" className="pointer-events-none fixed inset-x-2 bottom-2 z-30 flex justify-center">
      {toast && (
        <div
          className={`pointer-events-auto flex max-w-full items-center gap-2.5 rounded-lg border bg-white py-2 pl-2.5 pr-1.5 text-sm text-slate-700 shadow-lg ${KIND_ICON[toast.kind].border}`}
        >
          <KindIcon kind={toast.kind} />
          <span className="sr-only">{KIND_TEXT[toast.kind]}: </span>
          <div className="min-w-0 flex-1 break-words">
            {toast.title && (
              <>
                <strong className="font-semibold text-slate-900">{toast.title}</strong>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">. </span>
              </>
            )}
            {toast.message}
            {toast.link && (
              <>
                {" "}
                <a href={toast.link.href} target="_blank" rel="noreferrer noopener" className="font-semibold text-blue-700 underline">
                  {toast.link.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss notification"
            className="shrink-0 rounded px-1.5 text-lg leading-none text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
