-- Migration 002 — Contrastive anchors (2026-06-12)
-- Calibration v1 finding: absolute cosine vs positive anchors does NOT
-- separate spam from legit content (PayPal spam scored 0.55, mid-distribution;
-- lowest absolute scores were legitimate non-English articles).
-- v2: relevance = margin between max cos(positive anchors) and max
-- cos(negative anchors). Measured on the corpus: all known spam < -0.12,
-- legitimate content > -0.10. See scripts/calibrate_v2_contrastive.py.

ALTER TABLE topic_anchors
  ADD COLUMN polarity ENUM('positive','negative') NOT NULL DEFAULT 'positive' AFTER phrase;

-- Negative anchors: what the watch is NOT about (observed junk categories)
INSERT INTO topic_anchors (phrase, polarity) VALUES
  ('buy verified accounts for sale, PayPal Cash App crypto exchange account marketplace', 'negative'),
  ('online casino, sports betting tips, gambling promotions and game predictions',        'negative'),
  ('spa, massage, beauty salon, restaurant and travel recommendations',                   'negative'),
  ('cryptocurrency trading guide, exchange account verification, investment signals',     'negative'),
  ('affiliate marketing income schemes, SEO link building, make money online fast',       'negative'),
  ('personal development, spirituality, lifestyle and wellness coaching',                 'negative'),
  ('corporate shareholder meetings, stock market announcements unrelated to technology',  'negative'),
  ('sports match previews, team news and player transfers',                               'negative');
