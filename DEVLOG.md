# Veille Techno — Dev Log

**Projet :** AI/LLM Technology Watch System  
**Équipe :** Remi · Marcel  
**Rendu :** mi-fin juin 2026  
**Stack :** Python 3.12 · FastAPI · MariaDB 11 · React 19 · Ollama · Docker Compose

---

## Session 1 — Génération initiale du projet

### Ce qui a été créé (de zéro)

Le projet complet a été généré depuis le README.md en respectant l'ordre des modules M1→M9 :

```
veille-tracker/
├── docker-compose.yml        3 containers : db · app · web (+ adminer en profil debug)
├── .env.example              Variables d'environnement documentées
├── db/init.sql               DDL complet + seed 19 sources
├── app/
│   ├── main.py               FastAPI + CORS + lifespan
│   ├── config.py             Settings Pydantic depuis .env
│   ├── database.py           SQLAlchemy engine + SessionLocal
│   ├── models.py             ORM : Source · Article · Tag · Embedding · Corroboration · FactCheck · CollectLog
│   ├── schemas.py            Pydantic v2 schemas (in/out)
│   ├── confidence.py         Formule 4 composantes (40/30/20/10)
│   ├── ollama_client.py      Wrapper HTTP vers Ollama (chat + embed)
│   ├── scheduler.py          APScheduler cron + thread pipeline continu
│   ├── collectors/
│   │   ├── rss.py            Collecteur RSS générique (feedparser)
│   │   ├── arxiv.py          Collecteur arXiv (RSS API)
│   │   └── hackernews.py     Collecteur HN Algolia API
│   ├── workers/
│   │   ├── enricher.py       collecte → enrichi (résumé + tags + embedding)
│   │   └── scorer.py         enrichi → score (formule confiance)
│   └── routers/
│       ├── articles.py       GET /articles · GET /articles/{id}
│       ├── sources.py        CRUD sources + POST /sources/collect-all
│       ├── blacklist.py      CRUD blacklist
│       └── stats.py          GET /stats · GET /stats/admin
└── web/
    ├── Dockerfile            Build React → Nginx
    ├── nginx.conf            SPA + reverse proxy /api/ → app:8000
    └── src/
        ├── App.tsx           Router : Feed · ArticleDetail · Admin
        ├── api.ts            Fonctions fetch vers /api
        ├── types.ts          Types TypeScript partagés
        ├── pages/
        │   ├── Feed.tsx          Liste paginée + filtres + stats + bouton Collect
        │   ├── ArticleDetail.tsx Détail article + score + corroborations + fact-checks
        │   └── Admin.tsx         Pipeline monitor (barres de progression + sources + logs)
        └── components/
            ├── ArticleCard.tsx      Carte article avec badge confiance
            ├── ConfidenceBadge.tsx  Badge vert (reliable) / jaune (verify) / gris (pending)
            └── ScoreBreakdown.tsx   Barres de score par composante
```

---

## Session 2 — Corrections de déploiement

### Problème 1 : Port 8000 déjà utilisé
**Symptôme :** `failed to bind host port 0.0.0.0:8000/tcp: address already in use`  
**Cause :** Un process uvicorn tournait déjà en dehors de Docker.  
**Fix :** Port hôte changé de `8000` → `8001` dans `docker-compose.yml`.  
**URL API :** `http://localhost:8001` (nginx interne continue sur port 8000 sans changement)

### Problème 2 : `init.sql` n'a pas seedé les données
**Symptôme :** "Collection started for 0 sources"  
**Cause :** Le volume MariaDB existait déjà → `init.sql` ne s'exécute qu'à la création d'un volume neuf.  
**Fix :** Exécution manuelle via `docker compose exec db mariadb ...`

### Problème 3 : `vector` est un mot réservé dans MariaDB 11.7+
**Symptôme :** `ERROR 1064 — syntax error near 'BLOB NOT NULL'`  
**Cause :** MariaDB 11.7 a introduit un type natif `VECTOR` → le mot est devenu réservé.  
**Fix :**
- Colonne renommée `vector` → `vec_data` dans `db/init.sql`, `models.py`, `workers/enricher.py`, `confidence.py`
- Type changé `BLOB` → `LONGBLOB`

---

## Session 3 — Bouton "Collect all sources" dans le frontend

### Ajouts
- `POST /sources/collect-all` — déclenche la collecte de toutes les sources actives en background
- `Feed.tsx` — bouton **"Collect all sources"** avec état loading, message de confirmation, auto-refresh des articles toutes les 15s

---

## Session 4 — Page Admin + pipeline continu

### Problème : 20 articles toutes les 5 minutes insuffisant pour ~2000 articles
**Calcul :** 2000 articles × 36s/article ÷ 20 articles/batch × 5 min = ~20h

