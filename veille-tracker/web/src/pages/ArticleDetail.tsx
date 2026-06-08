import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchArticle } from "../api";
import ConfidenceBadge from "../components/ConfidenceBadge";
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

  return (
    <div className="max-w-3xl">
      <Link to="/" className="text-sm text-gray-500 hover:text-gray-300 mb-6 block">
        ← Back to feed
      </Link>

      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="text-xl font-semibold text-gray-100 leading-snug">{article.title}</h1>
        <ConfidenceBadge score={article.confidence_score} />
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-6">
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

      {article.confidence_score !== null && (
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Confidence score — {article.confidence_score}/100
          </h2>
          <ScoreBreakdown
            sourceReliability={article.score_breakdown?.source ?? 0}
            corroboration={article.score_breakdown?.corroboration}
            factCheck={article.score_breakdown?.fact_check}
            freshness={article.score_breakdown?.freshness}
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
