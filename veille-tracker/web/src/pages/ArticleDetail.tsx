import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchArticle } from "../api";
import ConfidenceBadge from "../components/ConfidenceBadge";
import RelevanceBadge from "../components/RelevanceBadge";
import FeedbackButtons from "../components/FeedbackButtons";
import ScoreBreakdown from "../components/ScoreBreakdown";

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-GB");
}

export default function ArticleDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: article, isLoading, isError } = useQuery({
    queryKey: ["article", id],
    queryFn: () => fetchArticle(id!),
    enabled: !!id,
  });

  if (isLoading) return <p className="text-gray-500">Loading…</p>;
  if (isError || !article) return <p className="text-red-400">Article not found.</p>;

  // Re-reviewed by the idle pipeline → we can show the old score vs the new one.
  const reviewed =
    article.status === "score" &&
    article.previous_confidence_score !== null &&
    article.confidence_score !== null;
  const scoreDelta = reviewed
    ? Math.round((article.confidence_score! - article.previous_confidence_score!) * 10) / 10
    : 0;

  return (
    <div className="max-w-3xl">
      <Link to="/" className="text-sm text-gray-500 hover:text-gray-300 mb-6 block">
        ← Back to feed
      </Link>

      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="text-xl font-semibold text-gray-100 leading-snug">{article.title}</h1>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {article.reviewed_at && (
            <span
              className="text-[11px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 rounded px-1.5 py-0.5"
              title={`Repassé dans la pipeline le ${fmtDate(article.reviewed_at)}`}
            >
              🔁 Revu
            </span>
          )}
          <RelevanceBadge relevance={article.relevance} reason={article.relevance_reason} showOnTopic />
          <ConfidenceBadge score={article.confidence_score} />
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-6">
        <span
          className="font-mono bg-gray-800 text-gray-300 rounded px-1.5 py-0.5"
          title="Identifiant de l'article (utile pour le signaler / l'outil admin)"
        >
          #{article.id}
        </span>
        {article.author && <span>{article.author}</span>}
        {article.published_at && <><span>·</span><span>{fmtDate(article.published_at)}</span></>}
        {article.tags.map((t) => (
          <span key={t.id} className="bg-gray-800 text-gray-300 rounded px-1.5 py-0.5">{t.name}</span>
        ))}
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="ml-auto hover:text-gray-300">
          Original source ↗
        </a>
      </div>

      {article.summary && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Summary</h2>
          <p className="text-gray-300 leading-relaxed">{article.summary}</p>
        </section>
      )}

      {/* Relevance — orthogonal axis to confidence: in the watch scope or not */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Pertinence pour la veille
          </h2>
          <FeedbackButtons articleId={article.id} verdict={article.feedback?.verdict ?? null} />
        </div>
        {article.relevance ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-3">
              <RelevanceBadge relevance={article.relevance} showOnTopic />
              {article.relevance_score !== null && (
                <span className="text-gray-500 text-xs">
                  marge ancres : {article.relevance_score}/100 (50 = neutre)
                </span>
              )}
              {article.ml_relevance !== null && (
                <span className="text-gray-500 text-xs" title="Probabilité prédite par le classifieur entraîné sur vos 👍/👎">
                  · classifieur ML : {article.ml_relevance}%
                </span>
              )}
            </div>
            {article.relevance_reason && (
              <p className="text-gray-400 text-xs leading-relaxed">{article.relevance_reason}</p>
            )}
          </div>
        ) : (
          <p className="text-gray-600 text-sm">Pas encore évaluée (article en attente du gate).</p>
        )}
      </section>

      {article.confidence_score !== null && (
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Confidence score — {article.confidence_score}/100
          </h2>
          {reviewed && (
            <div className="-mt-2 mb-4 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-gray-500">Re-vérifié par la pipeline :</span>
              <span className="text-gray-400 line-through">{article.previous_confidence_score}</span>
              <span className="text-gray-500">→</span>
              <span className="text-gray-100 font-medium">{article.confidence_score}</span>
              <span
                className={
                  scoreDelta > 0 ? "text-emerald-400" : scoreDelta < 0 ? "text-red-400" : "text-gray-500"
                }
              >
                ({scoreDelta > 0 ? "+" : ""}{scoreDelta})
              </span>
              {article.reviewed_at && (
                <span className="text-gray-600">· le {fmtDate(article.reviewed_at)}</span>
              )}
            </div>
          )}
          <ScoreBreakdown
            sourceReliability={article.score_breakdown?.source ?? 0}
            corroboration={article.score_breakdown?.corroboration}
            factCheck={article.score_breakdown?.fact_check}
            freshness={article.score_breakdown?.freshness}
            recency={article.score_breakdown?.recency}
            completeness={article.score_breakdown?.completeness}
          />
        </section>
      )}

      {article.corroborations.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Corroborating articles ({article.corroborations.length})
          </h2>
          <ul className="space-y-1 text-sm">
            {article.corroborations.map((c) => (
              <li key={c.similar_article_id} className="flex items-center gap-2 text-gray-400">
                <Link
                  to={`/articles/${c.similar_article_id}`}
                  className="text-indigo-400 hover:text-indigo-300"
                >
                  Article #{c.similar_article_id}
                </Link>
                <span className="text-gray-600 text-xs">
                  similarity {(c.similarity_score * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {article.fact_checks.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Fact-check results
          </h2>
          <ul className="space-y-2">
            {article.fact_checks.map((fc) => (
              <li key={fc.id} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-0.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                    fc.supporting_sources === "supported"
                      ? "bg-green-500"
                      : fc.supporting_sources === "unsupported"
                      ? "bg-red-500"
                      : "bg-gray-500"
                  }`}
                />
                <span className="text-gray-300">{fc.claim}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
