/** Minimal inline SVG charts (no dependencies). */
export function BandChart({ points, target }: { points: Array<{ day: string; overall: number | null; reading: number | null; listening: number | null; writing: number | null; speaking: number | null }>; target: number }) {
  const W = 640;
  const H = 180;
  const P = { l: 28, r: 8, t: 10, b: 22 };
  if (points.length < 2) return <div className="py-6 text-center text-sm text-dim">Trend appears after training on at least two different days.</div>;
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (points.length - 1);
  const y = (b: number) => P.t + ((6 - b) * (H - P.t - P.b)) / 5;
  // Black and white: series differ by shade (token classes) and by dash pattern, never by hue alone.
  const series: Array<[keyof (typeof points)[number], string, string | undefined, string]> = [
    ["reading", "stroke-muted", undefined, "Reading"],
    ["listening", "stroke-muted", "6 4", "Listening"],
    ["writing", "stroke-dim", "1.5 4", "Writing"],
    ["speaking", "stroke-dim", "10 4 2 4", "Speaking"],
    ["overall", "stroke-text", undefined, "Overall"],
  ];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected band trend">
        {[1, 2, 3, 4, 5, 6].map((b) => (
          <g key={b}>
            <line x1={P.l} x2={W - P.r} y1={y(b)} y2={y(b)} className="stroke-line" />
            <text x={4} y={y(b) + 4} fontSize="11" className="fill-dim">
              {b}
            </text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(target)} y2={y(target)} className="stroke-ring" strokeWidth={2} strokeDasharray="2 3" />
        {series.map(([k, cls, dash]) => {
          const pts = points.map((p, i) => (p[k] == null ? null : `${x(i)},${y(p[k] as number)}`)).filter(Boolean);
          return pts.length > 1 ? <polyline key={k} points={pts.join(" ")} fill="none" className={cls} strokeDasharray={dash} strokeLinecap="round" strokeWidth={k === "overall" ? 3 : 1.75} /> : null;
        })}
        <text x={P.l} y={H - 6} fontSize="11" className="fill-dim">
          {points[0]!.day}
        </text>
        <text x={W - P.r} y={H - 6} fontSize="11" className="fill-dim" textAnchor="end">
          {points[points.length - 1]!.day}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold text-dim">
        {series.map(([k, cls, dash, l]) => (
          <span key={k} className="flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden>
              <line x1="1" x2="21" y1="3" y2="3" className={cls} strokeDasharray={dash} strokeLinecap="round" strokeWidth={k === "overall" ? 3 : 1.75} />
            </svg>
            {l}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line x1="1" x2="21" y1="3" y2="3" className="stroke-ring" strokeWidth={2} strokeDasharray="2 3" />
          </svg>
          target
        </span>
      </div>
    </div>
  );
}
