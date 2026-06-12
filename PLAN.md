# PLAN — Refonte de la pertinence des articles

> **Fichier de suivi d'implémentation.** Mis à jour à chaque étape terminée.
> Si une session s'arrête à sec de tokens : reprendre à la première case non cochée.
> Contexte complet de la décision : DEVLOG.md session 16 (+ mémoire Claude `relevance_rework.md`).

**Date de démarrage :** 2026-06-12
**Objectif :** le système ne mesure aujourd'hui que la **confiance** (fiabilité), jamais la **pertinence** (est-ce dans le périmètre de veille IA/LLM ?). Audit du 12/06 : ~50 % de spam dans Dev.to AI (628 articles), chaque article hors-sujet brûle 3 appels LLM et pollue le feed.

---

## Architecture cible (décisions actées)

**Deux signaux de pertinence, zéro appel LLM supplémentaire, zéro VRAM en plus :**

1. **Gate par embeddings** (déterministe, ~0 coût) : similarité cosinus entre l'embedding de
   l'article (nomic-embed-text, déjà dans la stack) et des **phrases-ancres** décrivant le
   périmètre de veille (table `topic_anchors`, éditable). Score 0–100 stocké dans
   `articles.relevance_score`.
2. **Avis LLM** (gratuit — greffé sur l'appel d'enrichissement existant) : le prompt de
   l'enricher retourne en plus `relevance: on_topic|borderline|off_topic` + une raison.

**Nouveau flux pipeline** (le gate coupe AVANT les appels LLM coûteux) :

```
collecte → [gate: embedding + score ancres] → pertinent → enrichi → score
                          │
                          └→ hors_sujet (si score < seuil bas — pas d'enrich, pas de scoring,
                              conservé en base, exclu du feed et de la corroboration)
```

**Fusion des deux signaux** (bucket final `articles.relevance`) :
- embed < T_LOW → `off_topic` (statut `hors_sujet`, jamais enrichi)
- LLM absent/illisible → bucket embedding
- LLM `on_topic` → `on_topic` ; LLM `borderline` → `borderline`
- LLM `off_topic` : si embed disait `on_topic` → `borderline` (désaccord), sinon `off_topic` + statut `hors_sujet`
- Feedback humain 👎 → `off_topic` direct (raison : "feedback humain")

**Principe veille** : on ne JETTE rien à la collecte (faux négatif > faux positif). Les
hors-sujet restent en base, auditables, réintégrables. Le feed les masque par défaut.

**Seuils** : `T_LOW` / `T_HIGH` dans config.py (env-overridable). Valeurs à calibrer sur les
4 568 articles réels en phase 5 — NE PAS inventer, mesurer.

**Active learning (P4)** : boutons 👍/👎 → table `feedback` → régression logistique
**pure numpy** (pas de scikit-learn, pas de dépendance, CPU, millisecondes) entraînée sur les
embeddings 768-d existants → `articles.ml_relevance` (proba 0–100). File "à trier" =
articles triés par incertitude (|ml_relevance − 50| croissant). Entraînement : déclenché
par endpoint + job horaire si nouveaux feedbacks. Min 10 exemples par classe.

**Modèles GPU : inchangés** (qwen3.5:9b + llama3.2:3b + nomic-embed-text). Rien de nouveau en VRAM.

---

## Phases

### Phase 0 — Plan ✅
- [x] PLAN.md créé

### Phase 1 — Quick wins (P0) ✅
- [x] `collectors/hackernews.py` : filtre mots-clés par sous-chaîne → regex avec frontières
      de mots ("gpt" matchait *Egypt*, "llm" matchait *Wellman*)
- [x] `confidence.py` : scinder `score_freshness` en `score_recency` + `score_completeness`,
      freshness = moyenne des deux. Breakdown API expose les deux sous-scores.

### Phase 2 — Visibilité des erreurs pipeline ✅ (backend — panneau UI en phase 8)
- [x] `pipeline_stats.py` : ring buffer 50 dernières erreurs + compteurs cumulés
- [x] `workers/enricher.py`, `workers/scorer.py`, gate : messages d'erreur réels enregistrés
- [x] `/stats/admin` : `pipeline_errors` + `pipeline_error_totals` + `gated_per_min`
- [ ] Admin.tsx : panneau "Pipeline errors" (fait en phase 8 avec le reste du front)

### Phase 3 — Migration base de données ✅
- [x] Backup : `db/backups/pre_relevance_20260612.sql.gz` (18 Mo)
- [x] Migration 001 appliquée (status enum, colonnes relevance*, ml_relevance,
      topic_anchors, feedback, ml_models) — `db/migrations/001_relevance.sql`
