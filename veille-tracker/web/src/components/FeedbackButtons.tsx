import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setFeedback, removeFeedback } from "../api";

interface Props {
  articleId: number;
  verdict: "pertinent" | "non_pertinent" | null;
}

/**
 * 👍/👎 relevance feedback. Clicking the active verdict again removes it.
 * Every verdict feeds the active-learning training set (Admin → ML card).
 */
export default function FeedbackButtons({ articleId, verdict }: Props) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (next: "pertinent" | "non_pertinent" | null) =>
      next === null ? removeFeedback(articleId) : setFeedback(articleId, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["article", String(articleId)] });
    },
  });

  const btn = (target: "pertinent" | "non_pertinent", icon: string, activeCls: string, label: string) => {
    const active = verdict === target;
    return (
      <button
        title={label}
        disabled={mutation.isPending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mutation.mutate(active ? null : target);
        }}
        className={`px-1.5 py-0.5 rounded text-sm leading-none transition-all disabled:opacity-40 ${
          active ? activeCls : "opacity-35 hover:opacity-100 grayscale hover:grayscale-0"
        }`}
      >
        {icon}
      </button>
    );
  };

  return (
    <span className="inline-flex items-center gap-0.5" title="Votre avis entraîne le classifieur de pertinence">
      {btn("pertinent", "👍", "bg-emerald-950 ring-1 ring-emerald-800", "Pertinent pour la veille")}
      {btn("non_pertinent", "👎", "bg-red-950 ring-1 ring-red-800", "Pas pertinent (masque l'article)")}
    </span>
  );
}
