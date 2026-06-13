CREATE TABLE IF NOT EXISTS sources (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(200) NOT NULL,
  feed_url       VARCHAR(500) NOT NULL,
  type           ENUM('rss','api') NOT NULL,
  reliability    INT NOT NULL DEFAULT 50,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_collected DATETIME
);

CREATE TABLE IF NOT EXISTS blacklist (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  pattern  VARCHAR(300) NOT NULL,
  reason   TEXT,
  added_at DATETIME NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS articles (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  source_id        INT NOT NULL,
  url              VARCHAR(1000) NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  content          LONGTEXT,
  summary          TEXT,
  author           TEXT,
  published_at     DATETIME,
  collected_at     DATETIME NOT NULL DEFAULT NOW(),
  confidence_score FLOAT,
  previous_confidence_score FLOAT,            -- score before the last re-review (old→new display)
  -- relevance = is this article in the watch scope? (independent of confidence)
  relevance        ENUM('on_topic','borderline','off_topic'),
  relevance_score  FLOAT,                     -- embedding similarity vs topic anchors, 0-100
  relevance_reason VARCHAR(500),              -- closest anchor / LLM reason / human feedback
  ml_relevance     FLOAT,                     -- learned classifier probability, 0-100
  -- pertinent  = passed the relevance gate, waiting for enrichment
  -- hors_sujet = filtered by the gate or demoted by the LLM — never enriched/scored
  status           ENUM('collecte','processing','pertinent','enrichi','score','hors_sujet') NOT NULL DEFAULT 'collecte',
  -- version of the enrich/score pipeline that last fully processed this article.
  -- The idle reviewer re-sweeps articles with pipeline_version < CURRENT_PIPELINE_VERSION.
  pipeline_version SMALLINT NOT NULL DEFAULT 1,
  reviewed_at      DATETIME DEFAULT NULL,     -- last re-review pass (NULL = never reviewed)
  error_count      INT NOT NULL DEFAULT 0,    -- consecutive pipeline failures; parked at MAX_PIPELINE_ATTEMPTS
  last_error       VARCHAR(500) DEFAULT NULL, -- last failure message (for the admin)
  canonical_id     INT DEFAULT NULL,          -- NULL = canonical article (or not yet clustered)
  cluster_size     INT NOT NULL DEFAULT 1,    -- number of similar articles from other sources
  FOREIGN KEY (source_id) REFERENCES sources(id),
  INDEX idx_status    (status),
  INDEX idx_score     (confidence_score),
  INDEX idx_relevance (relevance),
  INDEX idx_canonical (canonical_id),
  INDEX idx_review    (status, pipeline_version),
  INDEX idx_error     (error_count)
);

CREATE TABLE IF NOT EXISTS tags (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS articles_tags (
  article_id INT NOT NULL,
  tag_id     INT NOT NULL,
  PRIMARY KEY (article_id, tag_id),
  FOREIGN KEY (article_id) REFERENCES articles(id),
  FOREIGN KEY (tag_id)     REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS embeddings (
  article_id INT PRIMARY KEY,
  vec_data   LONGBLOB NOT NULL,
  model      VARCHAR(100) NOT NULL,
  dimensions INT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id)
);

CREATE TABLE IF NOT EXISTS corroborations (
  article_id         INT NOT NULL,
  similar_article_id INT NOT NULL,
  similarity_score   FLOAT NOT NULL,
  PRIMARY KEY (article_id, similar_article_id),
  FOREIGN KEY (article_id)         REFERENCES articles(id),
  FOREIGN KEY (similar_article_id) REFERENCES articles(id)
);

CREATE TABLE IF NOT EXISTS fact_checks (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  article_id         INT NOT NULL,
  claim              TEXT NOT NULL,
  verifiable         BOOLEAN,
  supporting_sources TEXT,          -- consensus status: supported|unsupported|unverifiable|contested
  fact_check_models  VARCHAR(200),  -- e.g. "qwen3.5:9b|gemma4:e4b"
  secondary_status   VARCHAR(20),   -- secondary model's raw verdict (for transparency)
  FOREIGN KEY (article_id) REFERENCES articles(id)
);

CREATE TABLE IF NOT EXISTS collect_logs (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  source_id        INT NOT NULL,
  collected_at     DATETIME NOT NULL DEFAULT NOW(),
  articles_fetched INT NOT NULL DEFAULT 0,
  errors           TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

-- Watch scope definition. Relevance signal = contrastive margin:
-- max_cos(article, positive anchors) - max_cos(article, negative anchors).
-- Absolute cosine alone does not separate spam from legit content (measured
-- on the real corpus) — the margin does. See app/relevance.py.
CREATE TABLE IF NOT EXISTS topic_anchors (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  phrase     VARCHAR(300) NOT NULL UNIQUE,
  polarity   ENUM('positive','negative') NOT NULL DEFAULT 'positive',
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
INSERT INTO topic_anchors (phrase, polarity) VALUES
  ('large language models, LLM releases, benchmarks and evaluations',                     'positive'),
  ('machine learning research, neural network architectures, training techniques',        'positive'),
  ('AI products, APIs and developer tools from AI companies',                              'positive'),
  ('open-source AI models, local inference, quantization, GPU optimization',               'positive'),
  ('AI safety, alignment, governance and regulation',                                      'positive'),
  ('embeddings, retrieval-augmented generation, vector databases, semantic search',        'positive'),
  ('image, video and audio generation models, diffusion models',                           'positive'),
  ('speech recognition, text-to-speech, multimodal models',                                'positive'),
  ('AI agents, autonomous systems, tool use, agentic workflows',                           'positive'),
  ('AI industry news: funding, acquisitions, partnerships, company announcements',         'positive'),
  ('buy verified accounts for sale, PayPal Cash App crypto exchange account marketplace',  'negative'),
  ('online casino, sports betting tips, gambling promotions and game predictions',         'negative'),
  ('spa, massage, beauty salon, restaurant and travel recommendations',                    'negative'),
  ('cryptocurrency trading guide, exchange account verification, investment signals',      'negative'),
  ('affiliate marketing income schemes, SEO link building, make money online fast',        'negative'),
  ('personal development, spirituality, lifestyle and wellness coaching',                  'negative'),
  ('corporate shareholder meetings, stock market announcements unrelated to technology',   'negative'),
  ('sports match previews, team news and player transfers',                                'negative');

-- Seed sources
INSERT INTO sources (name, feed_url, type, reliability) VALUES
  ('arXiv cs.AI',            'https://export.arxiv.org/rss/cs.AI',                         'api', 95),
  ('arXiv cs.CL',            'https://export.arxiv.org/rss/cs.CL',                         'api', 95),
  ('arXiv cs.LG',            'https://export.arxiv.org/rss/cs.LG',                         'api', 95),
  ('Google AI Blog',         'https://blog.google/technology/ai/rss/',                     'rss', 85),
  ('OpenAI Blog',            'https://openai.com/blog/rss.xml',                             'rss', 90),
  ('Google DeepMind',        'https://deepmind.google/blog/rss.xml',                        'rss', 90),
  ('Meta Engineering',       'https://engineering.fb.com/feed/',                            'rss', 90),
  ('Microsoft AI Blog',      'https://blogs.microsoft.com/ai/feed/',                        'rss', 85),
  ('Hugging Face Blog',      'https://huggingface.co/blog/feed.xml',                        'rss', 85),
  ('AWS Machine Learning Blog', 'https://aws.amazon.com/blogs/machine-learning/feed/',      'rss', 70),
  ('MIT Technology Review',  'https://www.technologyreview.com/topic/artificial-intelligence/feed', 'rss', 75),
  ('Import AI Newsletter',   'https://importai.substack.com/feed',                          'rss', 75),
  ('The Decoder',            'https://the-decoder.com/feed/',                               'rss', 70),
  ('Ars Technica AI',        'https://feeds.arstechnica.com/arstechnica/technology-lab',    'rss', 70),
  ('GitHub Blog AI',         'https://github.blog/tag/artificial-intelligence/feed/',       'rss', 70),
  ('Reddit r/MachineLearning','https://www.reddit.com/r/MachineLearning/.rss',              'api', 60),
  ('Hacker News AI',         'https://hn.algolia.com/api/v1/search_by_date',                'api', 55),
  ('Reddit r/LocalLLaMA',    'https://www.reddit.com/r/LocalLLaMA/.rss',                   'api', 55),
  ('Dev.to AI',              'https://dev.to/feed/tag/ai',                                  'rss', 50);