- [x] Migration 002 appliquée (polarity sur topic_anchors + 8 ancres négatives) —
      `db/migrations/002_contrastive_anchors.sql`
- [x] `db/init.sql` + `models.py` à jour (TopicAnchor avec polarity, Feedback, MlModel)

### Phase 4 — Cœur pertinence (backend) ✅
- [x] `relevance.py` : **PIVOT CONTRASTIF** (voir décisions) — marge = max_cos(ancres
      positives) − max_cos(ancres négatives), cache ancres TTL 5 min, fusion LLM+embed
- [x] `workers/relevance_gate.py` : collecte → embed → marge → `pertinent` | `hors_sujet`
- [x] `workers/enricher.py` : claim `pertinent`, prompt v2 (relevance + raison), fusion,
      demote `hors_sujet`, erreurs LLM enregistrées (plus de fallback silencieux)
- [x] `scheduler.py` : gate branché dans la boucle pipeline
- [x] `confidence.py` : corroboration exclut relevance='off_topic' (filtre sur relevance,
      pas status : le spam legacy backfillé garde status='score')
- [x] Config : `relevance_t_low = -0.12`, `relevance_t_high = +0.05` (marges, MESURÉES)

### Phase 5 — Calibration + backfill ✅
- [x] Calibration v1 (`scripts/calibrate_relevance.py`) : **échec instructif** — le cosinus
      absolu ne sépare PAS le spam (PayPal à 0.55 = milieu de distribution ; les scores les
      plus bas étaient des articles légitimes non-anglophones). → pivot contrastif.
- [x] Calibration v2 (`scripts/calibrate_v2_contrastive.py`) : la marge sépare nettement —
      tout le spam connu < −0.12 (moyenne −0.13), légitime > −0.10 (« Codex getting
      started » à −0.072 = pire cas légitime observé). Seuils : −0.12 / +0.05.
- [x] Backfill exécuté (`scripts/backfill_relevance.py`) : **4 580/4 580 articles —
      3 632 on_topic (79.3%) · 907 borderline (19.8%) · 41 off_topic (0.9%)**.
      Top off_topic vérifié = 100% spam (Kraken, Binance, PayPal, spa, affiliation).
      Piège résolu : erreur MariaDB 1020 (snapshot long vs pipeline concurrent) →
      calcul en mémoire puis updates en transactions courtes avec retry.

### Phase 6 — API ✅
- [x] `GET /articles` : `off_topic` exclu par défaut, params `show_off_topic` + `relevance=`,
      tris `relevance_score` + `uncertainty` (exclut les articles déjà votés),
      ArticleOut expose relevance/relevance_score/relevance_reason/ml_relevance/feedback
