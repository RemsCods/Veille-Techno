# Veille Techno — Guide de reconstruction

> Document technique complet. Objectif : permettre de recréer le projet de zéro, comprendre chaque décision, et éviter de retomber dans les pièges déjà rencontrés.

**Équipe :** Remi · Marcel — Rendu mi-fin juin 2026  
**Stack :** Python 3.12 · FastAPI · MariaDB 11 · React 19 · Ollama · Docker Compose

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Processus de traitement et évaluation](#2-processus-de-traitement-et-évaluation)
3. [Infrastructure](#3-infrastructure)
4. [Structure du projet](#4-structure-du-projet)
5. [Schéma de base de données](#5-schéma-de-base-de-données)
6. [Pipeline de traitement — implémentation](#6-pipeline-de-traitement--implémentation)
7. [Modèles IA](#7-modèles-ia)
8. [Configuration](#8-configuration)
9. [Sources configurées](#9-sources-configurées)
10. [API REST](#10-api-rest)
11. [Frontend](#11-frontend)
12. [Reconstruction pas-à-pas](#12-reconstruction-pas-à-pas)
13. [Pièges connus et solutions](#13-pièges-connus-et-solutions)
14. [Commandes utiles](#14-commandes-utiles)

---

## 1. Vue d'ensemble

Système de veille technologique sur l'IA/LLM qui :
1. **Collecte** des articles depuis 19 sources (flux RSS + APIs) toutes les 30 min / 2h
2. **Enrichit** chaque article : résumé 3-4 phrases + tags via LLM local (Ollama)
3. **Score** chaque article : indice de confiance 0-100 basé sur 4 composantes
4. **Expose** les articles via une API REST + interface React

Tout tourne en local — aucune API externe payante. Le LLM (qwen3.5:9b) tourne sur une machine séparée (LXC-AI) avec une Radeon RX 7900 XTX.

---

## 2. Processus de traitement et évaluation

### Vue globale du flux

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  19 SOURCES  (RSS / arXiv / HN Algolia)                              │
 │  toutes les 30 min (RSS) · toutes les 2h (arXiv/API)                 │
 └────────────────────────┬─────────────────────────────────────────────┘
                          │  feedparser → INSERT articles (status='collecte')
                          ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  ÉTAPE 1 — ENRICHISSEMENT  (workers/enricher.py)                     │
 │                                                                      │
 │  LLM qwen3.5:9b reçoit : titre + contenu (≤ 2000 chars)             │
 │  Produit :                                                           │
 │    • résumé  3-4 phrases                                             │
 │    • tags    3-5 mots-clés (ex: "llm", "fine-tuning", "rlhf")       │
 │                                                                      │
 │  Si article < 3 jours → embedding nomic-embed-text (768 floats)     │
 │    (articles plus anciens skippés — hors fenêtre de corroboration)   │
 │                                                                      │
 │  status : collecte → processing → enrichi                           │
 └────────────────────────┬─────────────────────────────────────────────┘
                          │
                          ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  ÉTAPE 2 — SCORING  (workers/scorer.py + confidence.py)             │
 │                                                                      │
 │  4 composantes calculées indépendamment, puis pondérées :            │
 │                                                                      │
 │   40% · score_source       (fiabilité statique de la source)        │
 │   30% · score_corroboration (combien de sources indépendantes        │
 │                              couvrent le même sujet ce jour)        │
 │   20% · score_fact_check   (LLM extrait et vérifie les claims)      │
 │   10% · score_freshness    (fraîcheur, auteur nommé, longueur)      │
 │                                                                      │
 │  → confidence_score ∈ [0, 100]                                      │
 │  status : enrichi → score                                           │
 └────────────────────────┬─────────────────────────────────────────────┘
                          │
                          ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  EXPOSITION                                                          │
 │  score ≥ 70 → badge vert  "reliable"                                │
 │  score < 70 → badge jaune "verify"                                  │
 │  Feed React · API REST · filtres par source / score / tag           │
 └──────────────────────────────────────────────────────────────────────┘
```

---

### Étape 1 — Enrichissement

Chaque article brut (titre + contenu RSS) est envoyé au LLM avec ce prompt système :

```
"You are a technical assistant. Summarise the article in 3-4 sentences,
then extract 3-5 relevant tags as a JSON list.
Reply with JSON: {"summary": "...", "tags": ["tag1", ...]}"
```

Le LLM retourne du JSON parsé. En cas d'échec de parsing, le résumé tombe en fallback sur les 300 premiers chars du contenu.

L'embedding (`nomic-embed-text`, 768 dimensions) est généré séparément par un worker dédié sur le texte `titre + résumé`. Il n'est calculé que pour les articles publiés il y a moins de 3 jours — la corroboration utilise une fenêtre 72h, donc les articles plus anciens ne pourront jamais corroborer les articles d'aujourd'hui.

---

### Étape 2 — Scoring : les 4 composantes en détail

#### score_source — 40% du score final

```
Score = reliability de la source (valeur fixe, définie au seed)

arXiv cs.AI/CL/LG       → 95
OpenAI / DeepMind / Meta → 90
Google AI / Microsoft    → 85
MIT Tech Review          → 75
Reddit ML / HN AI        → 55-60
Dev.to                   → 50
```

Composante la plus déterminante. Un article arXiv part avec 38/40 points de cette seule composante.

---

#### score_corroboration — 30% du score final

**Principe :** un fait couvert par plusieurs sources indépendantes est plus fiable.

```
Algorithme :
1. Récupérer tous les embeddings (fenêtre 72h, source_id différent de l'article)
2. Calculer la similarité cosinus entre l'embedding de l'article et chacun des autres
   → calcul vectorisé NumPy : matrix @ vec_a (pas de boucle)
3. Seuil : cosinus ≥ 0.85 → article "similaire" (même sujet)
4. Compter les sources DISTINCTES parmi les similaires

Barème :
  0 source indépendante similaire  → 30 pts
  1 source indépendante similaire  → 55 pts
  2 sources indépendantes         → 75 pts
  3 sources indépendantes         → 90 pts
  4+ sources indépendantes        → 100 pts
```

Les paires (article, article similaire) sont persistées dans la table `corroborations` et affichées sur la page détail.

Si un article n'a pas d'embedding (publié il y a > 3 jours), la corroboration renvoie 30 pts (neutre — pas de pénalité).

---

#### score_fact_check — 20% du score final

Le LLM analyse jusqu'à 2000 chars de l'article et extrait 3 à 5 claims factuels :

```
Prompt :
"Analyze this article and extract 3-5 key factual claims.
Classify each as:
- 'supported'    : stated fact with explicit attribution, or widely established knowledge
- 'unsupported'  : assertion made without evidence or attribution
- 'unverifiable' : opinion, prediction, or speculation
Return ONLY valid JSON: {"claims": [{"text": "...", "status": "..."}]}"
```

Calcul du score :

```
claims_vérifiables = claims dont status ≠ 'unverifiable'
score = (nb 'supported' / nb vérifiables) × 100

Cas limites :
  aucun claim extrait        → 60 pts (neutre)
  tous les claims sont opinions → 65 pts
  minimum retourné           → 35 pts
```

Les claims sont stockés dans `fact_checks` (avec `verifiable` et `supporting_sources`) et affichés sur la page détail de l'article.

---

#### score_freshness — 10% du score final

Critères additifs, plafonnés à 100 :

```
Fraîcheur :
  publié il y a < 24h    → +40 pts
  publié il y a < 72h    → +25 pts
  publié il y a < 7 jours → +10 pts
  pas de date             →  +0 pts

Qualité éditoriale :
  auteur nommé            → +20 pts
  contenu > 500 chars     → +25 pts
  contenu > 100 chars     → +10 pts
```

---

### Exemple de calcul complet

Article : *"GPT-5 released with improved reasoning"* — source OpenAI Blog

```
score_source       = 90   (OpenAI = 95 reliability  → 90)
score_corroboration = 75  (DeepMind et Reuters couvrent aussi → 2 sources indépendantes → 75)
score_fact_check   = 80   (4 claims extraits, 3 supported, 1 unverifiable → 3/3 = 100... → 80 après calcul)
score_freshness    = 85   (< 24h = 40 + auteur = 20 + contenu long = 25 = 85)

confidence = 0.40×90 + 0.30×75 + 0.20×80 + 0.10×85
           = 36 + 22.5 + 16 + 8.5
           = 83.0  → badge vert "reliable"
```

---

### Seuil de fiabilité

```
confidence_score ≥ 70  →  badge vert  "reliable"   (source fiable + corroboré)
confidence_score < 70  →  badge jaune "verify"      (à lire avec recul)
pas encore scoré       →  badge gris  "pending"
```

Le seuil 70 est configurable via `RELIABILITY_THRESHOLD` dans `.env`.

---

## 3. Infrastructure

### Machines impliquées

| Machine | Rôle | Accès |
|---|---|---|
| Machine principale | Docker Compose (db + app + web) | localhost |
| LXC-AI (`192.168.1.121`) | Ollama — GPU AMD Radeon RX 7900 XTX 16 Gi VRAM | HTTP port 11434 |

### Ollama sur LXC-AI

```bash
# Vérifier les modèles disponibles
curl http://192.168.1.121:11434/api/tags

# Modèles nécessaires
ollama pull qwen3.5:9b          # ~6.6 Gi VRAM — LLM principal
ollama pull nomic-embed-text    # ~300 Mo VRAM — embeddings

# Configuration CRITIQUE : parallélisme
# Sans ça, Ollama traite 1 requête à la fois → pipeline 4× plus lent
systemctl edit ollama
# Ajouter dans [Service] :
# Environment="OLLAMA_NUM_PARALLEL=4"
systemctl daemon-reload && systemctl restart ollama
```

**Pourquoi OLLAMA_NUM_PARALLEL=4 ?**  
Les poids de qwen3.5:9b (~7.9 Gi) sont partagés entre les contextes parallèles. Seul le KV-cache est dupliqué (~150-200 Mo/slot). Avec 16 Gi VRAM et ~8 Gi pour les poids, 4 slots parallèles tiennent confortablement (~9.6 Gi total).

**Pourquoi `"think": false` dans les requêtes ?**  
qwen3.5:9b appartient à la famille Qwen3 qui active un bloc `<think>…</think>` (Chain-of-Thought) par défaut. Ces tokens ne sont pas retournés mais consomment tout le budget GPU : ~120s/article sans ce flag, ~4s avec. Toujours passer `"think": false` dans le payload Ollama.

### Port hôte

Le port 8000 est souvent déjà utilisé sur la machine hôte (autre uvicorn, etc.). Le docker-compose expose l'app sur **8001:8000** — nginx interne continue sur 8000, seul le port hôte change.

---

## 4. Structure du projet

```
veille-techno/
├── DEVLOG.md               Journal de développement session par session
├── RECONSTRUCTION.md       Ce document
└── veille-tracker/
    ├── docker-compose.yml  3 services : db · app · web (+ adminer en profil debug)
    ├── .env                Variables d'environnement (copier depuis .env.example)
    ├── .env.example        Template de configuration
    ├── db/
    │   └── init.sql        DDL complet + seed 19 sources
    └── app/
        ├── Dockerfile      python:3.12-slim + mysqlclient
        ├── requirements.txt
        ├── main.py         FastAPI + CORS + lifespan (reset articles bloqués)
        ├── config.py       Settings Pydantic depuis .env
        ├── database.py     SQLAlchemy engine + SessionLocal
        ├── models.py       ORM : 7 tables
        ├── schemas.py      Pydantic v2 I/O
        ├── confidence.py   Formule confiance 4 composantes + cache embeddings
        ├── ollama_client.py Wrapper HTTP Ollama (chat + embed + sérialisation vec)
        ├── scheduler.py    APScheduler cron + thread pipeline continu
        ├── pipeline_stats.py Stats temps réel (fenêtre glissante 60s)
        ├── collectors/
        │   ├── rss.py      Collecteur RSS générique (feedparser) — commit/50
        │   ├── arxiv.py    Collecteur arXiv (RSS API) — commit/50
        │   └── hackernews.py Collecteur HN Algolia API
        ├── workers/
        │   ├── enricher.py collecte → enrichi (résumé + tags) — avec claim lock
        │   ├── scorer.py   enrichi → score (confiance) — avec claim lock
        │   └── embed_missing.py embeddings pour articles sans vecteur
        └── routers/
            ├── articles.py  GET /articles · GET /articles/{id}
            ├── sources.py   CRUD sources + POST /sources/collect-all
            ├── blacklist.py CRUD blacklist
            └── stats.py     GET /stats · GET /stats/admin
    └── web/
        ├── Dockerfile      Build React → Nginx
        ├── nginx.conf      SPA + reverse proxy /api/ → app:8000
        └── src/
            ├── App.tsx
            ├── api.ts
            ├── types.ts
            ├── pages/
            │   ├── Feed.tsx          Liste paginée + filtres + bouton Collect
            │   ├── ArticleDetail.tsx  Détail + score + corroborations + fact-checks
            │   └── Admin.tsx          Pipeline monitor (barres temps réel + sources + logs)
            └── components/
                ├── ArticleCard.tsx
                ├── ConfidenceBadge.tsx
                └── ScoreBreakdown.tsx
```

---

## 5. Schéma de base de données

### Tables

```sql
-- Sources de collecte
sources (id, name, feed_url, type ENUM('rss','api'), reliability INT, active BOOL, last_collected)

-- Articles collectés
articles (
  id, source_id, url VARCHAR(1000) UNIQUE, title TEXT,
  content LONGTEXT, summary TEXT, author TEXT,   -- TEXT pas VARCHAR(300) ! (arXiv = liste d'auteurs longue)
  published_at, collected_at,
  confidence_score FLOAT,
  status ENUM('collecte','processing','enrichi','score')
  -- INDEX sur status et confidence_score
)

-- Tags extraits par le LLM
tags (id, name VARCHAR(100) UNIQUE)
articles_tags (article_id, tag_id)  -- pivot M:N

-- Vecteurs sémantiques pour corroboration
embeddings (
  article_id PK,
  vec_data LONGBLOB,    -- 768 floats × 4 bytes = 3072 bytes, sérialisé avec struct.pack
  model VARCHAR(100),
  dimensions INT
)

-- Paires d'articles similaires (cosinus ≥ 0.85)
corroborations (article_id PK, similar_article_id PK, similarity_score FLOAT)

-- Claims extraits par fact-check LLM
fact_checks (id, article_id, claim TEXT, verifiable BOOL, supporting_sources TEXT)

-- Historique des collectes
collect_logs (id, source_id, collected_at, articles_fetched INT, errors TEXT)
```

### Cycle de vie d'un article (statuts)

```
collecte → processing → enrichi → score
              ↑                      ↑
        (claim enricher)      (claim scorer — en mémoire seulement)
```

- `collecte` : inséré par le collecteur, pas encore traité
- `processing` : claimé par un thread enricher (écrit en DB pour survivre aux crashes)
- `enrichi` : résumé + tags générés, embedding calculé (si < 3 jours)
- `score` : indice de confiance calculé

**Reset au démarrage** (`main.py` lifespan) : les articles bloqués en `processing` à cause d'un crash sont remis en `collecte`.

---

## 6. Pipeline de traitement — implémentation

### Architecture du pipeline continu (`scheduler.py`)

Le pipeline ne tourne pas sur cron — c'est un **thread daemon** qui boucle en continu et ne dort que 15s si toutes les files sont vides.

```python
# 7 tâches simultanées à chaque cycle
pool = ThreadPoolExecutor(max_workers=7)
f_e1, f_e2, f_e3 = enrichers  # 3 × batch 25
f_s1, f_s2, f_s3 = scorers    # 3 × batch 25
f_em              = embedder   # 1 × batch 30

futures_wait([...])  # attend que TOUS finissent, puis repart
```

La collecte RSS/API tourne elle sur APScheduler : toutes les 30 min (RSS) et 2h (arXiv/API).

### Enricher (`workers/enricher.py`) — pattern claim atomique

**Problème initial :** 2+ threads qui font `SELECT ... WHERE status='collecte' LIMIT 25` simultanément prennent les mêmes articles (race condition).

**Solution : statut `processing` + `_claim_lock` Python**

```python
_claim_lock = threading.Lock()

# Étape 1 : claim atomique (< 5ms, lock tenu)
with _claim_lock:
    ids = SELECT id FROM articles WHERE status='collecte' LIMIT 25
    UPDATE articles SET status='processing' WHERE id IN (ids)
    COMMIT

# Étape 2 : traitement LLM (hors lock, lent)
for id in ids:
    résumé + tags via qwen3.5:9b
    status → 'enrichi'
    # si erreur → revert status → 'collecte'
```

**Optimisation skip embedding :** La corroboration utilise une fenêtre 72h. Un article publié il y a > 3 jours ne peut pas corroborer un article d'aujourd'hui → l'appel `nomic-embed-text` est skippé pour ces articles. Divise par 2 le nombre d'appels LLM pour le backlog initial.

### Scorer (`workers/scorer.py`) — claim en mémoire

**Même problème** que l'enricher, mais sans ajouter de statut DB (scoring est idempotent).

```python
_claim_lock = threading.Lock()
_claimed_ids: set[int] = set()

# Claim atomique (en mémoire)
with _claim_lock:
    ids = SELECT id FROM articles
          WHERE status='enrichi'
          AND id NOT IN (_claimed_ids)
          LIMIT 25
    _claimed_ids.update(ids)

# Traitement + libération dans finally
try:
    for id in ids:
        confidence_score = compute_confidence(article, db)
        status → 'score'
finally:
    _stats.adjust_scoring_active(-len(ids))
    with _claim_lock:
        _claimed_ids.difference_update(ids)
```

**Idempotence :** si le container crashe en plein scoring, les articles restent `enrichi` en DB. Au prochain redémarrage, `_claimed_ids` est vide → les articles sont repris. `score_fact_check` supprime les anciens `FactCheck` avant d'insérer.

### Embedder (`workers/embed_missing.py`)

Worker séparé qui génère les embeddings pour les articles `enrichi` ou `score` sans vecteur. Utilise `nomic-embed-text` (modèle léger ~300 Mo) — ne concurrence pas qwen3.5:9b sur les slots Ollama.

### Collecteurs — commit par tranches

**Problème :** Les collecteurs accumulaient tous les articles en session SQLAlchemy puis faisaient un seul `db.commit()` final. Avec 288 articles arXiv, la transaction durait plusieurs secondes. Les workers commitaient en parallèle → erreur MariaDB 1020 "Record has changed". Tout le batch échouait → 0 articles insérés.

**Solution :** commit toutes les 50 articles + `seen_urls` set pour déduplication intra-batch.

```python
_COMMIT_BATCH = 50
seen_urls: set[str] = set()

for entry in feed.entries:
    if url in seen_urls or already_in_db:
        continue
    db.add(article)
    seen_urls.add(url)
    pending += 1
    if pending >= _COMMIT_BATCH:
        db.commit()   # transaction courte, pas de conflit
        pending = 0
```

---

## 7. Modèles IA

| Modèle | VRAM | Rôle | Paramètre clé |
|---|---|---|---|
| `qwen3.5:9b` | ~7.9 Gi (KV-cache partagé) | Résumé · tags · fact-check | `"think": false` OBLIGATOIRE |
| `nomic-embed-text` | ~300 Mo | Vecteurs 768D pour corroboration | articles < 3 jours seulement |

**Pourquoi qwen3.5:9b et pas un modèle plus petit ?**  
Le fact-check demande une classification structurée (JSON avec claims et statuts) fiable. Les modèles plus petits (3b-4b) produisent du JSON malformé ou des classifications incorrectes trop souvent. qwen3.5:9b donne une qualité suffisante à ~4s/article avec think désactivé.

**Sérialisation des vecteurs :**  
`struct.pack(f"{len(vec)}f", *vec)` → LONGBLOB. Plus compact que JSON (4 bytes/float vs ~8 chars/float), lecture avec `struct.unpack`.

---

## 8. Configuration

### `.env`

```bash
# Database
DB_HOST=db
DB_PORT=3306
DB_NAME=veille
DB_USER=veille
DB_PASSWORD=changeme
DB_ROOT_PASSWORD=rootchangeme

# Ollama
OLLAMA_HOST=http://192.168.1.121:11434   # adresse IP de LXC-AI
OLLAMA_CHAT_MODEL=qwen3.5:9b
OLLAMA_EMBED_MODEL=nomic-embed-text

# Collecte (expressions cron)
RSS_COLLECT_INTERVAL=*/30 * * * *
ARXIV_COLLECT_INTERVAL=0 */2 * * *

# Scoring
CORROBORATION_WINDOW_HOURS=72
CORROBORATION_COSINE_THRESHOLD=0.85
RELIABILITY_THRESHOLD=70
```

### Ollama — `ollama_client.py`

```python
httpx.post(f"{OLLAMA_HOST}/api/chat", json={
    "model": "qwen3.5:9b",
    "stream": False,
    "think": False,          # CRITIQUE — désactive CoT Qwen3 (120s → 4s)
    "options": {
        "num_predict": 512,  # plafond tokens sortie — résumé+tags rentrent dans 512
    },
})
# timeout=60s, contexte d'entrée tronqué à 2000 chars
```

---

## 9. Sources configurées

| Source | URL | Type | Fiabilité |
|---|---|---|---|
| arXiv cs.AI | `export.arxiv.org/rss/cs.AI` | api | 95 |
| arXiv cs.CL | `export.arxiv.org/rss/cs.CL` | api | 95 |
| arXiv cs.LG | `export.arxiv.org/rss/cs.LG` | api | 95 |
| OpenAI Blog | `openai.com/blog/rss.xml` | rss | 90 |
| Google DeepMind | `deepmind.google/blog/rss.xml` | rss | 90 |
| Meta Engineering | `engineering.fb.com/feed/` | rss | 90 |
| Google AI Blog | `blog.google/technology/ai/rss/` | rss | 85 |
| Microsoft AI Blog | `blogs.microsoft.com/ai/feed/` | rss | 85 |
| Hugging Face Blog | `huggingface.co/blog/feed.xml` | rss | 85 |
| MIT Technology Review | `technologyreview.com/…/feed` | rss | 75 |
| Import AI Newsletter | `importai.substack.com/feed` | rss | 75 |
| AWS ML Blog | `aws.amazon.com/blogs/machine-learning/feed/` | rss | 70 |
| The Decoder | `the-decoder.com/feed/` | rss | 70 |
| Ars Technica AI | `feeds.arstechnica.com/…` | rss | 70 |
| GitHub Blog AI | `github.blog/tag/artificial-intelligence/feed/` | rss | 70 |
| Reddit r/MachineLearning | `reddit.com/r/MachineLearning/.rss` | api | 60 |
| Hacker News AI | `hn.algolia.com/api/v1/search_by_date` | api | 55 |
| Reddit r/LocalLLaMA | `reddit.com/r/LocalLLaMA/.rss` | api | 55 |
| Dev.to AI | `dev.to/feed/tag/ai` | rss | 50 |

**Remarques :**
- arXiv ne publie pas le week-end (samedi/dimanche = 0 articles, normal)
- arXiv les articles ont souvent 10-15 auteurs → colonne `author` doit être `TEXT`, pas `VARCHAR`
- Les URLs Anthropic/Meta AI/Mistral/Papers with Code n'ont pas de flux RSS valides — remplacés par des équivalents

---

## 10. API REST

Base URL : `http://localhost:8001` | Swagger : `http://localhost:8001/docs`

| Méthode | Route | Description |
|---|---|---|
| GET | `/articles` | Liste paginée avec filtres (`?source_id=`, `?min_score=`, `?tag=`, `?q=`) |
| GET | `/articles/{id}` | Détail article + tags + corroborations + fact-checks + score breakdown |
| GET | `/stats` | Stats globales (total, avg confidence, % reliable, collecté dernière heure) |
| GET | `/stats/admin` | Stats pipeline temps réel (taux, ETAs, sources, 30 derniers logs) |
| GET | `/sources` | Liste des sources |
| POST | `/sources` | Créer une source |
| PUT | `/sources/{id}` | Modifier une source |
| DELETE | `/sources/{id}` | Supprimer une source |
| POST | `/sources/{id}/collect` | Déclencher collecte immédiate d'une source |
| POST | `/sources/collect-all` | Déclencher collecte de toutes les sources actives |
| GET | `/blacklist` | Liste blacklist |
| POST | `/blacklist` | Ajouter un pattern |
| DELETE | `/blacklist/{id}` | Supprimer un pattern |

---

## 11. Frontend

React 19 + TypeScript, servi par Nginx qui proxifie `/api/` → `app:8000`.

| Page | Route | Contenu |
|---|---|---|
| Feed | `/` | Liste paginée · filtres source/score/tag · bouton Collect all · stats rapides · auto-refresh 15s |
| Article Detail | `/articles/:id` | Titre · résumé · tags · badge confiance · score breakdown par composante · corroborations · fact-checks |
| Admin | `/admin` | Pipeline monitor (barres progression temps réel · refresh 5s) · tableau 19 sources · historique 30 collectes |

**Composants clés :**
- `ConfidenceBadge` : vert "reliable" (≥70) / jaune "verify" (<70) / gris "pending" (pas encore scoré)
- `ScoreBreakdown` : 4 barres (source/corroboration/fact-check/freshness) avec poids affichés

---

## 12. Reconstruction pas-à-pas

### Prérequis

- Docker + Docker Compose installés
- Ollama sur une machine accessible en HTTP (ou localhost)
- Modèles `qwen3.5:9b` et `nomic-embed-text` téléchargés dans Ollama
- `OLLAMA_NUM_PARALLEL=4` configuré dans le service ollama

### Étapes

```bash
# 1. Cloner / récupérer le code
cd /root/veille-techno/veille-tracker

# 2. Créer le .env (adapter les valeurs)
cp .env.example .env
# Éditer .env : OLLAMA_HOST, mots de passe DB

# 3. Premier démarrage
docker compose up -d

# 4. Vérifier que la DB a bien chargé les seeds
docker compose exec db mariadb -uveille -pchangeme veille \
  -e "SELECT COUNT(*) FROM sources;"
# Doit retourner 19

# Si COUNT = 0 : le volume existait déjà (init.sql ne re-tourne pas)
# → Exécuter manuellement :
docker compose exec db mariadb -uveille -pchangeme veille < db/init.sql

# 5. Vérifier la connectivité Ollama
docker compose exec app curl http://192.168.1.121:11434/api/tags

# 6. Déclencher la première collecte
curl -X POST http://localhost:8001/sources/collect-all

# 7. Suivre le pipeline
open http://localhost:3000/admin
```

### Rebuild après modification du code

```bash
# App seule (Python)
docker compose up -d --build app

# App + frontend (React)
docker compose up -d --build app web

# Avec Adminer (debug DB)
docker compose --profile debug up -d
```

### Si le volume DB existe déjà (reset complet)

```bash
docker compose down -v          # supprime les volumes
docker compose up -d            # recrée tout proprement
```

---

## 13. Pièges connus et solutions

### `author` VARCHAR(300) insuffisant
**Symptôme :** arXiv affiche 0 articles après collecte, log : `Data too long for column 'author'`  
**Cause :** Les papiers arXiv ont souvent 10-15 auteurs (> 300 chars total)  
**Fix :** `author TEXT` dans `init.sql` et `models.py`. Déjà appliqué.

### Erreur 1020 "Record has changed" sur gros batch
**Symptôme :** collecteur retourne 0 articles, log : `OperationalError: (1020, "Record has changed")`  
**Cause :** Transaction longue (tout le batch en une fois) entre en conflit avec les commits des workers  
**Fix :** `_COMMIT_BATCH = 50` dans `rss.py` et `arxiv.py`. Déjà appliqué.

### `init.sql` ne se re-exécute pas
**Symptôme :** 0 sources après un redémarrage, alors que le fichier est correct  
**Cause :** MariaDB n'exécute `init.sql` qu'à la **création** d'un volume neuf. Si le volume existait déjà, le fichier est ignoré.  
**Fix :** Exécuter manuellement ou `docker compose down -v && docker compose up -d`.

### Port 8000 déjà utilisé
**Symptôme :** `failed to bind host port 0.0.0.0:8000/tcp`  
**Fix :** Le docker-compose utilise déjà `8001:8000`. Si 8001 est aussi pris, changer dans `docker-compose.yml`.

### `vector` mot réservé MariaDB 11.7+
**Symptôme :** `ERROR 1064 — syntax error near 'BLOB NOT NULL'`  
**Cause :** MariaDB 11.7 a introduit un type natif `VECTOR` → le nom de colonne est réservé  
**Fix :** La colonne s'appelle `vec_data` (déjà appliqué dans tout le code).

### Articles bloqués en `processing` après crash
**Symptôme :** Pipeline ne traite plus d'articles (tous bloqués en `processing`)  
**Cause :** Un crash en plein enrichissement laisse des articles avec `status='processing'`  
**Fix automatique :** Le lifespan `main.py` reset `processing` → `collecte` au démarrage. Si besoin manuel :
```sql
UPDATE articles SET status='collecte' WHERE status='processing';
```

### Mode thinking Qwen3 actif
**Symptôme :** ~2 min par requête LLM, timeouts 500  
**Cause :** `qwen3.5:9b` active par défaut un bloc `<think>…</think>` avant chaque réponse  
**Fix :** `"think": false` dans le payload Ollama (`ollama_client.py`). Déjà appliqué. **Ne jamais retirer ce flag.**

### arXiv 0 articles le week-end
**Comportement normal :** arXiv ne publie pas samedi/dimanche. Le RSS retourne un feed vide.  
Aucune action requise.

### Race condition scorers (3 threads sur les mêmes articles)
**Symptôme :** `scored/min` sous-optimal, GPU saturé mais peu d'articles progressent  
**Cause :** 3 threads scorer font `SELECT ... WHERE status='enrichi' LIMIT 25` simultanément → mêmes articles  
**Fix :** `_claim_lock` + `_claimed_ids` dans `workers/scorer.py`. Déjà appliqué.

---

## 14. Commandes utiles

```bash
# État du pipeline en temps réel
docker compose exec db mariadb -uveille -pchangeme veille \
  -e "SELECT status, COUNT(*) n FROM articles GROUP BY status ORDER BY FIELD(status,'collecte','processing','enrichi','score');"

# Stats pipeline via API
curl -s http://localhost:8001/stats/admin | python3 -m json.tool

# Logs app en live
docker compose logs -f app

# Collecte manuelle d'une source
curl http://localhost:8001/sources/1/collect

# Collecte toutes les sources
curl -X POST http://localhost:8001/sources/collect-all

# Vérifier connectivité Ollama depuis le container
docker compose exec app curl http://192.168.1.121:11434/api/tags

# Logs de collecte arXiv (dernières tentatives)
docker compose exec db mariadb -uveille -pchangeme veille \
  -e "SELECT s.name, cl.articles_fetched, cl.errors, cl.collected_at FROM collect_logs cl JOIN sources s ON s.id=cl.source_id WHERE s.name LIKE '%arXiv%' ORDER BY cl.collected_at DESC LIMIT 6;"

# Reset articles bloqués (si crash)
docker compose exec db mariadb -uveille -pchangeme veille \
  -e "UPDATE articles SET status='collecte' WHERE status='processing';"

# URLs d'accès
# Frontend    : http://localhost:3000
# API REST    : http://localhost:8001
# Swagger     : http://localhost:8001/docs
# Adminer     : http://localhost:8080  (avec --profile debug)
```

---

*Dernière mise à jour : juin 2026*
