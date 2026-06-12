-- Migration 001 — Relevance pipeline (2026-06-12)
-- Applied on the live DB after backup db/backups/pre_relevance_20260612.sql.gz
-- Adds: relevance columns on articles, new pipeline statuses, topic anchors,
--       human feedback, ML model storage.

-- New pipeline statuses:
--   'pertinent'  = passed the embedding relevance gate, waiting for enrichment
--   'hors_sujet' = filtered out by the gate (or demoted by the LLM) — never enriched/scored
ALTER TABLE articles
  MODIFY COLUMN status ENUM('collecte','processing','pertinent','enrichi','score','hors_sujet')
    NOT NULL DEFAULT 'collecte';

ALTER TABLE articles
  ADD COLUMN relevance        ENUM('on_topic','borderline','off_topic') NULL AFTER confidence_score,
  ADD COLUMN relevance_score  FLOAT        NULL AFTER relevance,         -- embedding vs anchors, 0-100
  ADD COLUMN relevance_reason VARCHAR(500) NULL AFTER relevance_score,   -- closest anchor / LLM reason / human feedback
  ADD COLUMN ml_relevance     FLOAT        NULL AFTER relevance_reason,  -- learned classifier probability, 0-100
  ADD INDEX idx_relevance (relevance);

-- Watch scope definition — each phrase is embedded once and articles are
-- compared against all active anchors (max cosine similarity wins).
CREATE TABLE IF NOT EXISTS topic_anchors (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  phrase     VARCHAR(300) NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW()
);

-- Human relevance feedback (👍/👎) — one verdict per article, updatable.
CREATE TABLE IF NOT EXISTS feedback (
  article_id INT PRIMARY KEY,
  verdict    ENUM('pertinent','non_pertinent') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- Trained relevance classifiers (numpy logistic regression on embeddings).
-- weights = 768 float32 coefficients + 1 float32 bias, packed little-endian.
CREATE TABLE IF NOT EXISTS ml_models (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  trained_at DATETIME NOT NULL DEFAULT NOW(),
  n_samples  INT NOT NULL,
  n_positive INT NOT NULL,
  accuracy   FLOAT,
  weights    LONGBLOB NOT NULL
);

-- Seed anchors — the AI/LLM watch scope. Editable from the Admin UI.
INSERT INTO topic_anchors (phrase) VALUES
  ('large language models, LLM releases, benchmarks and evaluations'),
  ('machine learning research, neural network architectures, training techniques'),
  ('AI products, APIs and developer tools from AI companies'),
  ('open-source AI models, local inference, quantization, GPU optimization'),
  ('AI safety, alignment, governance and regulation'),
  ('embeddings, retrieval-augmented generation, vector databases, semantic search'),
  ('image, video and audio generation models, diffusion models'),
  ('speech recognition, text-to-speech, multimodal models'),
  ('AI agents, autonomous systems, tool use, agentic workflows'),
  ('AI industry news: funding, acquisitions, partnerships, company announcements');
