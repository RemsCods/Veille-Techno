# AI/LLM Technology Watch System

**Course project — Technology Intelligence (Veille Technologique)**
**Team:** Remi · Marcel
**Deliverables due:** mid-to-late June 2026
**Language:** English (oral presentation + written report)

---

## Overview

An end-to-end automated technology watch system covering the full intelligence pipeline:
**collect → enrich → score → store → publish**

The system monitors the AI/LLM space across ~24 curated sources (RSS feeds + APIs), editable from the admin UI, processes articles through local LLMs, computes a **confidence index** per article, and exposes the results through a web interface. When idle, it also **re-reviews** older articles through the current pipeline so scores produced by earlier pipeline versions are brought up to date.

### Core intellectual contribution

> *The presence of information in multiple places does not prove its reliability.*

This principle — drawn directly from the course — underpins the entire scoring design. Corroboration across **independent** sources is weighted separately from source reliability, and neither alone is sufficient to label an article trustworthy.

---

## Architecture

### Infrastructure

```
                    [External Sources]
              arXiv · RSS feeds · APIs
                          │
                          ▼
┌──────────────────────────────────────────┐
│  vm-veille  (Debian, Docker Compose)     │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  app  (Python 3.12 — FastAPI)      │  │
│  │                                    │  │
│  │  ┌──────────┐   ┌──────────────┐   │  │
│  │  │Scheduler │   │ API (REST)   │   │  │
│  │  │(collect) │   │ /articles    │   │  │
│  │  │(review)  │   │ /sources     │   │  │
│  │  │ Workers  │──▶│ /stats       │   │  │
│  │  │ gate ·   │   │ /relevance   │   │  │
│  │  │ enrich · │   └──────────────┘   │  │
│  │  │ score    │                      │  │
│  │  └────┬─────┘                      │  │
│  └───────┼────────────────────────────┘  │
│          │                               │
│  ┌───────▼──────┐   ┌─────────────────┐  │
│  │  db           │   │  web            │  │
│  │  MariaDB 11   │   │  React / Nginx  │  │
│  │  (state + all │   │  Feed + Detail  │  │
│  │   data)       │   │  pages          │  │
│  └──────────────┘   └─────────────────┘  │
│                                          │
│  ┌──────────────┐  (optional)            │
│  │   adminer    │  DB UI for demo        │
│  └──────────────┘                        │
└──────────────────────────────────────────┘
              │
              ▼ HTTP :11434
┌─────────────────────────┐
│  LXC-AI  (separate)     │
│  GPU 16 GB + Ollama     │
│  qwen3.5:9b             │
│  llama3.2:3b            │
│  nomic-embed-text       │
└─────────────────────────┘
```

### Docker containers

| Container | Base image | Role |
|---|---|---|
| `db` | `mariadb:11` | All persistent data + pipeline state machine |
| `app` | `python:3.12-slim` (custom) | Scheduler, pipeline workers, FastAPI REST API |
| `web` | `nginx:alpine` + React build | Public feed + article detail pages |
| `adminer` *(optional)* | `adminer:latest` | Database UI for live demo |

### State machine (MariaDB-backed)

Articles progress through states tracked in the `articles.status` column:

```
collecte → [relevance gate] → pertinent → enrichi → score
                 │                            ▲
                 │                            │ [idle re-review]
                 └→ hors_sujet                └─────────────────┐
                    (off-topic: kept in DB,                      │
                     hidden from feed, never      score (older pipeline_version)
                     enriched/scored)             re-injected when the pipeline is idle
```

No external queue (Redis/arq was dropped). Workers poll the DB for articles in the preceding state and advance them on success. Each article carries a `pipeline_version`; when nothing else is flowing through the funnel, the **reviewer** re-injects a small batch of articles scored by an older version back to `pertinent` so they are re-enriched and re-scored (see *Continuous re-review* below).

---

## Tech Stack

### Backend (Python 3.12)

| Library | Purpose |
|---|---|
| FastAPI | REST API + Swagger admin UI |
| SQLAlchemy 2.0 | ORM + DB access |
| Pydantic v2 | Schema validation |
| feedparser | RSS parsing |
| httpx | HTTP client (arXiv, HN APIs) |
| APScheduler | Periodic collection jobs |
| ollama-python | LLM + embedding calls |
| numpy | Cosine similarity computation |

### Frontend

