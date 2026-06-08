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
  status           ENUM('collecte','processing','enrichi','score') NOT NULL DEFAULT 'collecte',
  FOREIGN KEY (source_id) REFERENCES sources(id),
  INDEX idx_status (status),
  INDEX idx_score  (confidence_score)
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
  supporting_sources TEXT,
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
