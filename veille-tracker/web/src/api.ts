const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || res.statusText);
  }
  // 204 No Content — nothing to parse
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const fetchArticles = (
  params: URLSearchParams,
  tags: string[] = [],
  deduplicate = true,
  showOffTopic = false,
) => {
  // Clone so we don't mutate the caller's params
  const p = new URLSearchParams(params);
  tags.forEach((t) => p.append("tags", t));
  if (!deduplicate) p.set("deduplicate", "false");
  if (showOffTopic) p.set("show_off_topic", "true");
  return get<import("./types").Article[]>(`/articles?${p}`);
};

export const fetchArticle = (id: string) =>
  get<import("./types").ArticleDetail>(`/articles/${id}`);

// Re-run an article through the whole pipeline (error recovery / manual re-check)
export const reprocessArticle = (id: number) =>
  req<import("./types").Article>("POST", `/articles/${id}/reprocess`);

// Hard-delete an article and its dependent rows
export const deleteArticle = (id: number) =>
  req<void>("DELETE", `/articles/${id}`);

export const fetchSources = () =>
  get<import("./types").Source[]>("/sources");

export const fetchStats = () =>
  get<import("./types").Stats>("/stats");

export const collectAll = () =>
  fetch(`${BASE}/sources/collect-all`, { method: "POST" }).then((r) => r.json());

export const fetchAdminStats = () =>
  get<import("./types").AdminStats>("/stats/admin");

export const fetchDbStats = () =>
  get<import("./types").DbStats>("/stats/db");

// ── Source management ─────────────────────────────────────────────────────────

export const createSource = (data: import("./types").SourceCreatePayload) =>
  req<import("./types").Source>("POST", "/sources", data);

export const updateSource = (
  id: number,
  data: Partial<import("./types").SourceCreatePayload>,
) => req<import("./types").Source>("PATCH", `/sources/${id}`, data);

export const deleteSource = (id: number, hard = false) =>
  req<void>("DELETE", `/sources/${id}${hard ? "?hard=true" : ""}`);

export const collectSource = (id: number) =>
  get<{ status: string; source_id: number }>(`/sources/${id}/collect`);

// ── Relevance: feedback, anchors, ML ─────────────────────────────────────────

export const setFeedback = (articleId: number, verdict: "pertinent" | "non_pertinent") =>
  req<import("./types").Article>("PUT", `/articles/${articleId}/feedback`, { verdict });

export const removeFeedback = (articleId: number) =>
  req<import("./types").Article>("DELETE", `/articles/${articleId}/feedback`);

export const fetchAnchors = () =>
  get<import("./types").Anchor[]>("/relevance/anchors");

export const createAnchor = (phrase: string, polarity: "positive" | "negative") =>
  req<import("./types").Anchor>("POST", "/relevance/anchors", { phrase, polarity });

export const patchAnchor = (id: number, data: Partial<Pick<import("./types").Anchor, "phrase" | "polarity" | "active">>) =>
  req<import("./types").Anchor>("PATCH", `/relevance/anchors/${id}`, data);

export const deleteAnchor = (id: number) =>
  req<void>("DELETE", `/relevance/anchors/${id}`);

export const fetchMlModel = () =>
  get<import("./types").MlModelStatus>("/relevance/model");

export const retrainModel = () =>
  req<{ trained: boolean; reason?: string; accuracy?: number; n_samples?: number }>(
    "POST", "/relevance/retrain",
  );
