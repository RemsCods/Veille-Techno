export interface Tag {
  id: number;
  name: string;
}

export type RelevanceBucket = "on_topic" | "borderline" | "off_topic";

export interface Article {
  id: number;
  source_id: number;
  url: string;
  title: string;
  summary: string | null;
  author: string | null;
  published_at: string | null;
  collected_at: string;
  confidence_score: number | null;
  previous_confidence_score: number | null;  // score before the last re-review (old→new)
  relevance: RelevanceBucket | null;
  relevance_score: number | null;   // 0-100, 50 = neutral margin
  relevance_reason: string | null;
  ml_relevance: number | null;      // learned classifier probability, 0-100
  feedback: { verdict: "pertinent" | "non_pertinent" } | null;
  status: string;
  pipeline_version: number;         // version that last fully processed this article
  reviewed_at: string | null;       // last idle re-review pass (null = never reviewed)
  error_count: number;              // consecutive pipeline failures (parked at the cap)
  last_error: string | null;        // last failure message
  tags: Tag[];
  cluster_size: number;  // >1 = canonical with N-1 similar articles from other sources
}

export interface FactCheck {
  id: number;
  claim: string;
  verifiable: boolean | null;
  supporting_sources: string | null;
}

export interface Corroboration {
  similar_article_id: number;
  similarity_score: number;
}

export interface ScoreBreakdown {
  source: number;
  corroboration: number;
  fact_check: number;
  freshness: number;      // average of recency + completeness
  recency: number;
  completeness: number;
}

export interface ArticleDetail extends Article {
  content: string | null;
  corroborations: Corroboration[];
  fact_checks: FactCheck[];
  score_breakdown: ScoreBreakdown | null;
}

export interface Source {
  id: number;
  name: string;
  feed_url: string;
  type: string;
  reliability: number;
  active: boolean;
  last_collected: string | null;
}

export interface Stats {
  total_articles: number;
  reliable_articles: number;
  pct_reliable: number;
  avg_score: number | null;
  articles_by_status: Record<string, number>;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface RatePoint {
  enriched: number;
  scored: number;
  embedded: number;
}

export interface SourceAdmin {
  id: number;
  name: string;
  feed_url: string;
  type: string;
  reliability: number;
  active: boolean;
  last_collected: string | null;
  article_count: number;
  pipeline: Record<string, number>;
}

export interface SourceCreatePayload {
  name: string;
  feed_url: string;
  type: string;
  reliability: number;
  active: boolean;
}

export interface LogAdmin {
  id: number;
  source_name: string;
  collected_at: string;
  articles_fetched: number;
  errors: string | null;
}

export interface PipelineError {
  stage: string;             // gate | enrich | score
  article_id: number | null;
  message: string;
  at: string;
}

export interface ErroredArticle {
  id: number;
  title: string;
  status: string;
  error_count: number;
  last_error: string | null;
}

export interface AdminStats {
  pipeline: Record<string, number>;
  pct_enriched: number;
  pct_scored: number;
  processable: number;     // total − hors_sujet (denominator for progress)
  enriched_done: number;
  scored_done: number;
  reliable_count: number;
  pct_reliable: number;
  avg_score: number | null;
  throughput_last_hour: number;
  articles_today: number;
  articles_week: number;
  enriched_per_min: number;
  scored_per_min: number;
  embedded_per_min: number;
  gated_per_min: number;
  enrich_errors_per_min: number;
  score_errors_per_min: number;
  scoring_active: number;
  pipeline_errors: PipelineError[];
  pipeline_error_totals: Record<string, number>;
  errored_count: number;
  errored_articles: ErroredArticle[];
  rate_history: RatePoint[];
  embeddings_done: number;
  embeddings_total: number;
  eta_embed_min: number | null;
  eta_enrich_min: number | null;
  eta_score_min: number | null;
  score_distribution: Record<string, number>;
  relevance_distribution: Record<string, number>;
  llm_calls_saved: number;
  feedback_count: number;
  ml_last_trained: string | null;
  ml_accuracy: number | null;
  review_enabled: boolean;
  current_pipeline_version: number;
  review_pending: number;
  reviewed_count: number;
  reviewed_per_min: number;
  corroboration_coverage: number;
  fact_check_coverage: number;
  top_tags: TagCount[];
  error_count_24h: number;
  error_logs: LogAdmin[];
  sources: SourceAdmin[];
  recent_logs: LogAdmin[];
}

export interface Anchor {
  id: number;
  phrase: string;
  polarity: "positive" | "negative";
  active: boolean;
  created_at: string;
}

export interface MlModelStatus {
  trained_at: string | null;
  n_samples: number;
  n_positive: number;
  accuracy: number | null;
  feedback_count: number;
  feedback_positive: number;
  min_per_class: number;
  trainable: boolean;
}

export interface TableStat {
  name: string;
  rows: number;
  data_mb: number;
  index_mb: number;
}

export interface DbStats {
  tables: TableStat[];
  total_data_mb: number;
  total_index_mb: number;
}
