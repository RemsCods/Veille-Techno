import { Link } from "react-router-dom";
import type { Article } from "../types";
import ConfidenceBadge from "./ConfidenceBadge";
import RelevanceBadge from "./RelevanceBadge";
import FeedbackButtons from "./FeedbackButtons";

interface Props {
  article: Article;
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function ArticleCard({ article }: Props) {
  return (
    <article className="border border-gray-800 rounded-lg p-4 hover:border-gray-600 hover:bg-gray-900/30 transition-all">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/articles/${article.id}`}
          className="text-base font-medium text-indigo-300 hover:text-indigo-200 leading-snug"
        >
          {article.title}
        </Link>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <RelevanceBadge relevance={article.relevance} reason={article.relevance_reason} />
          <ConfidenceBadge score={article.confidence_score} />
        </span>
      </div>

      {article.summary && (
        <p className="mt-2 text-sm text-gray-400 line-clamp-2">{article.summary}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        {article.author && <span>{article.author}</span>}
        {article.published_at && (
          <>
            <span>·</span>
            <span>{fmtDate(article.published_at)}</span>
          </>
        )}
        {article.tags.map((t) => (
          <span
            key={t.id}
            className="bg-gray-800 text-gray-300 rounded px-1.5 py-0.5"
          >
            {t.name}
          </span>
        ))}

        {/* Cluster badge — shown when multiple sources covered the same story */}
        {article.cluster_size > 1 && (
          <span
            className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-400"
            title={`${article.cluster_size - 1} other source${article.cluster_size > 2 ? "s" : ""} covered this story`}
          >
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="4"  cy="8" r="2.5"/>
              <circle cx="12" cy="8" r="2.5"/>
              <path d="M6.5 8h3"/>
            </svg>
            {article.cluster_size - 1} similar
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          <FeedbackButtons articleId={article.id} verdict={article.feedback?.verdict ?? null} />
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-gray-400"
          >
            source ↗
          </a>
        </span>
      </div>
    </article>
  );
}