| Library | Purpose |
|---|---|
| React 19 + Vite + TypeScript | SPA framework |
| Tailwind CSS + shadcn/ui | Styling + UI components |
| TanStack Query | Server state / data fetching |

### Infrastructure

- **Proxmox** — hypervisor hosting the VM + LXC-AI container
- **Docker + Docker Compose** — container orchestration on the VM
- **Ollama** — local LLM runtime with GPU passthrough (16 GB VRAM budget, all three models resident)
  - `qwen3.5:9b` — summarisation, tagging, relevance verdict, primary fact-check
  - `llama3.2:3b` — secondary fact-check (cross-family double-check)
  - `nomic-embed-text` — article embeddings + relevance gate anchors

---

## Confidence Index

The confidence score (0–100) is the intellectual core of the system. It has four weighted components:

```
Score = 0.40 × score_source
      + 0.30 × score_corroboration
      + 0.20 × score_fact_check
      + 0.10 × score_freshness_coherence
```

### Component definitions

**`score_source` (40%)** — Static reliability score assigned to the source in the database (0–100). Reflects editorial standards, track record, and domain authority. Determined at seed time, adjustable by admins.

**`score_corroboration` (30%)** — Measures how many **independent** sources cover the same topic within a 72-hour window. Computed via cosine similarity on article embeddings (threshold ≥ 0.85). Key insight: corroboration only counts when sources are genuinely independent — the same article republished on 5 aggregators is not corroboration.

**`score_fact_check` (20%)** — **Dual-model** pass: two cross-family local LLMs (`qwen3.5:9b` + `llama3.2:3b`) each extract verifiable claims and mark them *supported* / *unsupported* / *unverifiable*. Their verdicts are merged by consensus — agreement keeps the verdict, a *supported* vs *unsupported* clash becomes *contested* (half credit), and any *unverifiable* is treated conservatively. Score = (supported + ½·contested) / total verifiable claims. Falls back gracefully if one model is unavailable.

**`score_freshness` (10%)** — Average of two sub-scores, shown separately in the article detail view: *recency* (publication date: <24h = 100, <72h = 60, <7d = 25) and *completeness* (named author +40, content >500 chars +60).

### Reliability threshold

**≥ 70 / 100 → reliable** (green badge)
**< 70 / 100 → flagged** (yellow badge, "verify before sharing")

---

## Relevance (orthogonal axis to confidence)

Confidence answers *"can we trust it?"* — relevance answers *"is it in our watch scope?"*.
The two are never merged: a reliable article can be off-topic and vice versa.
Motivation (measured 2026-06-12): ~50% of the Dev.to AI source was pure spam
(*"Buy Verified PayPal Accounts"*, UFC picks…) scoring mid-range confidence (44–57)
and burning 3 LLM calls each.

Three successive signals:

**1. Contrastive anchor gate** (`relevance.py` + `workers/relevance_gate.py`, no LLM) —
the article embedding is compared to *positive* anchors (the watch scope) and *negative*
anchors (observed junk categories), both editable in the Admin UI:

```
margin = max_cos(positive anchors) − max_cos(negative anchors)

margin < −0.12          → off_topic   (status hors_sujet, 0 LLM calls)
−0.12 ≤ margin < +0.05  → borderline  (continues, LLM decides)
margin ≥ +0.05          → on_topic
```

Calibration finding (the interesting part): an **absolute** cosine threshold does *not*
work — nomic's cosine space is compressed (0.39–0.82), spam sat mid-distribution (0.55)
and the lowest absolute scores were legitimate non-English articles. The contrastive
**margin** cleanly separates: all known spam < −0.12, all legitimate content > −0.10.
Thresholds were measured on the real corpus (`scripts/calibrate_v2_contrastive.py`),
not invented.

**2. LLM verdict** (zero extra cost) — the existing enrichment prompt also returns
`relevance: on_topic|borderline|off_topic` + a one-sentence reason. Merged with the
gate verdict; on sharp disagreement the article stays visible as *borderline*
(a false negative costs more than a false positive in a watch system).

**3. Human feedback + active learning** — 👍/👎 buttons on every card. A verdict acts
immediately (human always wins) and trains a logistic-regression classifier
(pure numpy on the stored 768-d embeddings — CPU, milliseconds, zero VRAM).
The feed's *"À trier"* mode surfaces the articles the model is least sure about
(uncertainty sampling), so each click teaches it the most. Hourly auto-retrain
when new feedback exists (min 10 examples per class).

