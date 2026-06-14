import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collectAll, fetchAdminStats, fetchDbStats,
  createSource, updateSource, deleteSource, collectSource,
  fetchAnchors, createAnchor, patchAnchor, deleteAnchor,
  fetchMlModel, retrainModel,
  reprocessArticle, deleteArticle,
} from "../api";
import type { SourceAdmin, SourceCreatePayload, ErroredArticle } from "../types";

// ── Reusable primitives ───────────────────────────────────────────────────────

function ProgressBar({ pct, color = "bg-indigo-500" }: { pct: number; color?: string }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-2.5">
      <div
        className={`${color} h-2.5 rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
      <div className={`text-2xl font-bold ${accent ?? "text-indigo-300"}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Inline SVG sparkline — no external dependency */
function Sparkline({
  data,
  color,
  width = 80,
  height = 22,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 0.1);
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * w;
      const y = pad + (1 - v / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="inline-block opacity-70 flex-shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function fmtEta(minutes: number): string {
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

// ── Source modal ──────────────────────────────────────────────────────────────

function detectType(url: string): "rss" | "api" {
  if (url.includes("arxiv") || url.includes("reddit") || url.includes("hn.algolia")) {
    return "api";
  }
  return "rss";
}

function SourceModal({
  source,
  onClose,
  onSave,
  isSaving,
}: {
  source: SourceAdmin | null;
  onClose: () => void;
  onSave: (data: SourceCreatePayload) => void;
  isSaving: boolean;
}) {
  const isNew = source === null;
  const [name, setName]           = useState(source?.name      ?? "");
  const [feedUrl, setFeedUrl]     = useState(source?.feed_url  ?? "");
  const [type, setType]           = useState<"rss" | "api">((source?.type as "rss" | "api") ?? "rss");
  const [reliability, setRel]     = useState(source?.reliability ?? 50);
  const [active, setActive]       = useState(source?.active ?? true);

  useEffect(() => {
    if (isNew && feedUrl) setType(detectType(feedUrl));
  }, [feedUrl, isNew]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, feed_url: feedUrl, type, reliability, active });
  };

  const relColor = reliability >= 85 ? "text-green-400" : reliability >= 65 ? "text-yellow-400" : "text-orange-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-950 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between p-5 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
          <h2 className="text-base font-semibold text-gray-100">
            {isNew ? "Add source" : `Edit — ${source.name}`}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="OpenAI Blog"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Feed URL */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Feed URL</label>
            <input
              required
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://openai.com/blog/rss.xml"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
            />
            {/* URL guide */}
            <div className="mt-2 rounded-lg bg-gray-900/60 border border-gray-800 p-3 text-xs space-y-1.5">
              <p className="text-gray-400 font-medium">Formats d'URL supportés :</p>
              <div className="space-y-1 text-gray-500">
                <p>
                  <span className="text-gray-300">Blog / news (RSS/Atom)</span>
                  {" — "}<code className="text-gray-400 bg-gray-800 px-1 rounded">https://example.com/feed.xml</code>
                  {" → type "}<span className="text-indigo-400 font-medium">rss</span>
                </p>
                <p>
                  <span className="text-gray-300">arXiv</span>
                  {" — "}<code className="text-gray-400 bg-gray-800 px-1 rounded">https://export.arxiv.org/rss/cs.AI</code>
                  {" → "}<span className="text-yellow-400 font-medium">api</span>
                </p>
                <p className="pl-3 text-gray-600">catégories : cs.AI · cs.LG · cs.CL · cs.CV · cs.RO · cs.IR · cs.NE · stat.ML</p>
                <p>
                  <span className="text-gray-300">Reddit</span>
                  {" — "}<code className="text-gray-400 bg-gray-800 px-1 rounded">https://www.reddit.com/r/MachineLearning/.rss</code>
                  {" → "}<span className="text-yellow-400 font-medium">api</span>
                </p>
                <p>
                  <span className="text-gray-300">Hacker News</span>
                  {" — "}<code className="text-gray-400 bg-gray-800 px-1 rounded text-[10px]">https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI</code>
                  {" → "}<span className="text-yellow-400 font-medium">api</span>
                </p>
              </div>
            </div>
          </div>

          {/* Type + Reliability */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Type
                {isNew && feedUrl && (
                  <span className="ml-1.5 text-indigo-400/70">(auto-détecté)</span>
                )}
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "rss" | "api")}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="rss">rss — toutes les 6h</option>
                <option value="api">api — toutes les 12h</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Reliability — <span className={`font-medium ${relColor}`}>{reliability}</span>/100
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={reliability}
                onChange={(e) => setRel(Number(e.target.value))}
                className="w-full accent-indigo-500 mt-1"
              />
              <div className="flex justify-between text-[10px] text-gray-700 mt-0.5">
                <span>blog</span>
                <span>presse</span>
                <span>institution</span>
              </div>
            </div>
          </div>

          {/* Active toggle (edit mode only) */}
          {!isNew && (
            <div className="flex items-center gap-3 py-1">
              <span className="text-xs text-gray-400">Collecte</span>
              <button
                type="button"
                onClick={() => setActive(!active)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${active ? "bg-indigo-600" : "bg-gray-700"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${active ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              <span className="text-xs text-gray-500">{active ? "active" : "en pause"}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-sm font-medium text-white transition-colors"
            >
              {isSaving ? "Saving…" : isNew ? "Add source" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ── Topic anchors (watch scope) ───────────────────────────────────────────────

function AnchorsSection() {
  const queryClient = useQueryClient();
  const { data: anchors = [] } = useQuery({ queryKey: ["anchors"], queryFn: fetchAnchors });
  const [phrase, setPhrase] = useState("");
  const [polarity, setPolarity] = useState<"positive" | "negative">("positive");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["anchors"] });

  const addMutation = useMutation({
    mutationFn: () => createAnchor(phrase.trim(), polarity),
    onSuccess: () => { setPhrase(""); invalidate(); },
  });

  const renderGroup = (pol: "positive" | "negative") => {
    const group = anchors.filter((a) => a.polarity === pol);
    return (
      <div>
        <div className={`text-xs font-medium mb-2 ${pol === "positive" ? "text-emerald-400" : "text-red-400"}`}>
          {pol === "positive" ? "✚ Le périmètre de veille (positives)" : "− Le bruit connu (négatives)"}
          <span className="text-gray-600 ml-1.5">{group.length}</span>
        </div>
        <ul className="space-y-1">
          {group.map((a) => (
            <li key={a.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-gray-800/40 ${!a.active ? "opacity-40" : ""}`}>
              <span className="flex-1 text-gray-300">{a.phrase}</span>
              <button
                title={a.active ? "Désactiver" : "Activer"}
                onClick={() => patchAnchor(a.id, { active: !a.active }).then(invalidate)}
                className={a.active ? "text-green-500 hover:text-yellow-400" : "text-gray-600 hover:text-green-400"}
              >
                {a.active ? "●" : "○"}
              </button>
              <button
                title="Supprimer"
                onClick={() => deleteAnchor(a.id).then(invalidate)}
                className="text-gray-600 hover:text-red-400"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">
        Topic anchors — périmètre de veille
      </h2>
      <p className="text-xs text-gray-600 mb-4">
        Pertinence = marge entre la similarité aux ancres positives et négatives.
        Modifier les ancres recalibre le gate pour les prochains articles (cache 5 min).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-4">
        {renderGroup("positive")}
        {renderGroup("negative")}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (phrase.trim()) addMutation.mutate(); }}
        className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-800"
      >
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="Nouvelle ancre — ex : robotics and embodied AI systems"
          className="flex-1 min-w-[260px] bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
        />
        <select
          value={polarity}
          onChange={(e) => setPolarity(e.target.value as "positive" | "negative")}
          className="bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
        >
          <option value="positive">positive (sujet)</option>
          <option value="negative">négative (bruit)</option>
        </select>
        <button
          type="submit"
          disabled={addMutation.isPending || !phrase.trim()}
          className="px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-xs font-medium transition-colors"
        >
          {addMutation.isPending ? "…" : "+ Ajouter"}
        </button>
        {addMutation.isError && (
          <span className="text-xs text-red-400">{String((addMutation.error as Error).message)}</span>
        )}
      </form>
    </div>
  );
}

// ── ML classifier card (active learning) ──────────────────────────────────────

function MlCard({ feedbackCount }: { feedbackCount: number }) {
  const queryClient = useQueryClient();
  const { data: model } = useQuery({
    queryKey: ["ml-model"],
    queryFn: fetchMlModel,
    refetchInterval: 30_000,
  });
  const [result, setResult] = useState<string | null>(null);

  const retrain = useMutation({
    mutationFn: retrainModel,
    onSuccess: (r) => {
      setResult(r.trained
        ? `Entraîné : ${r.n_samples} exemples, ${r.accuracy}% accuracy`
        : r.reason ?? "non entraîné");
      queryClient.invalidateQueries({ queryKey: ["ml-model"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      setTimeout(() => setResult(null), 8000);
    },
  });

  const neg = model ? model.feedback_count - model.feedback_positive : 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-500 uppercase tracking-wide">
          Classifieur ML (active learning)
        </div>
        <button
          onClick={() => retrain.mutate()}
          disabled={retrain.isPending || !model?.trainable}
          title={model?.trainable ? "Ré-entraîner maintenant" : `Il faut ≥ ${model?.min_per_class ?? 10} exemples par classe`}
          className="px-2.5 py-1 rounded bg-indigo-800 hover:bg-indigo-700 disabled:opacity-40 text-xs transition-colors"
        >
          {retrain.isPending ? "…" : "↻ retrain"}
        </button>
      </div>
      <div className="text-sm text-gray-300 space-y-1">
        <p>
          <span className="text-gray-500">Feedbacks :</span>{" "}
          {feedbackCount} <span className="text-gray-600">(👍 {model?.feedback_positive ?? 0} · 👎 {neg})</span>
        </p>
        {model?.trained_at ? (
          <p>
            <span className="text-gray-500">Dernier train :</span>{" "}
            {new Date(model.trained_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            {model.accuracy !== null && <span className="text-emerald-400 ml-2">{model.accuracy}% acc.</span>}
          </p>
        ) : (
          <p className="text-gray-600 text-xs">
            Pas encore de modèle — votez 👍/👎 dans le feed ({model?.min_per_class ?? 10} min par classe), il s'entraîne ensuite tout seul (cron horaire).
          </p>
        )}
        {result && <p className="text-xs text-indigo-300">{result}</p>}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

// Errored-articles panel (re-run / delete per row) + by-ID tools — features B & C.
function ArticleOpsCard({ errored }: { errored: ErroredArticle[] }) {
  const qc = useQueryClient();
  const [idInput, setIdInput] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
    qc.invalidateQueries({ queryKey: ["articles"] });
  };
  const reprocessMut = useMutation({
    mutationFn: reprocessArticle,
    onSuccess: (_d, id) => { setMsg({ ok: true, text: `Article #${id} renvoyé dans la pipeline.` }); invalidate(); },
    onError: (e: Error) => setMsg({ ok: false, text: String(e.message) }),
  });
  const deleteMut = useMutation({
    mutationFn: deleteArticle,
    onSuccess: (_d, id) => { setMsg({ ok: true, text: `Article #${id} supprimé.` }); setConfirmId(null); invalidate(); },
    onError: (e: Error) => setMsg({ ok: false, text: String(e.message) }),
  });

  function runById(action: "reprocess" | "delete") {
    const id = parseInt(idInput, 10);
    if (!Number.isFinite(id) || id <= 0) { setMsg({ ok: false, text: "Entre un numéro d'article valide." }); return; }
    if (action === "reprocess") reprocessMut.mutate(id);
    else deleteMut.mutate(id);
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
        Articles en erreur
        <span className="text-gray-600 font-normal ml-2 normal-case">
          {errored.length === 0 ? "aucun" : `${errored.length} parqué${errored.length > 1 ? "s" : ""}`} ·
          repasse ou supprime par n°
        </span>
      </h2>

      {/* By-ID tools (feature C) */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
          placeholder="n° d'article"
          className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 w-36 focus:outline-none focus:border-indigo-600"
        />
        <button onClick={() => runById("reprocess")} disabled={reprocessMut.isPending}
          className="px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 text-sm disabled:opacity-50">↻ Re-run</button>
        <button onClick={() => runById("delete")} disabled={deleteMut.isPending}
          className="px-3 py-1.5 rounded bg-red-800 hover:bg-red-700 text-sm disabled:opacity-50">🗑 Supprimer</button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
      </div>

      {/* Errored list (feature B) */}
      {errored.length === 0 ? (
        <p className="text-xs text-gray-600">Aucun article parqué en erreur 🎉</p>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {errored.map((a) => (
            <div key={a.id} className="rounded bg-gray-950 border border-gray-800 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <a href={`/articles/${a.id}`} className="font-mono text-indigo-400 hover:text-indigo-300 shrink-0">#{a.id}</a>
                <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 shrink-0">{a.status}</span>
                <span className="text-red-400 shrink-0" title="nombre d'échecs">×{a.error_count}</span>
                <span className="text-gray-300 truncate flex-1">{a.title}</span>
                <button onClick={() => reprocessMut.mutate(a.id)} disabled={reprocessMut.isPending}
                  className="text-indigo-400 hover:text-indigo-300 shrink-0">↻</button>
                {confirmId === a.id ? (
                  <>
                    <button onClick={() => deleteMut.mutate(a.id)} className="text-red-400 hover:text-red-300 shrink-0">confirmer</button>
                    <button onClick={() => setConfirmId(null)} className="text-gray-500 hover:text-gray-300 shrink-0">×</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmId(a.id)} className="text-gray-500 hover:text-red-400 shrink-0">🗑</button>
                )}
              </div>
              {a.last_error && (
                <pre className="mt-1 text-amber-200/60 whitespace-pre-wrap break-all font-mono leading-relaxed">{a.last_error}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


export default function Admin() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: fetchAdminStats,
    refetchInterval: 5_000,
  });

  // DB stats polled less aggressively (information_schema can be slow)
  const { data: dbData } = useQuery({
    queryKey: ["db-stats"],
    queryFn: fetchDbStats,
    refetchInterval: 30_000,
  });

  const collectMutation = useMutation({
    mutationFn: collectAll,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-stats"] }),
  });

  // Source management state
  // null = closed | "new" = add form | SourceAdmin = edit form
  const [modalSource, setModalSource] = useState<SourceAdmin | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [collectingId, setCollectingId] = useState<number | null>(null);

  const invalidateSources = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    queryClient.invalidateQueries({ queryKey: ["sources"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: SourceCreatePayload) =>
      modalSource === "new"
        ? createSource(payload)
        : updateSource((modalSource as SourceAdmin).id, payload),
    onSuccess: () => { invalidateSources(); setModalSource(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, hard }: { id: number; hard: boolean }) => deleteSource(id, hard),
    onSuccess: () => { invalidateSources(); setConfirmDelete(null); },
  });

  if (isLoading || !data) return <p className="text-gray-500">Loading…</p>;

  // Source modal rendering
  const modalNode = modalSource !== null && (
    <SourceModal
      source={modalSource === "new" ? null : modalSource}
      onClose={() => setModalSource(null)}
      onSave={(payload) => saveMutation.mutate(payload)}
      isSaving={saveMutation.isPending}
    />
  );

  const total     = data.pipeline.total    ?? 0;
  const collecte  = data.pipeline.collecte  ?? 0;
  const pertinent = data.pipeline.pertinent ?? 0;
  const horsSujet = data.pipeline.hors_sujet ?? 0;
  const processing = data.pipeline.processing ?? 0;
  const enrichi   = data.pipeline.enrichi   ?? 0;
  const scored    = data.pipeline.score     ?? 0;
  const totalPipelineErrors = Object.values(data.pipeline_error_totals).reduce((a, b) => a + b, 0);
  const relTotal = Object.values(data.relevance_distribution).reduce((a, b) => a + b, 0);

  const enrichHistory  = data.rate_history.map((h) => h.enriched);
  const scoreHistory   = data.rate_history.map((h) => h.scored);
  const embedHistory   = data.rate_history.map((h) => h.embedded);

  const distTotal = Object.values(data.score_distribution).reduce((a, b) => a + b, 0);

  // Idle re-review sweep progress: how much of the scored corpus is already on
  // the current pipeline version (pending = scored articles still on an older one).
  const reviewUpToDate = Math.max(0, scored - data.review_pending);
  const reviewPct = scored > 0 ? (reviewUpToDate / scored) * 100 : 100;

  return (
    <div className="space-y-8">
      {modalNode}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-100">Pipeline monitor</h1>
        <button
          onClick={() => collectMutation.mutate()}
          disabled={collectMutation.isPending}
          className="px-4 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-sm font-medium"
        >
          {collectMutation.isPending ? "Collecting…" : "Collect all sources"}
        </button>
      </div>

      {/* ── Collection errors (24h) ──────────────────────────────────────── */}
      {data.error_count_24h > 0 && (
        <details className="bg-red-950/40 border border-red-800/60 rounded-lg" open>
          <summary className="flex items-center gap-2 px-4 py-3 text-sm text-red-300 cursor-pointer select-none list-none">
            <span className="text-red-500 text-base">⚠</span>
            <span className="font-medium">
              {data.error_count_24h} collection error{data.error_count_24h > 1 ? "s" : ""} in the last 24 hours
            </span>
            <span className="ml-auto text-red-700 text-xs">click to collapse</span>
          </summary>
          <div className="px-4 pb-4 space-y-2">
            {data.error_logs.map((e) => (
              <div key={e.id} className="rounded bg-red-950/60 border border-red-900/40 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-red-300">{e.source_name}</span>
                  <span className="text-xs text-gray-600">{fmtDate(e.collected_at)}</span>
                </div>
                <pre className="text-xs text-red-200/70 whitespace-pre-wrap break-all font-mono leading-relaxed">
                  {e.errors}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Pipeline errors (enrich/score/gate) ──────────────────────────── */}
      {/* Before: only err/min rates were shown, with no detail anywhere — a
          burst would flash "err/min" for 60s then vanish without a trace. */}
      {totalPipelineErrors > 0 && (
        <details className="bg-amber-950/30 border border-amber-800/50 rounded-lg">
          <summary className="flex items-center gap-2 px-4 py-3 text-sm text-amber-300 cursor-pointer select-none list-none">
            <span className="text-amber-500 text-base">⚠</span>
            <span className="font-medium">
              {totalPipelineErrors} pipeline error{totalPipelineErrors > 1 ? "s" : ""} since startup
            </span>
            <span className="text-amber-700/80 text-xs">
              {Object.entries(data.pipeline_error_totals).map(([k, v]) => `${k}: ${v}`).join(" · ")}
            </span>
            <span className="ml-auto text-amber-700 text-xs">click to expand</span>
          </summary>
          <div className="px-4 pb-4 space-y-1.5 max-h-72 overflow-y-auto">
            {data.pipeline_errors.map((e, i) => (
              <div key={i} className="rounded bg-amber-950/40 border border-amber-900/30 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 font-mono">{e.stage}</span>
                  {e.article_id !== null && (
                    <a href={`/articles/${e.article_id}`} className="text-indigo-400 hover:text-indigo-300">
                      article #{e.article_id}
                    </a>
                  )}
                  <span className="ml-auto text-gray-600">{fmtDate(e.at)}</span>
                </div>
                <pre className="text-amber-200/70 whitespace-pre-wrap break-all font-mono leading-relaxed">{e.message}</pre>
              </div>
            ))}
            {data.pipeline_errors.length === 0 && (
              <p className="text-xs text-gray-500 pb-2">
                Aucune erreur récente en mémoire (les compteurs cumulés datent du démarrage du conteneur).
              </p>
            )}
          </div>
        </details>
      )}

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total articles"  value={fmtNum(total)} />
        <StatCard label="Collected today" value={fmtNum(data.articles_today)} />
        <StatCard label="Collected 7 days" value={fmtNum(data.articles_week)} />
        <StatCard label="Avg confidence"  value={data.avg_score ?? "—"} sub="/100" />
        <StatCard
          label="Reliable"
          value={`${data.pct_reliable}%`}
          sub={`${fmtNum(data.reliable_count)} articles`}
          accent={data.pct_reliable >= 30 ? "text-green-400" : "text-yellow-400"}
        />
        <StatCard label="Collected last hour" value={fmtNum(data.throughput_last_hour)} sub="articles" />
      </div>

      {/* ── Pipeline progress ────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Pipeline progress</h2>

        <div className="space-y-4">
          {/* Embeddings */}
          {data.embeddings_done < data.embeddings_total && (
            <div>
              <div className="flex justify-between items-center text-xs text-gray-400 mb-1.5">
                <span className="flex items-center gap-2 flex-wrap">
                  Embeddings
                  <span className="text-gray-600">(vector index for corroboration)</span>
                  {data.embedded_per_min > 0 && (
                    <span className="text-purple-400 animate-pulse">⚙ {data.embedded_per_min}/min</span>
                  )}
                  <Sparkline data={embedHistory} color="#a855f7" />
                </span>
                <span className="flex items-center gap-3 flex-shrink-0">
                  {data.eta_embed_min !== null && (
                    <span className="text-gray-500">ETA ~{fmtEta(data.eta_embed_min)}</span>
                  )}
                  <span className="text-purple-400">{fmtNum(data.embeddings_done)} / {fmtNum(data.embeddings_total)}</span>
                </span>
              </div>
              <ProgressBar pct={(data.embeddings_done / data.embeddings_total) * 100} color="bg-purple-600" />
            </div>
          )}

          {/* Enrichment */}
          <div>
            <div className="flex justify-between items-center text-xs text-gray-400 mb-1.5">
              <span className="flex items-center gap-2 flex-wrap">
                Enriched
                <span className="text-gray-600">(summary + tags)</span>
                {processing > 0 && (
                  <span className="text-orange-400 animate-pulse">⚙ {processing} in progress</span>
                )}
                {data.enriched_per_min > 0 && (
                  <span className="text-blue-400">{data.enriched_per_min}/min</span>
                )}
                {data.enrich_errors_per_min > 0 && (
                  <span className="text-red-400">⚠ {data.enrich_errors_per_min} err/min</span>
                )}
                <Sparkline data={enrichHistory} color="#60a5fa" />
              </span>
              <span className="flex items-center gap-3 flex-shrink-0">
                {data.eta_enrich_min !== null && (
                  <span className="text-gray-500">ETA ~{fmtEta(data.eta_enrich_min)}</span>
                )}
                <span className="text-blue-400">{fmtNum(data.enriched_done)} / {fmtNum(data.processable)} — {data.pct_enriched}%</span>
              </span>
            </div>
            <ProgressBar pct={data.pct_enriched} color="bg-blue-500" />
          </div>

          {/* Scoring */}
          <div>
            <div className="flex justify-between items-center text-xs text-gray-400 mb-1.5">
              <span className="flex items-center gap-2 flex-wrap">
                Scored
                <span className="text-gray-600">(confidence index)</span>
                {data.scoring_active > 0 && (
                  <span className="text-green-400 animate-pulse">⚙ {data.scoring_active} in progress</span>
                )}
                {data.scored_per_min > 0 && (
                  <span className="text-green-400">{data.scored_per_min}/min</span>
                )}
                {data.score_errors_per_min > 0 && (
                  <span className="text-red-400">⚠ {data.score_errors_per_min} err/min</span>
                )}
                <Sparkline data={scoreHistory} color="#4ade80" />
              </span>
              <span className="flex items-center gap-3 flex-shrink-0">
                {data.eta_score_min !== null && (
                  <span className="text-gray-500">ETA ~{fmtEta(data.eta_score_min)}</span>
                )}
                <span className="text-green-400">{fmtNum(data.scored_done)} / {fmtNum(data.processable)} — {data.pct_scored}%</span>
              </span>
            </div>
            <ProgressBar pct={data.pct_scored} color="bg-green-500" />
          </div>
        </div>

        {/* Pipeline funnel counts */}
        <div className="flex flex-wrap gap-3 pt-1 border-t border-gray-800">
          {[
            { label: "collecte",   count: collecte,   color: "text-gray-400" },
            { label: "pertinent",  count: pertinent,  color: "text-purple-400" },
            { label: "processing", count: processing,  color: "text-orange-400" },
            { label: "enrichi",    count: enrichi,     color: "text-blue-400" },
            { label: "score",      count: scored,      color: "text-green-400" },
            { label: "hors sujet", count: horsSujet,   color: "text-red-400" },
          ].map(({ label, count, color }) => (
            <span key={label} className="text-xs text-gray-600">
              {label}: <span className={`${color} font-medium`}>{fmtNum(count)}</span>
            </span>
          ))}
          {data.gated_per_min > 0 && (
            <span className="text-xs text-purple-400 animate-pulse ml-auto">
              ⚙ gate : {data.gated_per_min}/min
            </span>
          )}
        </div>

        <p className="text-xs text-gray-700">auto-refresh every 5s · sparklines = last 6 min (30s intervals)</p>
      </div>

      {/* ── Re-vérification (assurance qualité) ───────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Re-vérification
            <span className="text-gray-600 font-normal ml-2 normal-case">
              repasse les anciens articles dans la pipeline quand elle est au repos
            </span>
          </h2>
          <span className="flex items-center gap-3 text-xs">
            {data.reviewed_per_min > 0 && (
              <span className="text-indigo-400 animate-pulse">🔁 {data.reviewed_per_min}/min</span>
            )}
            <span className="text-gray-600">pipeline v{data.current_pipeline_version}</span>
            <span
              className={
                data.review_enabled
                  ? "px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                  : "px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500"
              }
            >
              {data.review_enabled ? "actif" : "désactivé"}
            </span>
          </span>
        </div>

        <div>
          <div className="flex justify-between items-center text-xs text-gray-400 mb-1.5">
            <span>
              Corpus scoré à la version courante
              <span className="text-gray-600 ml-2">
                {data.review_pending > 0
                  ? `${fmtNum(data.review_pending)} article${data.review_pending > 1 ? "s" : ""} à re-vérifier`
                  : "tout est à jour ✓"}
              </span>
            </span>
            <span className={reviewPct >= 99.5 ? "text-emerald-400" : "text-indigo-300"}>
              {fmtNum(reviewUpToDate)} / {fmtNum(scored)} — {reviewPct.toFixed(1)}%
            </span>
          </div>
          <ProgressBar pct={reviewPct} color={reviewPct >= 99.5 ? "bg-emerald-500" : "bg-indigo-500"} />
        </div>

        <p className="text-xs text-gray-700">
          {fmtNum(data.reviewed_count)} article{data.reviewed_count > 1 ? "s" : ""} déjà repassé
          {data.reviewed_count > 1 ? "s" : ""} dans la pipeline · ne tourne que lorsque la pipeline est
          au repos (cède toujours la priorité à une vraie collecte)
        </p>
      </div>

      {/* ── Articles en erreur (re-run / delete) ─────────────────────────── */}
      <ArticleOpsCard errored={data.errored_articles} />

      {/* ── Score distribution + Quality ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Score distribution */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Score distribution
            <span className="text-gray-600 font-normal ml-2 normal-case">({fmtNum(distTotal)} scored)</span>
          </h2>
          {distTotal === 0 ? (
            <p className="text-gray-600 text-sm">No scored articles yet.</p>
          ) : (
            <div className="space-y-2.5">
              {(
                [
                  { range: "80-100", color: "bg-green-500",   label: "80–100" },
                  { range: "60-80",  color: "bg-emerald-500", label: "60–80" },
                  { range: "40-60",  color: "bg-yellow-500",  label: "40–60" },
                  { range: "20-40",  color: "bg-orange-500",  label: "20–40" },
                  { range: "0-20",   color: "bg-red-500",     label: "0–20" },
                ] as const
              ).map(({ range, color, label }) => {
                const count = data.score_distribution[range] ?? 0;
                const pct   = distTotal > 0 ? (count / distTotal) * 100 : 0;
                return (
                  <div key={range} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12 text-right tabular-nums">{label}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-2">
                      <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-24 text-right tabular-nums">
                      {fmtNum(count)} <span className="text-gray-600">({pct.toFixed(1)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quality metrics */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
              <div className={`text-2xl font-bold ${data.corroboration_coverage >= 20 ? "text-indigo-300" : "text-gray-500"}`}>
                {data.corroboration_coverage}%
              </div>
              <div className="text-xs text-gray-500 mt-1">Corroboration coverage</div>
              <div className="text-xs text-gray-600 mt-0.5">of scored articles</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
              <div className={`text-2xl font-bold ${data.fact_check_coverage >= 50 ? "text-indigo-300" : "text-gray-500"}`}>
                {data.fact_check_coverage}%
              </div>
              <div className="text-xs text-gray-500 mt-1">Fact-check coverage</div>
              <div className="text-xs text-gray-600 mt-0.5">of scored articles</div>
            </div>
          </div>

          {/* Top tags */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Top tags</div>
            {data.top_tags.length === 0 ? (
              <p className="text-gray-600 text-xs">No tags yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {data.top_tags.map((t) => (
                  <span
                    key={t.name}
                    className="text-xs bg-gray-800 text-gray-300 rounded px-2 py-0.5 flex items-center gap-1"
                  >
                    {t.name}
                    <span className="text-gray-500 font-medium">{t.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Relevance + ML ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Relevance distribution */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Pertinence
            <span className="text-gray-600 font-normal ml-2 normal-case">({fmtNum(relTotal)} articles)</span>
          </h2>
          <p className="text-xs text-gray-600 mb-4">
            Axe orthogonal à la confiance : l'article est-il dans le périmètre de veille ?
          </p>
          <div className="space-y-2.5">
            {(
              [
                { key: "on_topic",     color: "bg-emerald-500", label: "on topic" },
                { key: "borderline",   color: "bg-amber-500",   label: "borderline" },
                { key: "off_topic",    color: "bg-red-500",     label: "hors sujet" },
                { key: "unclassified", color: "bg-gray-600",    label: "non classé" },
              ] as const
            ).map(({ key, color, label }) => {
              const count = data.relevance_distribution[key] ?? 0;
              const pct = relTotal > 0 ? (count / relTotal) * 100 : 0;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-20 text-right">{label}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-24 text-right tabular-nums">
                    {fmtNum(count)} <span className="text-gray-600">({pct.toFixed(1)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
          {data.llm_calls_saved > 0 && (
            <p className="text-xs text-gray-600 mt-4 pt-3 border-t border-gray-800">
              💡 <span className="text-purple-400 font-medium">{fmtNum(data.llm_calls_saved)}</span> appels
              LLM économisés par le gate ({fmtNum(horsSujet)} articles stoppés avant enrichissement × 3 appels)
            </p>
          )}
        </div>

        {/* ML classifier */}
        <MlCard feedbackCount={data.feedback_count} />
      </div>

      {/* ── Topic anchors ─────────────────────────────────────────────────── */}
      <AnchorsSection />

      {/* ── Sources ───────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Sources
            <span className="text-gray-600 font-normal ml-2 normal-case">
              {data.sources.filter((s) => s.active).length} active / {data.sources.length} total
            </span>
          </h2>
          <button
            onClick={() => setModalSource("new")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 text-sm font-medium transition-colors"
          >
            <span className="text-base leading-none">+</span> Add source
          </button>
        </div>

        {saveMutation.isError && (
          <div className="mb-3 px-3 py-2 rounded bg-red-950 border border-red-800 text-xs text-red-300">
            {String((saveMutation.error as Error)?.message ?? "Save failed")}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left pb-2">Source</th>
                <th className="text-center pb-2 w-16">Rel.</th>
                <th className="text-center pb-2 w-16">Type</th>
                <th className="text-center pb-2 w-20">Articles</th>
                <th className="text-left pb-2">Scored</th>
                <th className="text-left pb-2">Last collected</th>
                <th className="text-right pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => {
                const sScored  = s.pipeline.score ?? 0;
                const sPct     = s.article_count > 0 ? (sScored / s.article_count) * 100 : 0;
                const sPending = (s.pipeline.collecte ?? 0) + (s.pipeline.enrichi ?? 0);
                const isDeleting = deleteMutation.isPending && confirmDelete === s.id;

                return (
                  <tr
                    key={s.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/20 ${!s.active ? "opacity-50" : ""}`}
                  >
                    {/* Name */}
                    <td className="py-2.5 pr-3">
                      <div className="text-gray-300 font-medium text-sm">{s.name}</div>
                      <div className="text-gray-600 text-xs font-mono truncate max-w-xs" title={s.feed_url}>
                        {s.feed_url}
                      </div>
                    </td>

                    {/* Reliability */}
                    <td className="py-2.5 text-center">
                      <span className={`font-medium text-sm ${
                        s.reliability >= 85 ? "text-green-400" :
                        s.reliability >= 65 ? "text-yellow-400" : "text-orange-400"
                      }`}>{s.reliability}</span>
                    </td>

                    {/* Type */}
                    <td className="py-2.5 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                        s.type === "rss" ? "bg-indigo-900/50 text-indigo-300" : "bg-yellow-900/40 text-yellow-300"
                      }`}>
                        {s.type}
                      </span>
                    </td>

                    {/* Articles count */}
                    <td className="py-2.5 text-center text-gray-400 tabular-nums">
                      {fmtNum(s.article_count)}
                    </td>

                    {/* Scored progress */}
                    <td className="py-2.5 pr-3 min-w-[120px]">
                      {s.article_count > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                            <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${sPct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                            {sScored}/{s.article_count}
                            {sPending > 0 && <span className="text-orange-400 ml-1">+{sPending}</span>}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-700 text-xs">—</span>
                      )}
                    </td>

                    {/* Last collected */}
                    <td className="py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {fmtDate(s.last_collected)}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 text-right">
                      {confirmDelete === s.id ? (
                        /* Confirm delete row */
                        <span className="flex items-center justify-end gap-2">
                          <span className="text-xs text-gray-500">
                            {s.article_count > 0
                              ? `Remove ${fmtNum(s.article_count)} articles?`
                              : "Remove source?"}
                          </span>
                          <button
                            onClick={() => deleteMutation.mutate({ id: s.id, hard: true })}
                            disabled={isDeleting}
                            className="text-xs text-red-400 hover:text-red-300 font-medium disabled:opacity-50"
                          >
                            {isDeleting ? "…" : "Confirm"}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs text-gray-500 hover:text-gray-300"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-2">
                          {/* Collect now */}
                          <button
                            title="Collect now"
                            disabled={collectingId === s.id || !s.active}
                            onClick={async () => {
                              setCollectingId(s.id);
                              await collectSource(s.id).catch(() => null);
                              setTimeout(() => { setCollectingId(null); invalidateSources(); }, 3000);
                            }}
                            className="text-xs text-gray-500 hover:text-indigo-400 disabled:opacity-30"
                          >
                            {collectingId === s.id ? "⏳" : "▶"}
                          </button>

                          {/* Toggle active */}
                          <button
                            title={s.active ? "Pause" : "Resume"}
                            onClick={() =>
                              updateSource(s.id, { active: !s.active }).then(invalidateSources)
                            }
                            className={`text-xs ${s.active ? "text-green-500 hover:text-yellow-400" : "text-gray-600 hover:text-green-400"}`}
                          >
                            {s.active ? "●" : "○"}
                          </button>

                          {/* Edit */}
                          <button
                            title="Edit"
                            onClick={() => setModalSource(s)}
                            className="text-xs text-gray-500 hover:text-gray-200"
                          >
                            ✎
                          </button>

                          {/* Delete */}
                          <button
                            title="Delete"
                            onClick={() => setConfirmDelete(s.id)}
                            className="text-xs text-gray-600 hover:text-red-400"
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-700 mt-3">
          ▶ collect now · ● pause / ○ resume · ✎ edit · ✕ remove
        </p>
      </div>

      {/* ── DB overview ───────────────────────────────────────────────────── */}
      {dbData && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Database
            <span className="text-gray-600 font-normal ml-2 normal-case text-xs">
              {(dbData.total_data_mb + dbData.total_index_mb).toFixed(1)} MB total
              · {dbData.total_data_mb.toFixed(1)} MB data
              · {dbData.total_index_mb.toFixed(1)} MB indexes
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2">Table</th>
                  <th className="text-right pb-2">Rows (est.)</th>
                  <th className="text-right pb-2">Data</th>
                  <th className="text-right pb-2">Index</th>
                  <th className="text-right pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {dbData.tables.map((t) => (
                  <tr key={t.name} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                    <td className="py-1.5 text-gray-300 font-mono text-xs">{t.name}</td>
                    <td className="py-1.5 text-right text-gray-400 text-xs tabular-nums">
                      {t.rows > 0 ? fmtNum(t.rows) : "—"}
                    </td>
                    <td className="py-1.5 text-right text-gray-500 text-xs tabular-nums">
                      {t.data_mb.toFixed(2)} MB
                    </td>
                    <td className="py-1.5 text-right text-gray-500 text-xs tabular-nums">
                      {t.index_mb.toFixed(2)} MB
                    </td>
                    <td className="py-1.5 text-right text-gray-400 text-xs tabular-nums font-medium">
                      {(t.data_mb + t.index_mb).toFixed(2)} MB
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-700 mt-2">
            Row counts are InnoDB estimates · sizes include BLOB content (articles.content) · refreshed every 30s
          </p>
        </div>
      )}

      {/* ── Recent collections ────────────────────────────────────────────── */}
      {data.recent_logs.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Recent collections
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2">Source</th>
                  <th className="text-center pb-2">Articles</th>
                  <th className="text-left pb-2">At</th>
                  <th className="text-left pb-2">Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_logs.map((log) => (
                  <tr
                    key={log.id}
                    className={`border-b border-gray-800/50 ${log.errors ? "bg-red-950/20" : ""}`}
                  >
                    <td className="py-1.5 text-gray-300">{log.source_name}</td>
                    <td className="py-1.5 text-center text-gray-400 tabular-nums">{log.articles_fetched}</td>
                    <td className="py-1.5 text-gray-500 text-xs">{fmtDate(log.collected_at)}</td>
                    <td className="py-1.5 text-xs text-red-400 max-w-xs truncate" title={log.errors ?? undefined}>
                      {log.errors ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
