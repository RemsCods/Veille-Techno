interface ScoreRow {
  label: string;
  weight: string;
  value: number | null;
  sub?: boolean;   // indented sub-component (recency/completeness under freshness)
}

interface Props {
  sourceReliability: number;
  corroboration?: number;
  factCheck?: number;
  freshness?: number;
  recency?: number;
  completeness?: number;
}

export default function ScoreBreakdown({
  sourceReliability, corroboration, factCheck, freshness, recency, completeness,
}: Props) {
  const rows: ScoreRow[] = [
    { label: "Source reliability", weight: "40%", value: sourceReliability },
    { label: "Corroboration",      weight: "30%", value: corroboration ?? null },
    { label: "Fact-check",         weight: "20%", value: factCheck ?? null },
    { label: "Freshness",          weight: "10%", value: freshness ?? null },
    { label: "↳ recency",          weight: "",    value: recency ?? null,      sub: true },
    { label: "↳ completeness",     weight: "",    value: completeness ?? null, sub: true },
  ];

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className={`flex items-center gap-3 ${row.sub ? "text-xs opacity-70" : "text-sm"}`}>
          <span className={`w-44 text-gray-400 ${row.sub ? "pl-4" : ""}`}>{row.label}</span>
          <span className="w-10 text-right text-gray-500">{row.weight}</span>
          <div className="flex-1 bg-gray-800 rounded h-2">
            {row.value !== null && (
              <div
                className={`h-2 rounded transition-all ${row.sub ? "bg-indigo-700" : "bg-indigo-500"}`}
                style={{ width: `${row.value}%` }}
              />
            )}
          </div>
          <span className="w-10 text-right text-gray-300">
            {row.value !== null ? row.value : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}