Off-topic articles are **never deleted**: hidden from the default feed, auditable via
*"Show off-topic"*, re-includable with one click. Backfill of the pre-existing corpus
(4,580 articles): 79.3% on_topic · 19.8% borderline · 0.9% off_topic.

---

## Continuous re-review (idle quality assurance)

The pipeline evolves over time (new confidence formula, dual-model fact-check, LLM
relevance verdict…). Articles processed by an **older version** keep a stale score until
they are re-evaluated. Rather than a one-shot mass reprocess, the system re-reviews them
**gradually, only when idle**:

- Every article carries a `pipeline_version`. The constant `CURRENT_PIPELINE_VERSION`
  (`config.py`) is the version of the current enrich/score logic — bump it whenever that
  logic changes meaningfully and the whole corpus becomes eligible for a fresh sweep.
- When nothing is flowing through the `collecte → enrich → score` funnel, the **reviewer**
  (`workers/reviewer.py`) picks a small batch (`review_batch`, default 8) of `score`
  articles whose `pipeline_version` is behind, stamps `reviewed_at`, stores the current
  score in `previous_confidence_score`, and resets them to `pertinent`. They flow back
  through the existing enricher → scorer and are stamped to the current version.
- **Fair sweep:** selection is ordered `reviewed_at ASC` (never-reviewed first), so no
  article is reviewed twice while others have never been reviewed — even if a re-review
  fails and retries.
- **Self-throttling:** injecting makes the next cycle non-idle, so only a trickle is
  re-injected, and a real collection always takes priority. Disable with `review_enabled=false`.

The article detail page shows the **old → new score** for re-reviewed articles, and the
admin dashboard tracks sweep progress (`review_pending`, `reviewed_count`, `🔁 /min`).
On the live corpus, legacy articles were systematically over-scored — re-review commonly
corrects them downward by 10–18 points once the current dual fact-check runs.

---

## Data Sources

Sources are seeded in `db/init.sql` and **managed live from the admin UI**, so the exact
set drifts over time. Current deployment (≈24 sources):

| Source | Type | Reliability |
|---|---|---|
| arXiv cs.AI / cs.CL / cs.LG | API | 90 |
| Google DeepMind | RSS | 90 |
| Google Research blog | RSS | 90 |
| Meta Engineering | RSS | 90 |
| MIT Technology Review | RSS | 85 |
| Google AI Blog | RSS | 80 |
| Microsoft AI Blog | RSS | 80 |
| Nvidia Developer Blog | RSS | 80 |
| OpenAI Blog | RSS | 80 |
| Hugging Face Blog | RSS | 75 |
| The Decoder | RSS | 75 |
| Ars Technica AI | RSS | 70 |
| AWS Machine Learning Blog | RSS | 70 |
| GitHub Blog AI | RSS | 70 |
| Import AI Newsletter | RSS | 70 |
| Hacker News — Anthropic / Mistral queries | API (Algolia) | 65 |
| Hacker News (AI filter) | API (Algolia) | 55 |
| Reddit r/MachineLearning · r/LocalLLaMA · r/Deeplearning | API | 55 |
| Dev.to (tag: ai) | RSS | 50 |

> Anthropic and Mistral publish no usable RSS feed, so they are tracked via **targeted
> Hacker News Algolia queries** (`?query=anthropic`, `?query=mistral`) instead.

---

## Database Schema