- [x] `PUT /articles/{id}/feedback` {verdict} + `DELETE` (bucket recalculé depuis la marge)
- [x] `routers/relevance.py` : GET/POST/PATCH/DELETE `/relevance/anchors` (+ invalidation
      du cache d'ancres), `GET /relevance/model`, `POST /relevance/retrain`
- [x] `/stats/admin` : relevance_distribution, llm_calls_saved, feedback_count,
      ml_last_trained/ml_accuracy, gated_per_min, ETA enrich inclut 'pertinent'

### Phase 7 — Active learning (ML) ✅
- [x] `workers/learner.py` : logreg numpy (gradient descent full-batch, L2, classes
      équilibrées par sample weights), poids → `ml_models` (768 float32 + biais),
      prédiction batch → `articles.ml_relevance` (transactions courtes de 500)
- [x] Job horaire `relevance_retrain` (minute 10) : skip si aucun nouveau feedback
- [x] Garde-fou : min 10 exemples/classe — message clair sinon (vérifié)

### Phase 8 — Frontend ✅
- [x] Feed : RelevanceBadge (borderline/hors sujet, on_topic sans badge pour éviter le
      bruit), FeedbackButtons 👍/👎 sur chaque carte, toggle "Show off-topic", segmented
      control "Feed / 🎯 À trier" (tri incertitude + explication), tri "Most relevant"
- [x] ArticleDetail : section "Pertinence pour la veille" (badge, marge, proba ML, raison,
      boutons feedback) + breakdown confiance à 6 lignes (recency/completeness en sous-scores)
- [x] Admin : panneau "Pipeline errors" dépliable (étape + article cliquable + message +
      heure, compteurs cumulés), funnel 6 statuts + débit gate, carte "Pertinence"
      (barres + appels LLM économisés), carte ML (votes, accuracy, dernier train, bouton
      retrain), section "Topic anchors" (2 colonnes ± , ajout/activation/suppression)
- [x] Cosmétique : hover cartes, focus states, tooltips explicatifs partout

### Phase 9 — Documentation ✅
- [x] Docs.tsx : encart "⚡ Le système en 30 secondes" (les 2 axes en langage simple),
      section "Pertinence & filtrage" complète (pourquoi, 3 signaux, histoire de la
      calibration v1→v2, tableau de fusion, "comment lire le feed"), composant Tldr,
      statuts à jour (6), prompt v2, freshness scindée, API à jour
- [x] README.md : state machine avec gate, section "Relevance (orthogonal axis)",
      modèles Ollama corrigés (qwen3.5/llama3.2/nomic), endpoints à jour
- [x] DEVLOG.md : session 16 complète (problème, architecture, leçon de calibration,
      backfill, fixes, VRAM) + état du projet refait
- [x] PLAN.md : tenu à jour en continu ✅

### Phase 10 — Build, déploiement, vérification ✅
- [x] `docker compose build app web && up -d` (2 itérations : ajout du rattrapage
      "stragglers" au gate après la 1ʳᵉ vérif)
- [x] Vérifié en live : feed par défaut = 0 off_topic visible ; filtre off_topic remonte
      bien le spam (Kraken/Binance/affiliation) ; collecte Dev.to déclenchée → nouveaux
      articles gatés puis enrichis avec verdict LLM fusionné (un borderline LLM observé
      sur marge haute = fusion OK) ; PUT/DELETE feedback aller-retour OK ; retrain
      refuse proprement sans labels ; admin expose tous les nouveaux champs ; bundle web
      contient les nouveaux éléments UI
- [x] VRAM vérifiée : **10.9 GB / 16 GB** (qwen3.5 5.6 + llama3.2 5.0 + nomic 0.3) —
      identique à avant, aucun modèle ajouté, la logreg tourne sur CPU

---

## État courant (mise à jour continue)

**✅ TERMINÉ — les 10 phases sont déployées et vérifiées en production locale (2026-06-12).**

Chiffres finaux : 4 607 articles classés — ~3 653 on_topic · ~912 borderline · ~42 off_topic.
Gate live opérationnel (les nouveaux articles arrivent avec relevance + raison).
ML : pas encore entraîné — il faut 10 👍 et 10 👎 humains (2 min dans le mode "À trier").

Reste à faire (non bloquant) :
- Voter 👍/👎 sur ~20 articles pour débloquer le 1ᵉʳ entraînement du classifieur
- Étoffer les ancres si un sous-domaine de veille manque (Admin → Topic anchors)
- Proposition session 14 (recalibrage reliability des sources) toujours en attente

## Décisions & pièges notés en route

- **PIVOT MAJEUR (calibration v1 → v2)** : le cosinus absolu vs ancres positives ne sépare
  pas le spam du légitime sur ce corpus (espace nomic compressé 0.39–0.82, spam à 0.55 au
  milieu ; pires scores absolus = articles légitimes en chinois/vietnamien). Solution :
  **ancres contrastives** — marge = max_cos(positives) − max_cos(négatives). Mesuré : spam
  < −0.12, légitime > −0.10. Excellent matériau pour le rapport (hypothèse → mesure → pivot).
- `relevance_score` en base = affichage 0–100 (50 = neutre, score = 50 + marge×250 clampé).
  Les seuils de config sont des MARGES (−0.12 / +0.05), pas des scores affichés.
- **Pas de scikit-learn** : logreg numpy maison (zéro dépendance, build Docker inchangé).
- Embeddings existants = titre + résumé LLM ; nouveaux (gate) = titre + contenu brut [:600].
  Pas de re-embed du legacy (vérifié OK à la calibration).
- Corroboration : exclut relevance='off_topic' (filtre sur relevance, PAS status — le spam
  legacy backfillé garde status='score').
- Les anciens articles backfillés gardent leur statut `score` — seule la colonne `relevance`
  est remplie. Le statut `hors_sujet` n'est utilisé que par le gate (avant enrichissement).
- Le feed filtre sur `relevance`, pas sur `status` (les NULL pré-backfill restent visibles).
- L'app est BUILDÉE dans l'image Docker (pas de volume) → rebuild obligatoire pour tester.
- nomic-embed-text SANS préfixe search_document/query (cohérence avec l'existant).
- Backfill : erreur MariaDB 1020 si SELECT long + UPDATEs dans la même transaction pendant
  que le pipeline tourne → calculer en mémoire, puis updates en transactions courtes.
