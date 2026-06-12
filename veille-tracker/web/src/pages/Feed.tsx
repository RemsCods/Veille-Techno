import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchArticles, fetchSources, fetchStats, collectAll } from "../api";
import ArticleCard from "../components/ArticleCard";

const BASE = "/api";

interface TagCount { name: string; count: number }

function fetchPopularTags(): Promise<TagCount[]> {
  return fetch(`${BASE}/articles/tags/popular?limit=25`).then((r) => r.json());
}

export default function Feed() {
  const [minScore, setMinScore]       = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sort, setSort]               = useState("collected_at:desc");
  const [page, setPage]               = useState(0);
  const [collectMsg, setCollectMsg]   = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch]           = useState("");
  const [activeTags, setActiveTags]   = useState<string[]>([]);
  const [showDupes, setShowDupes]     = useState(false);
  const [showOffTopic, setShowOffTopic] = useState(false);
  const [reviewMode, setReviewMode]   = useState(false); // "À trier" — uncertainty queue
  const limit = 20;

  const queryClient = useQueryClient();

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [sortBy, sortDir] = sort.split(":") as [string, string];

  const params = new URLSearchParams();
  if (search)       params.set("search",     search);
  if (minScore)     params.set("min_score",  minScore);
  if (sourceFilter) params.set("source",     sourceFilter);
  // Review mode: uncertainty queue — unlabeled articles the classifier is
  // least sure about, so each 👍/👎 teaches the model the most.
  params.set("sort_by",  reviewMode ? "uncertainty" : sortBy);
  params.set("sort_dir", reviewMode ? "asc" : sortDir);
  params.set("limit",    String(limit));
  params.set("offset",   String(page * limit));

  const { data: articles = [], isLoading, isError } = useQuery({
    queryKey: ["articles", params.toString(), activeTags, showDupes, showOffTopic],
    queryFn: () => fetchArticles(params, activeTags, !showDupes, showOffTopic),
    refetchInterval: 15_000,
  });

  const { data: sources = [] } = useQuery({
    queryKey: ["sources"],
    queryFn: fetchSources,
  });

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 15_000,
  });

  const { data: popularTags = [] } = useQuery({
    queryKey: ["popularTags"],
    queryFn: fetchPopularTags,
    staleTime: 60_000,
  });

  const collectMutation = useMutation({
    mutationFn: collectAll,
    onSuccess: (data) => {
      setCollectMsg(`Collection started for ${data.sources_count} sources.`);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["articles"] });
        queryClient.invalidateQueries({ queryKey: ["stats"] });
      }, 5000);
      setTimeout(() => setCollectMsg(null), 12000);
    },
  });

  function clearFilters() {
    setSearchInput(""); setSearch("");
    setMinScore(""); setSourceFilter("");
    setSort("collected_at:desc");
    setActiveTags([]);
    setShowDupes(false);
    setShowOffTopic(false);
    setReviewMode(false);
    setPage(0);
  }

  const hasActiveFilters =
    search || minScore || sourceFilter ||
    sort !== "collected_at:desc" || activeTags.length > 0 || showDupes ||
    showOffTopic || reviewMode;

  function toggleTag(name: string) {
    setPage(0);
    setActiveTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  }

  return (
    <div>
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Total articles", value: stats.total_articles },
            { label: "Reliable",       value: `${stats.pct_reliable}%` },
            { label: "Avg score",      value: stats.avg_score ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-indigo-300">{value}</div>
              <div className="text-xs text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search bar */}
      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">
          🔍
        </span>
        <input
          type="text"
          placeholder="Search articles — title, summary, tags…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-10 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-600"
        />
        {searchInput && (
          <button
            onClick={() => { setSearchInput(""); setSearch(""); setPage(0); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-lg leading-none"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Tag chips */}
      {popularTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {popularTags.map((t) => {
            const active = activeTags.includes(t.name);
            return (
              <button
                key={t.name}
                onClick={() => toggleTag(t.name)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                }`}
              >
                {t.name}
                <span className="ml-1 opacity-60">{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* View mode: normal feed vs review queue (active learning) */}
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-gray-800 overflow-hidden">
          <button
            onClick={() => { setReviewMode(false); setPage(0); }}
            className={`px-3 py-1.5 text-sm transition-colors ${
              !reviewMode ? "bg-indigo-700 text-white" : "bg-gray-900 text-gray-400 hover:text-gray-200"
            }`}
          >
            Feed
          </button>
          <button
            onClick={() => { setReviewMode(true); setPage(0); }}
            className={`px-3 py-1.5 text-sm transition-colors ${
              reviewMode ? "bg-indigo-700 text-white" : "bg-gray-900 text-gray-400 hover:text-gray-200"
            }`}
            title="Articles que le classifieur n'arrive pas à trancher — votre 👍/👎 lui apprend le plus ici"
          >
            🎯 À trier
          </button>
        </div>
        {reviewMode && (
          <p className="text-xs text-gray-500">
            Articles où la pertinence est la plus incertaine — votez 👍/👎 pour entraîner le classifieur.
          </p>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }}
          className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-600"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={String(s.id)}>{s.name}</option>
          ))}
        </select>

        <input
          type="number"
          placeholder="Min score (0-100)"
          value={minScore}
          onChange={(e) => { setMinScore(e.target.value); setPage(0); }}
          className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 w-40 focus:outline-none focus:border-indigo-600"
        />

        <select
          value={sort}
          disabled={reviewMode}
          onChange={(e) => { setSort(e.target.value); setPage(0); }}
          className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 disabled:opacity-40 focus:outline-none focus:border-indigo-600"
        >
          <option value="collected_at:desc">Newest collected</option>
          <option value="confidence_score:desc">Best score ↓</option>
          <option value="confidence_score:asc">Lowest score ↑</option>
          <option value="relevance_score:desc">Most relevant</option>
          <option value="source_reliability:desc">Top sources</option>
          <option value="corroborations:desc">Most corroborated</option>
        </select>

        {/* Dedup toggle */}
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDupes}
            onChange={(e) => { setShowDupes(e.target.checked); setPage(0); }}
            className="w-3.5 h-3.5 accent-indigo-500"
          />
          Show duplicates
        </label>

        {/* Off-topic toggle — hidden by default, kept in DB */}
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none" title="Les articles classés hors sujet sont masqués mais jamais supprimés">
          <input
            type="checkbox"
            checked={showOffTopic}
            onChange={(e) => { setShowOffTopic(e.target.checked); setPage(0); }}
            className="w-3.5 h-3.5 accent-red-500"
          />
          Show off-topic
        </label>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-300"
          >
            Clear filters
          </button>
        )}

        <button
          onClick={() => collectMutation.mutate()}
          disabled={collectMutation.isPending}
          className="ml-auto flex items-center gap-2 px-4 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          {collectMutation.isPending ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Collecting…
            </>
          ) : (
            "Collect all sources"
          )}
        </button>
      </div>

      {collectMsg && (
        <div className="mb-4 px-4 py-3 rounded bg-indigo-950 border border-indigo-800 text-sm text-indigo-300">
          {collectMsg}
        </div>
      )}

      {(search || activeTags.length > 0) && !isLoading && (
        <p className="text-sm text-gray-500 mb-3">
          {articles.length === 0 ? (
            <>No results{search ? ` for "${search}"` : ""}{activeTags.length > 0 ? ` with tags: ${activeTags.join(", ")}` : ""}</>
          ) : (
            <>{articles.length}{articles.length === limit ? "+" : ""} result{articles.length !== 1 ? "s" : ""}
              {search ? ` for "${search}"` : ""}
              {activeTags.length > 0 ? ` · tags: ${activeTags.join(", ")}` : ""}
            </>
          )}
        </p>
      )}

      {isLoading && <p className="text-gray-500">Loading…</p>}
      {isError   && <p className="text-red-400">Failed to load articles.</p>}

      <div className="space-y-3">
        {articles.map((a) => <ArticleCard key={a.id} article={a} />)}
        {!isLoading && articles.length === 0 && (
          <p className="text-gray-500 text-sm">No articles yet — click "Collect all sources" to start.</p>
        )}
      </div>

      <div className="flex gap-3 mt-8">
        <button
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
          className="px-4 py-1.5 rounded bg-gray-800 text-sm disabled:opacity-40 hover:bg-gray-700"
        >
          Previous
        </button>
        <span className="text-gray-500 text-sm self-center">Page {page + 1}</span>
        <button
          disabled={articles.length < limit}
          onClick={() => setPage((p) => p + 1)}
          className="px-4 py-1.5 rounded bg-gray-800 text-sm disabled:opacity-40 hover:bg-gray-700"
        >
          Next
        </button>
      </div>
    </div>
  );
}