```sql
-- Source management
CREATE TABLE sources (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  feed_url        VARCHAR(500) NOT NULL,
  type            ENUM('rss','api') NOT NULL,
  reliability     INT NOT NULL DEFAULT 50,     -- 0-100
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_collected  DATETIME
);

CREATE TABLE blacklist (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  pattern    VARCHAR(300) NOT NULL,
  reason     TEXT,
  added_at   DATETIME NOT NULL DEFAULT NOW()
);

-- Articles with embedded state machine
CREATE TABLE articles (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  source_id        INT NOT NULL REFERENCES sources(id),
  url              VARCHAR(1000) NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  content          LONGTEXT,
  summary          TEXT,
  author           TEXT,
  published_at     DATETIME,
  collected_at     DATETIME NOT NULL DEFAULT NOW(),
  confidence_score          FLOAT,
  previous_confidence_score FLOAT,            -- score before the last re-review (old→new)
  -- relevance: orthogonal axis to confidence (in the watch scope or not)
  relevance        ENUM('on_topic','borderline','off_topic'),
  relevance_score  FLOAT,                     -- contrastive anchor margin, 0-100
  relevance_reason VARCHAR(500),
  ml_relevance     FLOAT,                     -- active-learning classifier probability
  status           ENUM('collecte','processing','pertinent','enrichi','score','hors_sujet')
                     NOT NULL DEFAULT 'collecte',
  pipeline_version SMALLINT NOT NULL DEFAULT 1,  -- version that last fully processed it
  reviewed_at      DATETIME,                  -- last idle re-review pass (NULL = never)
  canonical_id     INT DEFAULT NULL,          -- semantic dedup: NULL = canonical
  cluster_size     INT NOT NULL DEFAULT 1,
  INDEX idx_status (status),
  INDEX idx_score  (confidence_score),
  INDEX idx_review (status, pipeline_version)
);

-- Tagging
CREATE TABLE tags (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE articles_tags (
  article_id INT NOT NULL REFERENCES articles(id),
  tag_id     INT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (article_id, tag_id)
);

-- Embeddings for corroboration + relevance gate (768-d nomic vectors)
CREATE TABLE embeddings (
  article_id INT PRIMARY KEY REFERENCES articles(id),
  vec_data   LONGBLOB NOT NULL,
  model      VARCHAR(100) NOT NULL,
  dimensions INT NOT NULL
);

-- Corroboration links
CREATE TABLE corroborations (
  article_id         INT NOT NULL REFERENCES articles(id),
  similar_article_id INT NOT NULL REFERENCES articles(id),
  similarity_score   FLOAT NOT NULL,
  PRIMARY KEY (article_id, similar_article_id)
);

-- Fact-check results (dual-model consensus)
CREATE TABLE fact_checks (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  article_id        INT NOT NULL REFERENCES articles(id),
  claim             TEXT NOT NULL,
  verifiable        BOOLEAN,
  supporting_sources TEXT,             -- consensus: supported|unsupported|unverifiable|contested
  fact_check_models  VARCHAR(200),     -- e.g. "qwen3.5:9b|llama3.2:3b"
  secondary_status   VARCHAR(20)       -- second model's raw verdict (transparency)
);

-- Operational logs
CREATE TABLE collect_logs (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  source_id        INT NOT NULL REFERENCES sources(id),
  collected_at     DATETIME NOT NULL DEFAULT NOW(),
  articles_fetched INT NOT NULL DEFAULT 0,
  errors           TEXT
);
```

The relevance pipeline adds three more tables (full DDL in **`db/init.sql`**, the source
of truth): `topic_anchors` (editable positive/negative watch-scope phrases),
`feedback` (human 👍/👎 verdicts), and `ml_models` (trained relevance classifiers).

---

## API Endpoints

Exposed by the `app` container. The full interactive doc is available at `/docs` (FastAPI Swagger UI).

| Method | Path | Description |
|---|---|---|
| `GET` | `/articles` | Paginated feed with filters: `source`, `min_score`, `relevance`, `show_off_topic`, `sort_by=uncertainty`, … |
| `GET` | `/articles/{id}` | Article detail + corroborations + fact-check + relevance breakdown |
| `PUT` | `/articles/{id}/feedback` | Human relevance verdict 👍/👎 (`{"verdict": "pertinent"\|"non_pertinent"}`) |
| `DELETE` | `/articles/{id}/feedback` | Remove the verdict (bucket recomputed from margin) |
| `GET/POST/PATCH/DELETE` | `/relevance/anchors[/{id}]` | Manage the watch-scope anchors (positive/negative) |
| `GET` | `/relevance/model` | Active-learning classifier status |
| `POST` | `/relevance/retrain` | Retrain the classifier now |
| `GET` | `/sources` | List all sources |
| `POST` | `/sources` | Add a new source |
| `PATCH` | `/sources/{id}` | Update source (score, active flag) |
| `DELETE` | `/sources/{id}` | Disable a source |
| `GET` | `/sources/{id}/collect` | Trigger manual collection |
| `GET` | `/blacklist` | List blacklisted domains |
| `POST` | `/blacklist` | Add domain to blacklist |
| `DELETE` | `/blacklist/{id}` | Remove from blacklist |
| `GET` | `/stats` | System-level metrics (volume, avg score, % reliable) |
| `GET` | `/stats/admin` | Full dashboard: pipeline funnel, throughput/ETAs, errors, relevance + re-review progress |
| `GET` | `/stats/db` | Per-table row counts and storage size |
| `GET` | `/health` | Liveness check |

