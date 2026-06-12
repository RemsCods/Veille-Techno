# AI/LLM Technology Watch System

**Course project — Technology Intelligence (Veille Technologique)**
**Team:** Remi · Marcel
**Deliverables due:** mid-to-late June 2026
**Language:** English (oral presentation + written report)

---

## Overview

An end-to-end automated technology watch system covering the full intelligence pipeline:
**collect → enrich → score → store → publish**

The system monitors the AI/LLM space across 17 curated sources (RSS feeds + APIs), processes articles through a local LLM, computes a **confidence index** per article, and exposes the results through a web interface.

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
│  │  │          │   │ /sources     │   │  │
│  │  │ Workers  │──▶│ /stats       │   │  │
│  │  │ (enrich) │   └──────────────┘   │  │
│  │  │ (score)  │                      │  │
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
│  llama3.1:8b            │
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
                 │
                 └→ hors_sujet   (off-topic: kept in DB, hidden from feed,
                                  never enriched/scored — saves 3 LLM calls/article)
```

No external queue (Redis/arq was dropped). Workers poll the DB for articles in the preceding state and advance them on success.

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

**`score_fact_check` (20%)** — LLM-based pass that extracts verifiable factual claims from the article and marks each as *supported*, *unsupported*, or *unverifiable*. Score = ratio of supported to total verifiable claims.

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

## Data Sources

| Source | Type | Base score |
|---|---|---|
| arXiv (cs.AI, cs.CL, cs.LG) | API | 95 |
| Anthropic Blog | RSS | 90 |
| OpenAI Blog | RSS | 90 |
| Google DeepMind | RSS | 90 |
| Meta AI | RSS | 90 |
| Mistral AI | RSS | 90 |
| Hugging Face Blog | RSS | 85 |
| Papers with Code | API | 85 |
| MIT Technology Review (AI) | RSS | 75 |
| Import AI Newsletter | RSS | 75 |
| The Decoder | RSS | 70 |
| Ars Technica AI | RSS | 70 |
| GitHub Trending (AI filter) | API | 65 |
| Reddit r/MachineLearning | API | 60 |
| Hacker News (AI filter) | API (Algolia) | 55 |
| Reddit r/LocalLLaMA | API | 55 |
| Dev.to (tag: ai) | RSS | 50 |

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
  author           VARCHAR(300),
  published_at     DATETIME,
  collected_at     DATETIME NOT NULL DEFAULT NOW(),
  confidence_score FLOAT,
  status           ENUM('collecte','enrichi','score') NOT NULL DEFAULT 'collecte',
  INDEX idx_status (status),
  INDEX idx_score  (confidence_score)
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

-- Embeddings for corroboration
CREATE TABLE embeddings (
  article_id INT PRIMARY KEY REFERENCES articles(id),
  vector     BLOB NOT NULL,
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

-- Fact-check results
CREATE TABLE fact_checks (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  article_id        INT NOT NULL REFERENCES articles(id),
  claim             TEXT NOT NULL,
  verifiable        BOOLEAN,
  supporting_sources TEXT
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
| `GET` | `/health` | Liveness check |

---

## Frontend

Two pages:

**Feed** (`/`) — Paginated article list. Filter by source, minimum confidence score, category, and time range. Each card shows: title, source, publication date, tags, and confidence badge (reliable / verify).

**Article Detail** (`/articles/:id`) — Full article view with LLM-generated summary, confidence score breakdown by component, list of corroborating articles, and fact-check results.

Admin operations (source CRUD, blacklist, manual collection triggers) are handled directly through the FastAPI Swagger UI at `/docs`.

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
│   │   ├── enricher.py        # collecte → enrichi (LLM summary + embed)
│   │   └── scorer.py          # enrichi → score (confidence index)
│   ├── scheduler.py           # APScheduler job definitions
│   ├── ollama_client.py       # Ollama HTTP wrapper
│   ├── confidence.py          # Score formula implementation
│   └── routers/
│       ├── articles.py
│       ├── sources.py
│       ├── blacklist.py
│       └── stats.py
└── web/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── pages/
        │   ├── Feed.tsx
        │   └── ArticleDetail.tsx
        └── components/
            ├── ArticleCard.tsx
            ├── ConfidenceBadge.tsx
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

# Seed initial sources (if not auto-seeded via init.sql)
curl -X POST http://localhost:8000/sources -d @db/seed_sources.json

# Check API
curl http://localhost:8000/health
```

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
OLLAMA_CHAT_MODEL=llama3.1:8b
OLLAMA_EMBED_MODEL=nomic-embed-text

# Collection schedule (cron expressions)
RSS_COLLECT_INTERVAL=*/30 * * * *
ARXIV_COLLECT_INTERVAL=0 */2 * * *

# Confidence
CORROBORATION_WINDOW_HOURS=72
CORROBORATION_COSINE_THRESHOLD=0.85
RELIABILITY_THRESHOLD=70
```

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

---

## Deliverables

- **Written report** (English) — covers veille methodology, system architecture, confidence index design, results
- **10-minute oral presentation** (English) — live demo of the running system, focus on the tool and pipeline rather than methodology
- **Working system** — deployed on Proxmox VM, accessible for the demo

---

*Last updated: June 2026*
