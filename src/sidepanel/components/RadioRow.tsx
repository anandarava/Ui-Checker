/**
 * A radio option as a rounded row: bold title, muted hint, drawn round radio. The native input is
 * visually hidden but real, so radio-group keyboard behaviour and screen-reader semantics stay.
 */
export function RadioRow({
  name,
  checked,
  onChange,
  onClick,
  title,
  hint,
  value,
}: {
  name: string;
  checked: boolean;
  onChange(): void;
  /** Fires on every click, including on the already-checked option (which never triggers onChange). */
  onClick?(): void;
  title: string;
  hint: string;
  value?: string;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${checked ? "bg-blue-50" : "hover:bg-slate-50"}`}>
      <input type="radio" className="peer sr-only" name={name} value={value} checked={checked} onChange={onChange} onClick={onClick} />
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-700 ${
          checked ? "border-blue-600 bg-white" : "border-slate-500 bg-white"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-blue-600" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="block text-xs text-slate-600">{hint}</span>
      </span>
    </label>
  );
}