---

## Frontend

Four pages:

**Feed** (`/`) — Paginated article list. Filter by source, minimum confidence score, category, relevance, and time range; sort by score, corroborations, or *uncertainty* (active-learning triage). Each card shows title, source, date, tags, relevance + confidence badges, 👍/👎 feedback, and a 🔁 *revu* chip for re-reviewed articles.

**Article Detail** (`/articles/:id`) — Full article view with LLM summary, relevance breakdown, confidence score breakdown by component, corroborating articles, and dual-model fact-check results. Re-reviewed articles show the **old → new score**.

**Admin** (`/admin`) — Live pipeline monitor (throughput, ETAs, error logs), per-source pipeline breakdown + source CRUD, watch-scope anchor editor, active-learning classifier status, and the **re-review (quality assurance)** panel.

**Docs** (`/docs-page`) — In-app documentation of the methodology and pipeline.

The FastAPI Swagger UI remains available at `/docs` for raw API exploration.

---

## Project Structure

```
veille-tracker/
├── docker-compose.yml
├── .env.example
├── db/
│   └── init.sql               # Full DDL + seed data
├── app/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                # FastAPI app entry point
│   ├── models.py              # SQLAlchemy models
│   ├── schemas.py             # Pydantic schemas
│   ├── database.py            # DB session factory
│   ├── config.py              # Settings from env
│   ├── collectors/
│   │   ├── rss.py             # Generic RSS collector
│   │   ├── arxiv.py           # arXiv API collector
│   │   └── hackernews.py      # HN Algolia collector
│   ├── workers/
│   │   ├── relevance_gate.py  # collecte → pertinent | hors_sujet (embed + anchor margin)
│   │   ├── enricher.py        # pertinent → enrichi (LLM summary + tags + relevance verdict)
│   │   ├── scorer.py          # enrichi → score (confidence index, stamps pipeline_version)
│   │   ├── embed_missing.py   # backfill embeddings for legacy articles
│   │   ├── cluster.py         # semantic dedup (canonical election)
│   │   ├── learner.py         # active-learning classifier retrain
│   │   └── reviewer.py        # idle re-review: re-inject legacy 'score' articles
│   ├── scheduler.py           # APScheduler jobs + continuous pipeline loop
│   ├── ollama_client.py       # Ollama HTTP wrapper (chat / chat_with_model / embed)
│   ├── confidence.py          # Confidence formula (dual-model fact-check)
│   ├── relevance.py           # Contrastive anchor gate + signal merge
│   ├── tag_normalizer.py      # Tag canonicalisation
│   ├── pipeline_stats.py      # In-memory throughput / error telemetry
│   ├── scripts/               # backfill_relevance, calibrate_*, one-off migrations
│   └── routers/
│       ├── articles.py
│       ├── sources.py
│       ├── blacklist.py
│       ├── relevance.py       # anchors CRUD + classifier status/retrain
│       └── stats.py           # public + /admin + /db dashboards
└── web/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api.ts              # typed API client
        ├── types.ts            # shared TS types
        ├── pages/
        │   ├── Feed.tsx
        │   ├── ArticleDetail.tsx   # incl. old→new score for re-reviewed articles
        │   ├── Admin.tsx           # pipeline monitor, anchors, re-review panel
        │   └── Docs.tsx            # internal documentation page
        └── components/
            ├── ArticleCard.tsx
            ├── ConfidenceBadge.tsx
            ├── RelevanceBadge.tsx
            ├── FeedbackButtons.tsx
            └── ScoreBreakdown.tsx
```

---

## Implementation Modules

The implementation is broken into 9 independent modules (M1–M9), designed to be developed in parallel where possible.

| Module | Scope | Dependencies |
|---|---|---|
| M1 | DB schema (DDL) + Docker Compose skeleton + `.env` contract | None |
| M2 | RSS + arXiv + HN collectors | M1 |
| M3 | Enrichment worker (LLM summary, tags, embeddings) | M1, M2 |
| M4 | FastAPI app scaffolding + `/health` + `/articles` stub | M1 |
| M5 | Scoring worker (confidence formula, state → `score`) | M1, M3 |
| M6 | Remaining API routes (sources, blacklist, stats) | M4 |
| M7 | Frontend — Feed page | M4 |
| M8 | Frontend — Article Detail page | M4, M7 |
| M9 | APScheduler integration + collect logs | M2, M4 |

