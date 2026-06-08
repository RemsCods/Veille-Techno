import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchArticles, fetchSources, fetchStats, collectAll } from "../api";
import ArticleCard from "../components/ArticleCard";

export default function Feed() {
  const [minScore, setMinScore] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sort, setSort] = useState("collected_at:desc");
  const [page, setPage] = useState(0);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState(""); // debounced value
  const limit = 20;

  const queryClient = useQueryClient();

  // Debounce search — wait 350ms after last keystroke before querying
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [sortBy, sortDir] = sort.split(":") as [string, string];

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (minScore) params.set("min_score", minScore);
  if (sourceFilter) params.set("source", sourceFilter);
  params.set("sort_by", sortBy);
  params.set("sort_dir", sortDir);
  params.set("limit", String(limit));
  params.set("offset", String(page * limit));

  const { data: articles = [], isLoading, isError } = useQuery({
    queryKey: ["articles", params.toString()],
    queryFn: () => fetchArticles(params),
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

  const collectMutation = useMutation({
    mutationFn: collectAll,
    onSuccess: (data) => {
      setCollectMsg(`Collection started for ${data.sources_count} sources. Articles will appear in a few minutes.`);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["articles"] });
        queryClient.invalidateQueries({ queryKey: ["stats"] });
      }, 5000);
      setTimeout(() => setCollectMsg(null), 12000);
    },
  });

  return (
    <div>
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Total articles", value: stats.total_articles },
            { label: "Reliable", value: `${stats.pct_reliable}%` },
            { label: "Avg score", value: stats.avg_score ?? "—" },
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

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }}
          className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
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
          className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 w-40"
        />

        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(0); }}
          className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="collected_at:desc">Newest collected</option>
          <option value="confidence_score:desc">Best score ↓</option>
          <option value="confidence_score:asc">Lowest score ↑</option>
          <option value="source_reliability:desc">Top sources</option>
          <option value="corroborations:desc">Most corroborated</option>
        </select>

        {(search || minScore || sourceFilter || sort !== "collected_at:desc") && (
          <button
            onClick={() => {
              setSearchInput(""); setSearch("");
              setMinScore(""); setSourceFilter("");
              setSort("collected_at:desc"); setPage(0);
            }}
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

      {search && !isLoading && (
        <p className="text-sm text-gray-500 mb-3">
          {articles.length === 0
            ? `No results for "${search}"`
            : `${articles.length}${articles.length === limit ? "+" : ""} result${articles.length !== 1 ? "s" : ""} for "${search}"`}
        </p>
      )}

      {isLoading && <p className="text-gray-500">Loading…</p>}
      {isError && <p className="text-red-400">Failed to load articles.</p>}

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
