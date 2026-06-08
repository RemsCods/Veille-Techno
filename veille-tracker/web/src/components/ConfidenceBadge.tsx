interface Props {
  score: number | null;
  threshold?: number;
}

export default function ConfidenceBadge({ score, threshold = 70 }: Props) {
  if (score === null) {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-gray-700 text-gray-300">
        pending
      </span>
    );
  }
  const reliable = score >= threshold;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
        reliable
          ? "bg-green-900 text-green-300"
          : "bg-yellow-900 text-yellow-300"
      }`}
      title={`Confidence: ${score}/100`}
    >
      {reliable ? "reliable" : "verify"} {score}
    </span>
  );
}