**Recommended execution order:**
1. M1 alone (shared contracts, blocks everything else)
2. M2 + M4 + M7 + M8 in parallel
3. M3 + M5
4. M6 + M9

---

## Setup

### Prerequisites

- Proxmox host with a Debian VM (4 vCPU / 8 GB RAM / 50 GB disk recommended)
- Docker + Docker Compose plugin installed on the VM
- LXC-AI container running Ollama on port `11434`, reachable from the VM

### Quick start

```bash
git clone <repo-url>
cd veille-tracker

cp .env.example .env
# Edit .env: set OLLAMA_HOST, DB credentials, collection intervals

docker compose up -d

# Verify all containers are healthy
docker compose ps

# Sources + watch-scope anchors are auto-seeded by db/init.sql on first boot,
# then managed live from the admin UI (http://localhost:3000/admin).

# Check API (host port 8001 → container 8000)
curl http://localhost:8001/health
```

> **Applying a schema migration on an existing DB** (the `db/init.sql` seed only runs on
> a fresh data volume): back up first, then pipe the numbered migration into the db
> container, e.g.
> `docker exec -i veille-tracker-db-1 sh -c 'mariadb -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/003_review.sql`,
> and **rebuild `app` afterwards** (`docker compose up -d --build app`).

### Environment variables (`.env.example`)

```env
# Database
DB_HOST=db
DB_PORT=3306
DB_NAME=veille
DB_USER=veille
DB_PASSWORD=changeme

# Ollama (LXC-AI address)
OLLAMA_HOST=http://192.168.x.x:11434
OLLAMA_CHAT_MODEL=qwen3.5:9b           # summary + tags + relevance verdict + primary fact-check
OLLAMA_FACTCHECK_MODEL=llama3.2:3b     # secondary fact-check (cross-family double-check)
OLLAMA_EMBED_MODEL=nomic-embed-text

# Collection schedule (cron expressions)
RSS_COLLECT_INTERVAL=*/30 * * * *
ARXIV_COLLECT_INTERVAL=0 */2 * * *

# Confidence
CORROBORATION_WINDOW_HOURS=72
CORROBORATION_COSINE_THRESHOLD=0.85
RELIABILITY_THRESHOLD=70

# Relevance gate (contrastive margin thresholds)
RELEVANCE_T_LOW=-0.12                  # < this → off_topic
RELEVANCE_T_HIGH=0.05                  # ≥ this → on_topic

# Idle re-review
REVIEW_ENABLED=true
REVIEW_BATCH=8                         # legacy articles re-injected per idle cycle
```

> Note: the app is published on host port **8001** (`8001:8000`); the examples below
> using `:8000` refer to the in-container port.

---

## Architectural Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-18 | Topic: AI / LLM | High-volume domain, multiple source types |
| 2026-05-18 | Frontend: React + Tailwind + shadcn/ui | Modern, component-driven, familiar to team |
| 2026-05-18 | Single Debian VM with Docker Compose | Simpler than multi-LXC; LXC-AI kept separate for GPU passthrough |
| 2026-05-18 | Reliability threshold: 70/100 on 4 weighted components | Matches course requirement |
| 2026-05-XX | Redis + arq dropped → MariaDB state machine | Reduces container count and operational complexity within time constraints |
| 2026-05-XX | Playwright / generic scraping dropped → RSS + APIs only | Removes flaky dependency; RSS/APIs sufficient for target sources |
| 2026-05-XX | 7 containers → 3 containers (db, app, web) | Scope reduction to preserve quality on core components |
| 2026-05-XX | Custom admin pages → FastAPI Swagger UI | Saves frontend development time with no functional loss |
| 2026-06-12 | Relevance as an axis orthogonal to confidence (contrastive anchor gate + LLM verdict + active learning) | A reliable source can still be off-topic; spam was burning LLM budget |
| 2026-06-13 | Idle re-review with `pipeline_version` tracking | Bring legacy scores up to date gradually, without a disruptive mass reprocess |

---

## Deliverables

- **Written report** (English) — covers veille methodology, system architecture, confidence index design, results
- **10-minute oral presentation** (English) — live demo of the running system, focus on the tool and pipeline rather than methodology
- **Working system** — deployed on Proxmox VM, accessible for the demo

---

*Last updated: 13 June 2026*
