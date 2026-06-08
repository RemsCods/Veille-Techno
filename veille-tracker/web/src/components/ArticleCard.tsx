import { Link } from "react-router-dom";
import type { Article } from "../types";
import ConfidenceBadge from "./ConfidenceBadge";

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
    <article className="border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/articles/${article.id}`}
          className="text-base font-medium text-indigo-300 hover:text-indigo-200 leading-snug"
        >
          {article.title}
        </Link>
        <ConfidenceBadge score={article.confidence_score} />
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
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-gray-600 hover:text-gray-400"
        >
          source ↗
        </a>
      </div>
    </article>
  );
}
