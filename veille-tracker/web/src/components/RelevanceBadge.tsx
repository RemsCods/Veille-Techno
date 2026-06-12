import type { RelevanceBucket } from "../types";

interface Props {
  relevance: RelevanceBucket | null;
  reason?: string | null;
  showOnTopic?: boolean; // feed cards skip the on_topic badge to reduce noise
}

const STYLES: Record<RelevanceBucket, { label: string; cls: string }> = {
  on_topic:   { label: "on topic",   cls: "bg-emerald-950 text-emerald-400 border border-emerald-900" },
  borderline: { label: "borderline", cls: "bg-amber-950 text-amber-400 border border-amber-900" },
  off_topic:  { label: "hors sujet", cls: "bg-red-950 text-red-400 border border-red-900" },
};

export default function RelevanceBadge({ relevance, reason, showOnTopic = false }: Props) {
  if (!relevance) return null;
  if (relevance === "on_topic" && !showOnTopic) return null;
  const s = STYLES[relevance];
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}
      title={reason ?? undefined}
    >
      {s.label}
    </span>
  );
}
