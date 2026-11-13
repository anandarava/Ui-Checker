import { scoreBand, type ScoreBand } from "./scanRowHelpers";

const BAND: Record<ScoreBand, { word: string; stroke: string }> = {
  good: { word: "Good", stroke: "stroke-green-600" },
  fair: { word: "Fair", stroke: "stroke-orange-600" },
  poor: { word: "Poor", stroke: "stroke-red-600" },
};

/** Donut showing a 0-100 score. The graphic is decorative; the score is also given as visually hidden text. */
export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const band = BAND[scoreBand(value)];
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span className="sr-only">{`Score ${value} of 100, ${band.word.toLowerCase()}`}</span>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 44 44" width={size} height={size} className="-rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-slate-200" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(c * value) / 100} ${c}`}
          className={band.stroke}
        />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[13px] font-bold text-slate-900">{value}</span>
        <span className="mt-px text-[6px] font-bold tracking-wide text-slate-700 uppercase">{band.word}</span>
      </span>
    </span>
  );
}
