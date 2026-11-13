import { useStore } from "@src/sidepanel/store";
import { Button } from "./Button";

const REASON_TEXT = {
  route: "The page navigated to a new route.",
  dialog: "A dialog opened on the page.",
  dom: "The page content changed significantly.",
} as const;

export function PageChangedBanner({ onRescan }: { onRescan(): void }) {
  const reason = useStore((s) => s.pageChanged);
  const scanning = useStore((s) => s.scanning);
  const dismiss = useStore((s) => s.setPageChanged);
  if (!reason) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-amber-700 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div className="flex-1">
        <strong>Page changed</strong> – rescan? <span className="text-xs">{REASON_TEXT[reason]}</span>
      </div>
      <Button size="sm" variant="primary" onClick={onRescan} disabled={scanning}>
        Rescan
      </Button>
      <button
        type="button"
        onClick={() => dismiss(null)}
        aria-label="Dismiss page changed notice"
        className="rounded px-1 text-base leading-none hover:bg-black/10"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