### Ajouts backend
- **Pipeline continu** (`scheduler.py`) : thread daemon qui relance immédiatement après chaque batch, ne dort que 15s si la file est vide (au lieu d'attendre le prochain job cron)
- **Batch size** : passé de 20 → 50 articles par cycle
- `GET /stats/admin` — endpoint riche avec : pipeline par statut, sources avec compteur d'articles, 30 derniers logs de collecte, throughput dernière heure

### Ajouts frontend
- **Page `/admin`** — Pipeline monitor avec :
  - 4 stats rapides (total, avg confidence, % reliable, articles collectés dernière heure)
  - 3 barres de progression temps réel (collecte · enrichi · score), refresh toutes les 5s
  - Tableau des 19 sources (reliability, articles, dernière collecte, statut)
  - Historique des 30 dernières collectes avec erreurs
- **Nav header** : lien Feed / Admin / API docs

---

## Session 5 — Optimisations pipeline (sans perte de qualité)

### Contexte
2034 articles en backlog, GPU à 94%, VRAM 7.96/15.92 Gi.

### Optimisation 1 — Skip embedding pour articles anciens
**Logique :** La corroboration utilise une fenêtre glissante de 72h. Un article publié il y a 1 semaine ne peut jamais corroborer un article d'aujourd'hui → calculer son embedding est inutile.  
**Implémentation :** Dans `enricher.py`, si `article.published_at` > 3 jours → skip l'appel `nomic-embed-text`.  
**Gain mesuré :** nomic-embed-text n'apparaît plus dans `radeontop` (modèle déchargé de VRAM), chaque article du backlog passe de 2 appels LLM à 1 seul.

### Optimisation 2 — Statut `processing` + 2 threads enrichers parallèles
**Problème :** 2 threads qui font `SELECT ... WHERE status='collecte' LIMIT 25` simultanément risquent de prendre les mêmes articles (race condition).  
**Fix :** Ajout d'un statut intermédiaire `processing` dans l'ENUM :
```sql
ALTER TABLE articles MODIFY status ENUM('collecte','processing','enrichi','score');
```
**Flow atomique :**
1. Thread acquiert `_claim_lock` (Python) → SELECT 25 articles → UPDATE status → `processing` → COMMIT → libère lock (< 5ms)
2. Thread traite ses 25 articles avec le LLM (hors lock)
3. Succès → status = `enrichi` ; Échec → revert → `collecte`

**2 threads en parallèle** via `ThreadPoolExecutor(max_workers=2)` dans le pipeline continu.  
**Résultat :** 50 articles claimés simultanément, Ollama reçoit 2 requêtes en parallèle.

### Optimisation 3 — OLLAMA_NUM_PARALLEL=2 (configuration LXC-AI)
**Principe :** Les poids du modèle (7.9 Gi) sont partagés entre les contextes parallèles. Seul le KV-cache est dupliqué (~200 Mo par slot supplémentaire). Avec 16 Gi VRAM et qwen3.5:9b à 7.9 Gi, on a ~8 Gi de marge → 2 contextes parallèles sont confortables.  
**Config :**
```bash
# Sur LXC-AI (root@CT130)
systemctl edit ollama
# [Service]
# Environment="OLLAMA_NUM_PARALLEL=2"
systemctl daemon-reload && systemctl restart ollama
```

### Reset au démarrage
Si le container app crash pendant le traitement, des articles restent bloqués en `processing`.  
**Fix :** Dans `main.py` lifespan, au démarrage : `UPDATE articles SET status='collecte' WHERE status='processing'`.

---

## Session 6 — Optimisations avancées du pipeline

### Problème : mode "thinking" de Qwen3 actif par défaut
**Symptôme :** ~2 minutes par requête LLM, 500 errors après timeout.  
**Cause :** `qwen3.5:9b` appartient à la famille Qwen3 qui active par défaut un bloc `<think>…</think>` (Chain-of-Thought) avant chaque réponse. Ces tokens CoT ne sont pas retournés au client mais consomment tout le budget GPU.  
**Fix :** Ajout de `"think": false` dans le payload de l'API Ollama (`ollama_client.py`).  
**Gain mesuré :** 120s → ~4s par article (**×30**).

### Optimisations complémentaires (`ollama_client.py`)
- `"num_predict": 512` — plafond de tokens en sortie (résumé + tags tiennent dans 512)
- Contexte d'entrée : 4000 → 2000 chars (RSS feeds et abstracts arXiv < 1500 chars)
- Timeout httpx : 120s → 60s (cohérent avec la nouvelle vitesse)

### Concurrent scorer
Le scorer attendait la fin des enrichers avant de démarrer. Changement : **4 tâches simultanées** via `ThreadPoolExecutor(max_workers=4)` :
- 3 threads enricher (collecte → enrichi)
- 1 thread scorer (enrichi → score)

Tous envoient des requêtes Ollama simultanément → la GPU reçoit 4 requêtes en parallèle.  
**Config LXC-AI :** `OLLAMA_NUM_PARALLEL=4` (KV cache par slot ~150-200 Mo, total ~8.8 Gi < 16 Gi).  
*(Le scorer a ensuite été passé à 3 threads en Session 8 — avec correction de la race condition associée.)*

### Métriques temps réel (`pipeline_stats.py`)
Nouveau module en mémoire avec fenêtre glissante 60s :
- `enriched_per_min` / `scored_per_min` — taux de traitement actuels
- `scoring_active` — articles en cours de scoring (in-memory, pas de statut DB supplémentaire)
- `eta_enrich_min` / `eta_score_min` — temps restant estimé

Exposés via `GET /stats/admin` et affichés dans la page Admin.

### Résultats mesurés (état final)

| Métrique | Avant toute optim | Session 6 | Gain total |
|---|---|---|---|
| Temps/article | ~120s (think mode) | ~3.75s | **×32** |
| GPU utilisation | 94% (1 req séquentielle) | **100%** (4 parallèles) | Saturé |
| Enrichissement | ~0.5 art/min | **16 art/min** | ×32 |
| Scoring | ~0.25 art/min | **8 art/min** | ×32 |
| ETA 2070 articles | ~70h | **~3.5h** | ×20 |
| VRAM utilisée | 7.96 Gi | 7.96 Gi | Inchangé |
| Power draw | 267W | 277W | +10W |

---

## Session 8 — 3 scorers parallèles (non documenté → race condition)

### Changement effectué (non documenté à l'époque)
Suite à la Session 6, le scorer a été passé de **1 → 3 threads** dans `scheduler.py` pour saturer davantage les slots Ollama :

```python
# scheduler.py — état après ce changement
f_s1 = pool.submit(run_scorer, _SCORER_BATCH)  # +2 threads scorer
f_s2 = pool.submit(run_scorer, _SCORER_BATCH)
f_s3 = pool.submit(run_scorer, _SCORER_BATCH)
# ThreadPoolExecutor(max_workers=7) — était 4
```

### Problème introduit : race condition sur le scorer
**Symptôme :** ~5.3 art/min observé au lieu des 8 attendus.  
**Cause :** Les 3 threads scorer font tous `SELECT ... WHERE status='enrichi' LIMIT 25` simultanément → ils récupèrent les **mêmes 25 articles**, font 3× le travail GPU pour 25 articles uniques scorés. Le pattern de claim (statut `processing`) protégeait l'enricher mais pas le scorer.

Le compteur `scoring_active` était aussi incohérent : `set_scoring_active(25)` s'écrasait entre threads, un thread terminé remettait le compteur à 0 même si les deux autres travaillaient encore.

---

## Session 9 — Correction race condition scorer + bugs collecteurs arXiv

### Fix 1 — Race condition scorer (`workers/scorer.py` + `pipeline_stats.py`)

**Pattern identique à l'enricher, sans migration DB :**
- `_claim_lock` (threading.Lock) tenu pendant quelques ms seulement
- `_claimed_ids: set[int]` — set en mémoire des articles en cours de scoring
- Chaque thread scorer exclut les IDs déjà claimés : `.filter(Article.id.notin_(_claimed_ids))`
- `finally` : libère toujours les IDs (même en cas d'exception) → articles restent `enrichi` en DB, repris proprement au prochain cycle
- **Aucune migration DB** : contrairement à l'enricher, pas de statut `scoring` ajouté. Si le container crashe en plein scoring, les articles restent `enrichi` et sont re-scorés (idempotent : `score_fact_check` supprime les anciens `FactCheck` avant d'insérer).

**`scoring_active` corrigé (`pipeline_stats.py`) :**
```python
def adjust_scoring_active(self, delta: int) -> None:
    with self._lock:
        self._scoring_active = max(0, self._scoring_active + delta)
```
Remplace `set_scoring_active(n)` dans le scorer → chaque thread incrémente au démarrage, décrémente à la fin. Résultat : `scoring_active: 75` (3 × 25 disjoints) au lieu d'une valeur incohérente.

### Fix 2 — Colonne `author` trop courte (`models.py` + `db/init.sql`)

**Symptôme :** arXiv cs.AI/CL/LG affichaient 0 articles malgré une collecte à 08h06.  
**Cause :** `(1406, "Data too long for column 'author'")` — les listes d'auteurs arXiv (parfois 10-15 chercheurs) dépassent `VARCHAR(300)`. L'erreur fait échouer **tout le batch** en un seul `db.commit()`.  
**Fix :**
```sql
ALTER TABLE articles MODIFY author TEXT;
```
`models.py` : `Column(String(300))` → `Column(Text)`. `init.sql` mis à jour pour cohérence.

### Fix 3 — Commit bulk → commit par tranches (`collectors/arxiv.py` + `collectors/rss.py`)

**Symptôme :** Après le fix author, arXiv cs.AI restait à 0 avec une nouvelle erreur :  
`(1020, "Record has changed since last read in table 'articles'; try restarting transaction")`  
**Cause :** Le collecteur accumulait **tous** les articles en session SQLAlchemy puis faisait un seul `db.commit()` final. Avec 288 articles arXiv, la transaction durait plusieurs secondes pendant lesquelles les workers (enricher/scorer) commitaient sur la même table → conflit InnoDB.  
**Fix :** Commit toutes les 50 articles + `seen_urls: set[str]` pour la déduplication intra-batch :

```python
_COMMIT_BATCH = 50

if pending >= _COMMIT_BATCH:
    db.commit()   # transaction courte, ne bloque pas les workers
    pending = 0
```

**Résultat après fix :** arXiv cs.AI : 234 articles · cs.CL : 135 · cs.LG : 191.

---

## Modèles IA utilisés

| Modèle | VRAM | Rôle | Où |
|---|---|---|---|
| `qwen3.5:9b` | 6.6 Gi | Résumé (3-4 phrases) + extraction tags (3-5 mots-clés) + fact-check (claims supported/unsupported/unverifiable) | `workers/enricher.py` · `confidence.py` |
| `nomic-embed-text` | ~300 Mo | Vecteur sémantique 768 dimensions → similarité cosinus pour corroboration | `workers/enricher.py` (articles < 3 jours seulement) |

---

## Formule de confiance (cœur intellectuel)

```
Score = 0.40 × score_source
      + 0.30 × score_corroboration
      + 0.20 × score_fact_check
      + 0.10 × score_freshness_coherence
```

| Composante | Poids | Calcul |
|---|---|---|
| Source | 40% | Fiabilité statique de la source (0-100), définie au seed |
| Corroboration | 30% | Nombre de sources **indépendantes** (`source_id` différent) couvrant le même sujet dans une fenêtre 72h, détecté par similarité cosinus ≥ 0.85 sur les embeddings |
| Fact-check | 20% | Ratio claims `supported` / total claims vérifiables, extrait par LLM |
| Freshness | 10% | Fraîcheur (< 24h = 40pts), auteur nommé (+20pts), longueur contenu (+25pts) |

**Seuil fiabilité :** ≥ 70/100 → badge vert "reliable" / < 70 → badge jaune "verify"

---

## Session 7 — Diagnostic et correction des sources à 0 articles

### Constat
6 sources de haute fiabilité (arXiv, Anthropic, Meta AI, Mistral, Papers with Code, GitHub Trending) affichaient 0 articles malgré leur score de confiance source élevé.

### Comment fonctionne la collecte ?
1. **Déclenchement** : APScheduler lance `_collect_all_rss()` toutes les 30 min et `_collect_all_api()` toutes les 2h (selon cron `.env`).
2. **Collecteur RSS** (`collectors/rss.py`) : feedparser parse le flux, filtre les URLs dans la blacklist, déduplique par URL (contrainte UNIQUE sur `articles.url`), insère avec `status='collecte'`.
3. **Pipeline continu** : 3 threads enrichers + 1 scorer traitent immédiatement les articles insérés.

### Diagnostic source par source

| Source | URL testée | Résultat | Cause |
|---|---|---|---|
| arXiv cs.AI/CL/LG | `export.arxiv.org/rss/cs.*` | 200 OK, 0 entrées | **Normal** — arXiv ne publie pas le week-end |
| Anthropic Blog | `anthropic.com/feed.rss` | **404** | Anthropic n'a pas de flux RSS public |
| Meta AI | `ai.meta.com/blog/feed/` | **404** | Le blog Meta AI n'offre pas de RSS |
| Mistral AI | `mistral.ai/feed.rss` | **404** | Même situation |
| Papers with Code | `paperswithcode.com/latest/rss` | 302 → HuggingFace trending (0 entrées) | Racheté par HF, le RSS redirige vers une page web non-RSS |
| GitHub Trending AI | `api.github.com/search/repositories?…` | JSON API (pas RSS) | Le collecteur RSS ne sait pas parser ce format |

### Solutions appliquées

Remplacement par des sources équivalentes disposant de flux RSS valides et actifs :

| Ancien nom | Nouveau nom | Nouvelle URL | Reliability |
|---|---|---|---|
| Anthropic Blog | **Google AI Blog** | `blog.google/technology/ai/rss/` | 85 |
| Meta AI | **Meta Engineering** | `engineering.fb.com/feed/` | 90 |
| Mistral AI | **Microsoft AI Blog** | `blogs.microsoft.com/ai/feed/` | 85 |
| Papers with Code | **AWS Machine Learning Blog** | `aws.amazon.com/blogs/machine-learning/feed/` | 70 |
| GitHub Trending AI | **GitHub Blog AI** | `github.blog/tag/artificial-intelligence/feed/` | 70 |

**Résultat après collecte immédiate :**
- Google AI Blog : 20 articles
- Meta Engineering : 9 articles
- Microsoft AI Blog : 10 articles
- AWS ML Blog : 20 articles
- GitHub Blog AI : 10 articles
- **Total : +69 articles de sources haut-de-gamme en quelques secondes**

### Corrections `init.sql`
- Statut ENUM mis à jour : `('collecte','processing','enrichi','score')` (le statut `processing` manquait)
- URLs des 5 sources corrigées pour correspondre à l'état réel de la DB

---

## 19 Sources configurées

| Source | Type | Fiabilité |
|---|---|---|
| arXiv cs.AI/CL/LG | API | 95 |
| OpenAI Blog · Google DeepMind · Meta Engineering | RSS | 90 |
| Google AI Blog · Microsoft AI Blog · Hugging Face Blog | RSS | 85 |
| MIT Tech Review · Import AI | RSS | 75 |
| AWS ML Blog · The Decoder · Ars Technica AI · GitHub Blog AI | RSS | 70 |
| Reddit r/MachineLearning | API | 60 |
| Hacker News AI | API (Algolia) | 55 |
| Reddit r/LocalLLaMA | API | 55 |
| Dev.to AI | RSS | 50 |

---

## URLs

| Service | URL |
|---|---|
| Frontend (Feed + Admin) | `http://localhost:3000` |
| API REST | `http://localhost:8001` |
| API Swagger (admin) | `http://localhost:8001/docs` |
| Adminer (DB UI, profil debug) | `http://localhost:8080` |

```bash
# Lancer avec Adminer
docker compose --profile debug up -d
```

---

## Commandes utiles

```bash
# État du pipeline en temps réel
docker compose exec db mariadb -uveille -pchangeme veille \
  -e "SELECT status, COUNT(*) n FROM articles GROUP BY status;"

# Logs de l'app
docker compose logs -f app

# Rebuild après modif code
docker compose up -d --build app
docker compose up -d --build app web   # si modif frontend aussi

# Vérifier connectivité Ollama depuis le container
docker compose exec app curl http://192.168.1.121:11434/api/tags

# Collecte manuelle d'une source (ex: source id=1)
curl http://localhost:8001/sources/1/collect

# Collecte toutes les sources
curl -X POST http://localhost:8001/sources/collect-all
```

---

---

## Session 10 — Score breakdown + tris Feed

### Fix 1 — Score breakdown par composante (`confidence.py` · `schemas.py` · `routers/articles.py` · frontend)

**Symptôme :** La section "Confidence score" sur la page détail affichait 4 jauges vides avec le message "Breakdown per component not stored separately".  
**Cause :** `ArticleDetail.tsx` appelait `<ScoreBreakdown sourceReliability={0} />` — toutes les props hardcodées.

**Fix — calcul à la volée sans migration DB :**  
Les données nécessaires sont déjà en base (`fact_checks`, `corroborations`, `source.reliability`, dates) → 2 fonctions ajoutées dans `confidence.py` qui reconstituent les scores sans appel LLM :

- `score_corroboration_from_stored(article)` — compte `article.corroborations_as_main`
- `score_fact_check_from_stored(article)` — relit `article.fact_checks`

`GET /articles/{id}` calcule et retourne `score_breakdown: { source, corroboration, fact_check, freshness }` si `status='score'`. Frontend consomme les 4 valeurs dans `ScoreBreakdown`.

**Vérification :** article id=1 → `{ source: 90, corroboration: 30, fact_check: 100, freshness: 20 }` → `0.40×90 + 0.30×30 + 0.20×100 + 0.10×20 = 67.0` ✓

---

### Fix 2 — Options de tri Feed (`routers/articles.py` · `Feed.tsx`)

**Ajout :** params `sort_by` + `sort_dir` sur `GET /articles`.

**Options disponibles :**

| Option UI | sort_by | sort_dir | Notes |
|---|---|---|---|
| Newest collected | `collected_at` | desc | Défaut |
| Best score ↓ | `confidence_score` | desc | NULLs naturellement en dernier (MariaDB DESC) |
| Lowest score ↑ | `confidence_score` | asc | NULLs en dernier via `ISNULL(col)` |
| Top sources | `source_reliability` | desc | JOIN sur `sources` |
| Most corroborated | `corroborations` | desc | LEFT JOIN + GROUP BY + COUNT |

**Pourquoi pas "Latest published" ?**  
274/~440 articles scorés ont `DATEDIFF(collected_at, published_at) = 0` → tri identique à "Newest collected" en pratique. Remplacé par **"Most corroborated"** qui remonte les articles confirmés par le plus de sources indépendantes — résultats visuellement distincts et utiles pour la veille.

**Piège MariaDB :** `NULLS LAST` (syntaxe SQL standard) non supporté par MariaDB. Workaround : `ORDER BY ISNULL(col) ASC, col ASC` pour les colonnes nullables en tri ASC.

---

## Session 11 — Supervision exhaustive du pipeline et monitoring DB

### Motivation

L'Admin existant montrait les barres de progression et les logs de collecte — suffisant pour savoir que le pipeline tourne, mais insuffisant pour diagnostiquer la qualité du traitement, repérer des erreurs silencieuses, ou comprendre l'état de la base de données.

Ajouts demandés :
- Suivi des erreurs d'enrichissement et de scoring (jusqu'ici invisibles)
- Historique de débit pour visualiser les tendances (sparklines)
- Distribution des scores pour évaluer la qualité globale
- Couverture corroboration et fact-check
- Top tags pour visualiser les thèmes collectés
- Monitoring de la DB (tailles de tables, estimations de lignes)
- Progression par source (combien d'articles scorés vs total)
- Compteur d'erreurs de collecte sur 24h + bannière d'alerte
- Articles collectés aujourd'hui / cette semaine

### Changements backend

**`pipeline_stats.py`** — 3 ajouts :
1. `_enrich_errors`, `_score_errors` deques — mêmes sliding windows 60s que les métriques normales
2. `record_enrich_error()`, `record_score_error()` — appelés depuis les workers sur exception
3. `_history` deque (maxlen=12) — snapshot toutes les 30s dans `snapshot()` → 6 min d'historique pour les sparklines

**`workers/enricher.py`** + **`workers/scorer.py`** — `_stats.record_enrich_error()` / `record_score_error()` dans les blocs `except Exception` existants.

**`routers/stats.py`** — refonte majeure :

Nouveaux champs dans `AdminStatsOut` :
- `score_distribution` — 5 buckets (0-20, 20-40, 40-60, 60-80, 80-100) en un seul scan SQL (`SUM(CASE WHEN ...)`)
- `articles_today`, `articles_week` — combinés dans la même requête pour éviter 2 round-trips supplémentaires
- `corroboration_coverage`, `fact_check_coverage` — `COUNT(DISTINCT article_id)` sur les tables `corroborations` et `fact_checks`, rapporté aux articles scorés
- `top_tags` — `JOIN articles_tags GROUP BY ORDER BY cnt DESC LIMIT 10` en SQL brut (table d'association non importable proprement depuis models.py)
- `enrich_errors_per_min`, `score_errors_per_min`, `rate_history` — depuis `_stats.snapshot()`
- `error_count_24h` — `CollectLog.errors IS NOT NULL AND collected_at >= NOW() - 24h`
- `pipeline: dict[str, int]` dans `SourceAdminOut` — breakdown par statut par source (GROUP BY source_id, status)

Nouvel endpoint `GET /stats/db` :
- Requête sur `information_schema.TABLES` pour obtenir TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH par table
- Endpoint séparé (ne fait pas partie du polling 5s) car `information_schema` peut être lent

### Changements frontend

**`types.ts`** — ajout `TagCount`, `RatePoint`, `TableStat`, `DbStats`, `pipeline` dans `SourceAdmin`, nouveaux champs dans `AdminStats`.

**`api.ts`** — ajout `fetchDbStats()`.

**`Admin.tsx`** — refonte complète :

| Section | Nouveau |
|---|---|
| Bannière erreurs | S'affiche si `error_count_24h > 0` (rouge, avec message) |
| Stat cards | 6 cartes (Total, Aujourd'hui, 7 jours, Avg score, Reliable%, Dernière heure) |
| Pipeline progress | Sparklines SVG inline (pas de dépendance externe), taux d'erreur en rouge si > 0, compteurs par statut |
| Score distribution | 5 barres horizontales colorées (rouge→vert), avec % et count |
| Qualité | Couverture corroboration, fact-check, top 10 tags |
| Progression par source | Mini barre scored/total dans le tableau sources, count "+N pending" |
| DB overview | Tableau tables/lignes/data/index (30s refresh), disclaimer InnoDB estimates |
| Recent collections | Lignes avec erreur surlignées en rouge-950 |

**Sparkline implementation** : composant `<Sparkline>` SVG inline (polyline), normalisé sur le max de la série, padding 2px, maxlen 12 points. Aucune bibliothèque graphique ajoutée.

### Données observées (vérification)

```
score_distribution: {'0-20': 0, '20-40': 1, '40-60': 959, '60-80': 1960, '80-100': 5}
corroboration_coverage: 3.1%   # faible → peu de doublons entre sources
fact_check_coverage: 92.8%     # bon → le scorer enrichit bien les claims
top_tags: openai (292), machine learning (235), artificial intelligence (209)...
DB: 30.7 MB total — embeddings 15.5 MB (dominant), articles 10.8 MB
error_count_24h: 11            # ≥1 erreur de collecte récente visible dans la bannière
```

---

## Session 12 — Recherche articles + visibilité des erreurs de collecte

### Recherche articles (Feed)

**Problème :** aucun moyen de trouver un article par son contenu — uniquement filtrage par source et score.

**Solution :** paramètre `search` sur `GET /articles`, recherche `ILIKE` sur `title`, `summary`, et `tags.name` via `Article.tags.any(Tag.name.ilike(...))` (génère un EXISTS sous-query compatible MariaDB).

`routers/articles.py` :
```python
if search:
    pattern = f"%{search}%"
    q = q.filter(or_(
        Article.title.ilike(pattern),
        Article.summary.ilike(pattern),
        Article.tags.any(Tag.name.ilike(pattern)),
    ))
```

`Feed.tsx` :
- Barre de recherche pleine largeur au-dessus des filtres, avec icône 🔍 et bouton × pour effacer
- Debounce 350ms via `useEffect` + `clearTimeout` (évite une requête par frappe)
- État séparé `searchInput` (valeur brute) / `search` (valeur envoyée après debounce)
- Message "N results for 'query'" affiché sous la barre (ou "No results")
- "Clear filters" intègre maintenant la recherche

### Visibilité des erreurs de collecte

**Problème :** le compteur `error_count_24h = 11` s'affichait mais aucune erreur n'était visible dans "Recent collections". Cause : la fenêtre `LIMIT 30` des logs récents ne couvre que ~1-2 runs (19 sources), les erreurs étaient repoussées hors fenêtre.

**Solution :** requête dédiée pour les erreurs — `error_logs` dans `AdminStatsOut` (indépendant de `recent_logs`) :
```python
error_rows = db.query(CollectLog, Source.name)
    .join(Source)
    .filter(CollectLog.collected_at >= day_ago)
    .filter(CollectLog.errors.isnot(None))
    .order_by(CollectLog.collected_at.desc())
    .limit(50)
```

`Admin.tsx` : la bannière rouge devient un `<details open>` expansible/repliable, montrant chaque erreur avec :
- Source concernée + timestamp
- Message d'erreur complet en `<pre>` monospace (pas de troncature)

**Contenu des 11 erreurs observées :**
- 9× `(1020) Record has changed since last read in table 'articles'` (erreur batch commit arXiv — déjà fixée en Session 9, ces entrées sont des logs historiques de l'ancien comportement)
- 2× `(1406) Data too long for column 'author'` (erreur VARCHAR arXiv — déjà fixée en Session 9)

Ces erreurs persistent dans les logs mais ne se reproduiront plus grâce aux corrections de Session 9.

---

## Session 13 — Gestion des sources + HN par query + refacto collecteurs

### Gestion des sources (Admin UI)

Interface complète de gestion des sources dans l'Admin :
- **Ajout** — modal avec formulaire : name, feed_url, type (rss/api), reliability (slider), auto-détection du type depuis l'URL
- **Édition** — même modal pré-rempli, modifiable : name, feed_url, type, reliability, toggle actif/inactif
- **Suppression** — cascade complète en DB (corroborations → fact_checks → embeddings → articles_tags → articles → collect_logs → source), confirmation inline avec avertissement si articles existants
- **Collect now** par source — bouton ▶ par ligne
- **Toggle actif/inactif** — bouton ●/○ inline sans modal

`SourcePatch` étendu : accepte maintenant `name`, `feed_url`, `type` en plus de `reliability`/`active`.

`DELETE /sources/{id}?hard=true` — vraie suppression en cascade via SQL brut (ordre FK respecté), soft-delete par défaut.

`SourceAdminOut` — ajout de `feed_url` et `type` pour le formulaire d'édition.

### Collecteur HN paramétrable

**Problème :** le collecteur HN ignorait `source.feed_url` et utilisait toujours sa propre requête hardcodée (`"LLM AI machine learning"`). Les sources HN Anthropic et Mistral collectaient donc 0 articles.

**Fix :** le collecteur lit maintenant les query params depuis `source.feed_url` via `urllib.parse` :
- URL sans paramètres → comportement inchangé (query + filtre keywords)
- URL avec `?query=anthropic` → utilise la query, supprime le filtre keywords (déjà ciblé)

**Doublon detectable :** les sources HN ciblées partageaient des URLs avec le HN générique → erreur 1062 `IntegrityError` au commit en bulk. Résolu par le refacto `ArticleBatchInserter` (voir ci-dessous).

### Refacto collecteurs — `ArticleBatchInserter`

**Problème structurel :** le pattern "commit par batch + seen_urls" était copié-collé dans les 3 collecteurs (rss.py, arxiv.py, hackernews.py). Tout nouveau collecteur pouvait oublier ce patch et reproduire le bug.

**Solution :** extraction dans `collectors/utils.py` → classe `ArticleBatchInserter` :

```python
inserter = ArticleBatchInserter(db, batch_size=50)
inserter.add(article)   # skip si URL déjà vue ou en DB
inserter.finish()       # flush le dernier batch
log = CollectLog(articles_fetched=inserter.count, errors=inserter.error_str)
```

Comportement garanti par la classe :
1. Dédup intra-batch via `_seen: set[str]`
2. Vérification DB via `SELECT` avant chaque `db.add()`
3. Commit toutes les `batch_size` lignes (défaut 50)
4. Sur `IntegrityError` : rollback du mini-batch, erreur enregistrée, continue
5. `count` incrémenté uniquement après commit réussi

Les 3 collecteurs ont été simplifiés — chacun fait maintenant ≈ 30 lignes au lieu de 60+.

**Impact :** tout futur collecteur utilise `ArticleBatchInserter` et hérite automatiquement du comportement sûr.

### Vérification des RSS des gros labs IA

Résultat des vérifications :
- **Anthropic** — pas de flux RSS (404 sur toutes les variantes testées)
- **Mistral** — pas de flux RSS
- **Meta AI Blog** — pas de flux RSS
- **Apple ML Research** — pas de flux RSS

Sources RSS vérifiées et fonctionnelles à ajouter :

| Source | URL | Reliability |
|---|---|---|
| Google Research Blog | `https://research.google/blog/rss/` | 90 |
| NVIDIA Developer Blog | `https://developer.nvidia.com/blog/feed/` | 82 |
| Microsoft On the Issues | `https://blogs.microsoft.com/on-the-issues/feed/` | 75 |

Pour Anthropic et Mistral : sources HN ciblées (`?query=anthropic`, `?query=mistral+AI`) fonctionnant après les deux fixes ci-dessus.

---

## Session 14 — Qualité & fiabilité des données

**Objectifs :** améliorer la valeur des données produites par le pipeline (fact-check plus robuste, tags cohérents, déduplication sémantique, filtre par tags côté feed).

### Nouveau checkpoint Git

Dépôt git initialisé à la racine `/root/veille-techno`. Premier commit `edd506e` couvre les sessions 1–13. Chaque session est désormais commitée comme checkpoint de rollback.

```
git log --oneline
0477b5c feat: data quality improvements (session 14)
edd506e chore: initial commit — veille-techno v1.0 (sessions 1-13)
```

---

### 1. Dual LLM Fact-checking — qwen3.5:9b + gemma4:e4b

**Problème :** le fact-check était réalisé par un seul modèle local (qwen3.5:9b). Il n'a pas accès à Internet et peut halluciner. Son verdict n'a aucune contre-vérification.

**Solution :** exécuter deux modèles en séquence sur le même article, puis fusionner leurs verdicts.

**Modèles choisis :**
- `qwen3.5:9b` — modèle primaire (déjà utilisé pour l'enrichissement), base de connaissance solide
- `gemma4:e4b` — modèle secondaire, base de connaissance plus récente (Google), 9.6 GB en VRAM

Les deux tiennent en VRAM simultanément sur le LXC-AI (total ~16 GB).

**Config :**
```bash
OLLAMA_FACTCHECK_MODEL=gemma4:e4b  # ajouté dans .env et config.py
```

**Logique de fusion (par claim) :**

| qwen3.5 | gemma4 | Consensus | Crédit scoring |
|---------|--------|-----------|----------------|
| supported | supported | supported | 100% |
| unsupported | unsupported | unsupported | 0% |
| unverifiable | quoi que ce soit | unverifiable | exclu du pool |
| supported | unsupported | **contested** | **50%** |
| unsupported | supported | **contested** | **50%** |

Le statut `"contested"` est un nouveau statut intermédiaire : les deux modèles ne sont pas d'accord sur un claim. C'est plus honnête que trancher arbitrairement d'un côté.

**Stockage :**
```sql
-- Colonnes ajoutées à fact_checks
fact_check_models  VARCHAR(200)  -- ex : "qwen3.5:9b|gemma4:e4b"
secondary_status   VARCHAR(20)   -- verdict brut du modèle B (pour transparence)
-- supporting_sources = consensus : supported | unsupported | unverifiable | contested
```

**Fichiers modifiés :**
- `ollama_client.py` : `chat_with_model(prompt, model)` — routing explicite du modèle
- `confidence.py` : `_run_factcheck_model()`, `_merge_factcheck_claims()`, `score_fact_check()` refactorisé
- `config.py`, `.env` : `OLLAMA_FACTCHECK_MODEL`
- `models.py` : colonnes `fact_check_models`, `secondary_status` sur `FactCheck`

---

### 2. Normalisation des tags

**Problème :** le LLM générait des variantes inconsistantes — `"llms"`, `"large language model"`, `"large language models"`, `"LLM"` → 4 tags différents pour la même notion. Les filtres par tag étaient inutiles.

**Solution :** `app/tag_normalizer.py` — appliqué à chaque tag avant insertion.

**Règles :**
1. Lowercase + trim
2. Suppression de la ponctuation non-significative (sauf tiret)
3. Mapping synonymes (~60 entrées) : `"large language models"` → `"llm"`, `"artificial intelligence"` → `"ai"`, `"reinforcement learning"` → `"rl"`, `"fine_tuning"` → `"fine-tuning"`, etc.
4. Rejet des stopwords : `"the"`, `"new"`, `"research"`, `"article"`, etc.
5. Rejet des tags trop courts (< 2 chars) ou purement numériques

**Migration des tags existants :**
- Script `scripts/normalize_existing_tags.py`
- Utilise pymysql direct avec `autocommit=True` pour éviter les conflits de lock avec le pipeline en cours
- **Résultat :** 8 463 tags → 231 renommés, 116 fusionnés, 7 supprimés, 0 erreurs
- Avant : `"artificial intelligence"` (275) + `"ai"` (107) séparés → après : `"ai"` (388)
- Avant : `"large language models"` (200) seul → après : `"llm"` (309) avec tous les variants fusionnés

**Fichiers :**
- `app/tag_normalizer.py` (nouveau)
- `app/workers/enricher.py` : utilise `normalize_tag_list()` avant insertion
- `app/scripts/normalize_existing_tags.py` (nouveau)

---

### 3. Déduplication sémantique dans le feed

**Problème :** quand 4 sources couvrent le même événement, le feed affiche 4 articles quasi-identiques. Bruit pour l'utilisateur.

**Solution :** système de clustering basé sur les corroborations existantes.

**Schéma :**
```sql
ALTER TABLE articles
  ADD COLUMN canonical_id INT DEFAULT NULL,     -- NULL = article canonique du cluster
  ADD COLUMN cluster_size INT NOT NULL DEFAULT 1; -- nb d'articles similaires (pour canonique)
```

**Worker `workers/cluster.py` (nouveau) :**
- Trouve les articles `status='score'` qui ont des corroborations et `cluster_size = 1`
- Pour chaque article : collecte tous les IDs du cluster (graphe à profondeur 2)
- Élit le canonique : article avec le meilleur `confidence_score`
- Met à jour : non-canoniques → `canonical_id = canonical.id`, canonique → `cluster_size = N`
- Ajouté au scheduler dans le loop du pipeline continu

**Feed API :**
- `GET /articles?deduplicate=true` (défaut) → ne montre que les canoniques (`canonical_id IS NULL`)
- `GET /articles?deduplicate=false` → tout afficher (utile pour debug)

**Frontend :**
- `ArticleCard` : badge `"N similar"` avec icône lien quand `cluster_size > 1`
- Checkbox "Show duplicates" dans les filtres du Feed

---

### 4. Filtre multi-tags chips dans le Feed

**Problème :** la seule façon de filtrer par contenu était la barre de recherche (full-text). Pas de navigation thématique rapide.

**Solution :** rangée de chips cliquables au-dessus des filtres, multi-sélection en OR.

**Nouveau endpoint :**
```
GET /articles/tags/popular?limit=25
→ [{"name": "llm", "count": 309}, {"name": "ai", "count": 388}, ...]
```

**Frontend Feed.tsx :**
- Chips affichés dynamiquement depuis l'endpoint
- Clic → toggle dans `activeTags[]`
- Chip actif = fond indigo, inactif = gris
- Passe `?tags=llm&tags=transformer` à l'API (OR : article doit avoir AU MOINS un des tags)
- Compatible avec search + sort + source filter + dédup
- "Clear filters" réinitialise aussi les tags actifs

---

### Proposition : recalibrage automatique de la reliability (non encore implémenté)

À valider avant implémentation. Voici le mécanisme proposé :

**Principe :** la `reliability` d'une source est fixée manuellement à l'ajout et ne change jamais. Elle devrait évoluer en fonction de la qualité observée des articles de cette source.

**Formule proposée :**

```python
# Pour chaque source, calculer la "qualité observée" sur les 30 derniers jours
# Utiliser uniquement les composantes INDÉPENDANTES de la reliability
# (évite la circularité : reliability → confidence_score → recalibrage → reliability)
observed_quality = avg_over_scored_articles(
    0.6 * corroboration_score_component +   # vérifié par d'autres sources
    0.4 * fact_check_score_component         # vérifié par les LLMs
)

# EMA (exponential moving average) — changement lent
new_reliability = round(old_reliability * 0.80 + observed_quality * 0.20)

# Garde-fous
new_reliability = max(10, min(95, new_reliability))   # plafond/plancher
delta = new_reliability - old_reliability
if abs(delta) > 8:                                     # max ±8 par run
    new_reliability = old_reliability + (8 if delta > 0 else -8)
```

**Conditions de déclenchement :**
- Cron hebdo (lundi 3h00)
- Minimum 10 articles scorés dans les 30 derniers jours (en dessous : pas assez de données)

**Traçabilité :** nouvelle table `source_calibrations(id, source_id, calibrated_at, old_reliability, new_reliability, article_count, avg_corr, avg_fact)`.

**Risque :** une source fiable qui publie un pic d'articles sensationnalistes ponctuellement pourrait être pénalisée. Le coefficient 0.80/0.20 (EMA lente) et le cap ±8 limitent cet effet.

→ **Valide ce mécanisme avant qu'on l'implémente.**

---

## Session 14 (suite) — Hotfix dual LLM + page Documentation

### Bugfix dual LLM — deux régressions bloquantes

Après déploiement de session 14, le scoring était en erreur à 100% (1472 err/min observés dans l'Admin).

#### Bug 1 — KeyError dans le prompt fact-check (bloquant)

**Cause :** le template de prompt contenait des accolades JSON littérales `{"claims": [...]}` et était formaté avec `.format(title=..., text=...)`. Python interprétait `"claims"` comme une clé de formatage → `KeyError: '"claims"'`. Cette ligne était hors du `try/except` → l'exception remontait jusqu'au scorer qui l'enregistrait comme score_error.

```python
# ❌ AVANT
_FACTCHECK_PROMPT_TEMPLATE = (
    '{"claims": [{"text": "...", "status": "..."}]}\n\n'  # accolades interprétées
    "Title: {title}\nContent: {text}"
)
prompt = _FACTCHECK_PROMPT_TEMPLATE.format(title=title, text=text)  # hors du try

# ✅ APRÈS — concaténation simple, construction dans le try
prompt = (
    '...Return ONLY valid JSON: {"claims": [{"text": "...", "status": "..."}]}'
    "\n\nTitle: " + article_title + "\nContent: " + article_text
)
```

#### Bug 2 — Modèle secondaire hors capacité VRAM (bloquant si modèle chargé)

**Cause :** `gemma4:e4b` (9.6 GB sur disque) ne tient pas en VRAM en même temps que `qwen3.5:9b` (7.9 GB VRAM). Total disponible : 15.9 GB, besoin minimum estimé : 17.5+ GB.

**Note AMD ROCm :** sur architecture ROCm (AMD), les modèles quantisés sont dequantisés en FP16 au chargement. Cela explique le ratio disk→VRAM observé : `llama3.2:3b` (2 GB disque → 5.1 GB VRAM, ratio 2.5×). Sous CUDA/NVIDIA, les modèles Q4 s'exécutent directement en Q4.

**Budget VRAM réel :**
| Modèle | VRAM mesurée |
|---|---|
| qwen3.5:9b | 7 933 MiB |
| llama3.2:3b | 5 109 MiB |
| nomic-embed-text | 722 MiB |
| **Total** | **13 764 MiB / 15 922 MiB (86%)** |

**Fix :** remplacement de `gemma4:e4b` par `llama3.2:3b` (2 GB disque, 5.1 GB VRAM) comme LLM secondaire de fact-check.

**Choix justifié :** llama3.2:3b est issu de la famille Llama/Meta — base d'entraînement différente de qwen3.5:9b (Qwen/Alibaba). L'intérêt du double LLM est précisément d'avoir deux perspectives indépendantes. Un modèle plus grand (gemma4) serait préférable mais n'est pas faisable dans ce budget VRAM.

**Résultat après fix :** score_errors/min = 0, scoring reprend normalement.

**Git :** commit `fee0da1`

---

### Architecture dual LLM — précision sur le mécanisme de comparaison

#### Rôle de chaque modèle

- **qwen3.5:9b** : enrichissement (résumé + tags) **ET** fact-check primaire. Un seul modèle, deux usages.
- **llama3.2:3b** : fact-check secondaire uniquement. **1 seul LLM secondaire**, pas deux.

#### Comparaison positionnelle — heuristique, pas de matching sémantique

Les deux modèles reçoivent le même prompt et produisent chacun une liste de claims. La fusion se fait par index positionnel (claim[0] de qwen vs claim[0] de llama) :

```
Article sur GPT-5 :

qwen3.5 :                              llama3.2 :
  [0] "GPT-5 scores 92% on MMLU"        [0] "GPT-5 achieves 92% on MMLU"
      → supported                            → supported
  [1] "Surpasses human experts"         [1] "Beats human performance"
      → unsupported                          → contested
  [2] "Published by OpenAI"             [2] "OpenAI claims superiority"
      → supported                            → unsupported

Fusion :
  [0] supported + supported  → supported  (accord)
  [1] unsupported + contested → contested  (désaccord → crédit 50%)
  [2] supported + unsupported → contested  (désaccord → crédit 50%)
```

**Limite connue :** si les deux modèles extraient des claims différents dans des ordres différents, la comparaison positionnelle est incohérente. La solution correcte serait un matching sémantique par embeddings des claims, mais le coût est prohibitif pour le volume de traitement actuel.

**Valeur réelle du double LLM malgré la limite :**
1. **Fallback robuste** — si un modèle échoue (timeout réseau, erreur), l'autre prend le relais sans bloquer le pipeline.
2. **Biais croisés** — l'accord de deux modèles de familles distinctes est un signal plus fort qu'un verdict unique.
3. **Partial credit** — le statut `contested` (désaccord) donne un crédit intermédiaire (50%) plutôt qu'un verdict binaire.

**Axes d'amélioration future :** matching sémantique des claims entre les deux modèles avant fusion ; ou utiliser un modèle plus grand (gemma4:e4b) si VRAM augmentée.

---

## Session 15 — Page de documentation interne

### Contexte

Le bouton "API docs" dans l'en-tête du site pointait vers `/docs` (Swagger FastAPI automatique). Ce n'est pas suffisant pour comprendre la logique métier du système (formule de score, pipeline, dual LLM, etc.).

### Ce qui a été créé

**`web/src/pages/Docs.tsx`** — page de documentation React complète, accessible à `/documentation`.

**Sections couvertes :**

| Section | Contenu |
|---|---|
| Vue d'ensemble | Architecture globale (diagramme), stack technique |
| Pipeline | États d'un article, distinction cron (collecte) vs thread continu (pipeline), étapes détaillées |
| Score de confiance | Formule `40×source + 30×corroboration + 20×fact-check + 10×freshness`, tableaux de correspondance pour chaque composante |
| Fact-check dual LLM | Modèles, mécanisme de comparaison positionnelle, limite connue, règles de fusion par cas, fallback |
| Corroboration | Algorithme cosinus, cache vectoriel NumPy vectorisé |
| Cluster dedup | Principe canonique, exemple, contrôle dans le feed |
| Tags | Règles de normalisation, tableau avant/après, filtre multi-chips |
| Sources | Types, formats d'URL, fréquences de collecte (cron via APScheduler) |
| API REST | Endpoints, paramètres de filtrage |

**Navigation :**
- Lien "Docs" ajouté dans la navbar principale (Feed / Admin / Docs)
- Table des matières sticky sur la gauche avec highlight de la section active au scroll
- "Swagger API ↗" discret en haut à droite pour accéder à la doc auto FastAPI

**Points corrigés suite aux retours :**
- Clarification : 1 seul LLM secondaire (llama3.2:3b), pas deux
- Pipeline : distinction explicite collecte (CronTrigger) vs enrichissement/scoring (thread `while True`)
- Explication honnête de la limite du matching positionnel dans le dual LLM

**Git :** commits `70112a4` (création) et `fafb29c` (corrections)

---

## État du projet — juin 2026

### Git log
```
fafb29c  docs: fix documentation — 1 secondary LLM, cron vs thread, positional comparison
70112a4  feat: documentation page with TOC, pipeline, scoring formula, dual LLM, clusters
fee0da1  fix: dual LLM fact-check — KeyError on prompt + wrong secondary model
45a6882  docs: DEVLOG session 14 — dual LLM, tag norm, cluster dedup + recalibration proposal
0477b5c  feat: data quality improvements — dual LLM, tag norm, cluster dedup, tag chips
edd506e  chore: initial commit — veille-techno v1.0 (sessions 1-13)
```

### Fonctionnalités en production
- ✅ Collecte automatique (19 sources, RSS + arXiv + HN)
- ✅ Pipeline continu : enrichissement (qwen3.5) → embedding (nomic) → scoring → clustering
- ✅ Dual LLM fact-check (qwen3.5 primaire + llama3.2 secondaire)
- ✅ Score de confiance 4 composantes (source × corroboration × fact-check × freshness)
- ✅ Déduplication sémantique par cluster + badge "N similar"
- ✅ Normalisation des tags (354 nettoyés, synonymes AI)
- ✅ Feed : recherche full-text + chips tags multi-select + filtres + tri
- ✅ Admin : monitoring pipeline, sparklines, gestion sources, logs erreurs 24h
- ✅ Page documentation interne (pipeline, formules, dual LLM, API)
- ✅ Git avec commits par session

### En attente de validation
- ⏳ Recalibrage automatique de la reliability des sources (proposition en session 14)

---

*Dernière mise à jour : juin 2026*
