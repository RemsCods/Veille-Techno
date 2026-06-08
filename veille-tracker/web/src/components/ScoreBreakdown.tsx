interface ScoreRow {
  label: string;
  weight: number;
  value: number | null;
}

interface Props {
  sourceReliability: number;
  corroboration?: number;
  factCheck?: number;
  freshness?: number;
}

export default function ScoreBreakdown({ sourceReliability, corroboration, factCheck, freshness }: Props) {
  const rows: ScoreRow[] = [
    { label: "Source reliability", weight: 40, value: sourceReliability },
    { label: "Corroboration", weight: 30, value: corroboration ?? null },
    { label: "Fact-check", weight: 20, value: factCheck ?? null },
    { label: "Freshness & quality", weight: 10, value: freshness ?? null },
  ];

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3 text-sm">
          <span className="w-44 text-gray-400">{row.label}</span>
          <span className="w-10 text-right text-gray-500">{row.weight}%</span>
          <div className="flex-1 bg-gray-800 rounded h-2">
            {row.value !== null && (
              <div
                className="bg-indigo-500 h-2 rounded"
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
