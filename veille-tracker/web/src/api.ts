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

export const fetchArticles = (params: URLSearchParams) =>
  get<import("./types").Article[]>(`/articles?${params}`);

export const fetchArticle = (id: string) =>
  get<import("./types").ArticleDetail>(`/articles/${id}`);

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
