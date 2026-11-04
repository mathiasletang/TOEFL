/** Minimal inline SVG charts (no dependencies). */
export function BandChart({ points, target }: { points: Array<{ day: string; overall: number | null; reading: number | null; listening: number | null; writing: number | null; speaking: number | null }>; target: number }) {
  const W = 640;
  const H = 180;
  const P = { l: 28, r: 8, t: 10, b: 22 };
  if (points.length < 2) return <div className="py-6 text-center text-sm text-zinc-400">Trend appears after training on at least two different days.</div>;
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (points.length - 1);
  const y = (b: number) => P.t + ((6 - b) * (H - P.t - P.b)) / 5;
  const series: Array<[keyof (typeof points)[number], string, string]> = [
    ["reading", "#64748b", "R"],
    ["listening", "#0f766e", "L"],
    ["writing", "#a16207", "W"],
    ["speaking", "#9333ea", "S"],
    ["overall", "#18181b", "Overall"],
  ];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected band trend">
        {[1, 2, 3, 4, 5, 6].map((b) => (
          <g key={b}>
            <line x1={P.l} x2={W - P.r} y1={y(b)} y2={y(b)} stroke="#f4f4f5" />
            <text x={4} y={y(b) + 4} fontSize="10" fill="#a1a1aa">
              {b}
            </text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(target)} y2={y(target)} stroke="#2f4ac2" strokeDasharray="4 4" />
        {series.map(([k, color]) => {
          const pts = points.map((p, i) => (p[k] == null ? null : `${x(i)},${y(p[k] as number)}`)).filter(Boolean);
          return pts.length > 1 ? <polyline key={k} points={pts.join(" ")} fill="none" stroke={color} strokeWidth={k === "overall" ? 2.5 : 1.25} /> : null;
        })}
        <text x={P.l} y={H - 6} fontSize="10" fill="#a1a1aa">
          {points[0]!.day}
        </text>
        <text x={W - P.r} y={H - 6} fontSize="10" fill="#a1a1aa" textAnchor="end">
          {points[points.length - 1]!.day}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-zinc-500">
        {series.map(([k, c, l]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: c }} />
            {l}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-0 w-3 border-t border-dashed border-accent" />
          target
        </span>
      </div>
    </div>
  );
}
