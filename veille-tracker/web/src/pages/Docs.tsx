import { useEffect, useState } from "react";

// ── Reusable components ───────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-14 scroll-mt-24">
      <h2 className="text-xl font-semibold text-gray-100 mb-4 pb-2 border-b border-gray-800">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-base font-medium text-indigo-300 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 leading-relaxed mb-3">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs text-green-300 font-mono overflow-x-auto mb-4 whitespace-pre">
      {children}
    </pre>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 bg-gray-900 text-gray-300 font-medium border border-gray-800 text-xs">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-gray-950" : "bg-gray-900/40"}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-gray-400 border border-gray-800 text-xs">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-medium ${color}`}>
      {children}
    </span>
  );
}

// ── Table of contents ─────────────────────────────────────────────────────────

const TOC = [
  { id: "overview",       label: "Vue d'ensemble" },
  { id: "pipeline",       label: "Pipeline de traitement" },
  { id: "score",          label: "Score de confiance" },
  { id: "factcheck",      label: "Double vérification LLM" },
  { id: "corroboration",  label: "Corroboration sémantique" },
  { id: "cluster",        label: "Déduplication par cluster" },
  { id: "tags",           label: "Normalisation des tags" },
  { id: "sources",        label: "Sources & collecte" },
  { id: "api",            label: "API REST" },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Docs() {
  const [active, setActive] = useState("overview");

  // Highlight active TOC item on scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    TOC.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex gap-8 relative">

      {/* ── Sticky sidebar TOC ── */}
      <aside className="hidden lg:block w-52 shrink-0">
        <div className="sticky top-8">
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-3 font-semibold">
            Contenu
          </p>
          <nav className="space-y-1">
            {TOC.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                className={`block text-xs py-1 pl-3 border-l-2 transition-colors ${
                  active === id
                    ? "border-indigo-500 text-indigo-300"
                    : "border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600"
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="mt-8 pt-4 border-t border-gray-800">
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1"
            >
              Swagger API ↗
            </a>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="min-w-0 flex-1">

        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Documentation</h1>
          <p className="text-gray-500 text-sm">
            Veille AI/LLM — architecture, pipeline, calcul des scores et utilisation de l'API.
          </p>
        </div>

        {/* ── 1. Vue d'ensemble ── */}
        <Section id="overview" title="Vue d'ensemble">
          <P>
            Le système est une plateforme de veille technologique sur l'IA et les LLM. Il collecte
            automatiquement des articles depuis des sources hétérogènes (RSS, arXiv, Hacker News),
            les enrichit via des modèles de langage locaux, calcule un score de confiance et les
            présente dans un feed filtrable.
          </P>

          <Sub title="Architecture globale">
            <Code>{`┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────┐
│   Sources   │──▶│  Collecteurs │──▶│  Base de     │──▶│  Pipeline  │
│  RSS / API  │   │  rss/arxiv/  │   │  données     │   │  continu   │
└─────────────┘   │  hackernews  │   │  (MariaDB)   │   └───────────┘
                  └──────────────┘   └──────────────┘
                                                              │
                         ┌────────────────────────────────────┤
                         ▼            ▼             ▼         ▼
                     Enricher     Embedder       Scorer   Cluster
                   (qwen3.5:9b) (nomic-embed) (dual LLM) (dédup)
                         │            │             │         │
                         └────────────┴─────────────┴─────────┘
                                           │
                                    ┌──────▼──────┐
                                    │  React Feed │
                                    └─────────────┘`}</Code>
          </Sub>

          <Sub title="Stack technique">
            <Table
              headers={["Composant", "Technologie", "Rôle"]}
              rows={[
                ["Backend",    "FastAPI + Python 3.12",    "API REST, orchestration pipeline"],
                ["Base de données", "MariaDB 11",          "Stockage articles, tags, embeddings"],
                ["LLM principal", "qwen3.5:9b",            "Enrichissement (résumé+tags) + fact-check primaire"],
                ["LLM secondaire", "llama3.2:3b",          "Fact-check secondaire uniquement (contre-vérification)"],
                ["Embeddings",  "nomic-embed-text",         "Vecteurs sémantiques 768 dim."],
                ["Scheduler",   "APScheduler",             "Collecte via CronTrigger + pipeline continu (thread)"],
                ["Frontend",    "React 19 + Vite",         "Interface utilisateur"],
                ["Déploiement", "Docker Compose",           "Conteneurisation"],
              ]}
            />
          </Sub>
        </Section>

        {/* ── 2. Pipeline ── */}
        <Section id="pipeline" title="Pipeline de traitement">
          <P>
            Le pipeline est continu — un thread dédié tourne en permanence et traite les
            articles dès qu'ils arrivent dans la base. Chaque article passe par 4 étapes
            représentées par un champ <code className="text-indigo-300 bg-gray-900 px-1 rounded">status</code>.
          </P>

          <Sub title="États d'un article">
            <Table
              headers={["Status", "Signification", "Transition suivante"]}
              rows={[
                [<Badge color="bg-gray-800 text-gray-300">collecte</Badge>,    "Vient d'être collecté, brut",           "Enricher le prend en charge"],
                [<Badge color="bg-yellow-900/40 text-yellow-300">processing</Badge>, "En cours d'enrichissement",       "→ enrichi si succès, retour à collecte si échec"],
                [<Badge color="bg-blue-900/40 text-blue-300">enrichi</Badge>,  "Résumé + tags générés, vecteur généré", "Scorer le prend en charge"],
                [<Badge color="bg-green-900/40 text-green-300">score</Badge>,  "Score de confiance calculé, visible",   "État final — réaffiché dans le feed"],
              ]}
            />
          </Sub>

          <Sub title="Étape 1 — Collecte">
            <P>
              La collecte est déclenchée par <strong className="text-gray-300">APScheduler</strong> via
              des expressions cron configurables. RSS et API ont des fréquences différentes.
            </P>
            <Table
              headers={["Type source", "Fréquence", "Expression cron (.env)"]}
              rows={[
                ["RSS / Atom",  "toutes les 30 min", "RSS_COLLECT_INTERVAL=*/30 * * * *"],
                ["arXiv / HN",  "toutes les 2h",     "ARXIV_COLLECT_INTERVAL=0 */2 * * *"],
              ]}
            />
            <P>
              Le bouton "Collect now" dans l'Admin déclenche une collecte immédiate hors planning
              pour une source spécifique, sans attendre le prochain tick cron.
            </P>
            <P>
              Chaque collecteur déduplique les URLs (vérification en base + set en mémoire intra-batch)
              et insère par lots de 50. Un{" "}
              <code className="text-indigo-300 bg-gray-900 px-1 rounded">CollectLog</code> est
              créé à chaque run avec le nombre d'articles et les erreurs éventuelles.
            </P>
            <Table
              headers={["Type", "Collecteur", "Mécanisme"]}
              rows={[
                ["RSS",    "feedparser",      "Parse le flux Atom/RSS, extrait titre, contenu, date, auteur"],
                ["arXiv",  "feedparser",      "Utilise l'API RSS d'export.arxiv.org par catégorie (cs.AI, cs.CL, cs.LG)"],
                ["HN",     "Algolia API",     "Requête search_by_date, filtre par mots-clés IA ou requête ciblée via ?query="],
              ]}
            />
          </Sub>

          <Sub title="Pipeline — thread continu (pas du cron)">
            <P>
              Contrairement à la collecte, le pipeline de traitement (enrichissement, embedding,
              scoring, clustering) tourne dans un <strong className="text-gray-300">thread Python dédié</strong> qui
              s'exécute en boucle permanente, indépendamment de tout scheduler cron.
            </P>
            <Code>{`# Logique du pipeline continu (scheduler.py)
while True:
    lancer en parallèle : enricher×3 + scorer×3 + embedder×1 + cluster×1
    attendre que tous les workers terminent
    si rien à traiter → dormir 15 secondes
    sinon             → cycle suivant immédiatement

→ Dès qu'un article est collecté, il est traité dans les secondes qui suivent.
→ Aucune latence d'attente de tick cron pour le pipeline.`}</Code>
          </Sub>

          <Sub title="Étape 2 — Enrichissement (qwen3.5:9b, 3 workers en parallèle)">
            <P>
              Le worker réclame un lot d'articles atomiquement (passage <code className="text-indigo-300 bg-gray-900 px-1 rounded">collecte → processing</code>)
              puis appelle qwen3.5:9b pour chaque article. Le prompt demande au modèle de produire
              un résumé de 3-4 phrases et d'extraire 3-5 tags pertinents.
            </P>
            <Code>{`Prompt enrichissement :
"You are a technical assistant. Summarise the article in 3-4 sentences,
then extract 3-5 relevant tags as a JSON list.
Reply with JSON: {"summary": "...", "tags": ["tag1", ...]}"

→ Le résumé est stocké dans articles.summary
→ Les tags sont normalisés (voir section Tags) puis stockés dans la table tags`}</Code>
          </Sub>

          <Sub title="Étape 3 — Embedding (nomic-embed-text, 768 dimensions)">
            <P>
              Un worker séparé génère les vecteurs d'embedding pour tous les articles enrichis
              qui n'en ont pas encore. Le texte vectorisé est
              <code className="text-indigo-300 bg-gray-900 px-1 rounded"> titre + résumé</code>.
              Les vecteurs sont stockés en binaire (LONGBLOB, format float32 × 768) dans la table
              <code className="text-indigo-300 bg-gray-900 px-1 rounded"> embeddings</code>.
            </P>
          </Sub>

          <Sub title="Étape 4 — Scoring (3 workers en parallèle)">
            <P>
              Calcule le score de confiance sur 100 en combinant 4 composantes. Voir la section
              dédiée ci-dessous pour la formule complète.
            </P>
          </Sub>

          <Sub title="Étape 5 — Clustering (1 worker par cycle)">
            <P>
              Regroupe les articles sémantiquement proches issus de sources différentes. Désigne
              un article "canonique" par cluster (le mieux scoré). Les doublons sont masqués
              dans le feed par défaut. Voir la section Déduplication.
            </P>
          </Sub>
        </Section>

        {/* ── 3. Score de confiance ── */}
        <Section id="score" title="Score de confiance">
          <P>
            Chaque article reçoit un score entre 0 et 100 calculé comme une moyenne pondérée
            de 4 composantes indépendantes. Ce score reflète la fiabilité estimée de l'information.
          </P>

          <Sub title="Formule">
            <Code>{`score_confiance = 0.40 × source_reliability
                + 0.30 × corroboration
                + 0.20 × fact_check
                + 0.10 × freshness`}</Code>
          </Sub>

          <Sub title="Composante 1 — Fiabilité de la source (40%)">
            <P>
              Directement le champ <code className="text-indigo-300 bg-gray-900 px-1 rounded">reliability</code> de
              la source, entre 0 et 100. Défini manuellement à l'ajout de la source.
              Cette composante est intentionnellement la plus lourde : une source fiable (arXiv,
              OpenAI Blog) contribue davantage qu'un forum Reddit.
            </P>
            <Table
              headers={["Plage", "Interprétation", "Exemples"]}
              rows={[
                ["90–100", "Source académique ou officielle",   "arXiv (95), OpenAI Blog (90), DeepMind (90)"],
                ["75–89",  "Source professionnelle reconnue",   "Google AI Blog (85), HuggingFace (85)"],
                ["60–74",  "Source sérieuse mais moins formelle","MIT Tech Review (75), Import AI (75)"],
                ["40–59",  "Source communautaire",              "Reddit r/MachineLearning (60)"],
                ["0–39",   "Source non vérifiée / agrégateur",  "HN générique (55), Dev.to (50)"],
              ]}
            />
          </Sub>

          <Sub title="Composante 2 — Corroboration (30%)">
            <P>
              Mesure combien d'articles d'<em>autres sources</em> confirment la même information
              dans une fenêtre temporelle de 72 heures. La similarité est calculée par cosinus
              sur les vecteurs d'embedding (seuil : 0.85).
            </P>
            <Table
              headers={["Nombre de sources qui corroborent", "Score corroboration"]}
              rows={[
                ["0 source", "30 (neutre — pas de preuve mais pas de contradiction)"],
                ["1 source", "55"],
                ["2 sources", "75"],
                ["3 sources", "90"],
                ["4+ sources", "100"],
              ]}
            />
            <P>
              La fenêtre de 72h et le seuil cosinus 0.85 sont configurables via les variables
              d'environnement <code className="text-indigo-300 bg-gray-900 px-1 rounded">CORROBORATION_WINDOW_HOURS</code> et{" "}
              <code className="text-indigo-300 bg-gray-900 px-1 rounded">CORROBORATION_COSINE_THRESHOLD</code>.
            </P>
          </Sub>

          <Sub title="Composante 3 — Fact-check (20%)">
            <P>
              Deux modèles LLM analysent l'article et classifient chaque claim factuel
              comme <Badge color="bg-green-900/40 text-green-300">supported</Badge>{" "}
              <Badge color="bg-red-900/40 text-red-300">unsupported</Badge>{" "}
              <Badge color="bg-gray-800 text-gray-300">unverifiable</Badge>{" "}
              ou <Badge color="bg-yellow-900/40 text-yellow-300">contested</Badge>.
              Voir la section Fact-check pour le détail.
            </P>
            <Code>{`score_fact_check = (supported + contested × 0.5) / nb_claims_vérifiables × 100

Exemple : 3 claims vérifiables, 2 "supported", 1 "contested"
  → (2 + 0.5) / 3 × 100 = 83.3`}</Code>
          </Sub>

          <Sub title="Composante 4 — Fraîcheur (10%)">
            <P>
              Pénalise les articles anciens et récompense les articles riches en contenu.
            </P>
            <Table
              headers={["Critère", "Points ajoutés"]}
              rows={[
                ["Article publié < 24h",      "+40"],
                ["Article publié < 72h",      "+25"],
                ["Article publié < 7 jours",  "+10"],
                ["Article > 7 jours ou date inconnue", "+0"],
                ["Auteur identifié",           "+20"],
                ["Contenu > 500 caractères",  "+25"],
                ["Contenu entre 100-500 car.", "+10"],
              ]}
            />
          </Sub>

          <Sub title="Interprétation du score final">
            <Table
              headers={["Score", "Couleur", "Signification"]}
              rows={[
                ["80–100", "🟢 Vert",   "Très fiable — plusieurs sources, contenu vérifié"],
                ["60–79",  "🟡 Jaune",  "Fiable — source reconnue ou corroborée"],
                ["40–59",  "🟠 Orange", "Modérément fiable — source communautaire ou peu corroborée"],
                ["0–39",   "🔴 Rouge",  "Faible confiance — non corroboré, source peu fiable"],
              ]}
            />
          </Sub>
        </Section>

        {/* ── 4. Double LLM ── */}
        <Section id="factcheck" title="Double vérification LLM">
          <P>
            La vérification factuelle utilise deux modèles LLM distincts pour obtenir des opinions
            indépendantes sur chaque claim. L'utilisation de deux familles de modèles différentes
            (Qwen/Alibaba et Llama/Meta) réduit les biais liés à un entraînement unique.
          </P>

          <Sub title="Modèles utilisés">
            <P>
              Un seul LLM secondaire est dédié à la contre-vérification. qwen3.5 fait à la fois
              l'enrichissement et le fact-check primaire — llama3.2 intervient uniquement
              en tant que second avis sur les claims factuels.
            </P>
            <Table
              headers={["Rôle", "Modèle", "VRAM (ROCm)", "Famille"]}
              rows={[
                ["Enrichissement (résumé+tags) + Fact-check primaire", "qwen3.5:9b",      "~7.9 GB", "Qwen / Alibaba"],
                ["Fact-check secondaire uniquement",                   "llama3.2:3b",     "~5.1 GB", "Llama / Meta"],
                ["Embeddings",                                          "nomic-embed-text","~0.7 GB", "Nomic"],
              ]}
            />
            <P>
              Les trois modèles coexistent en VRAM simultanément (total ~13.7 GB sur 15.9 GB
              disponibles sur le LXC-AI). Aucun swap n'est nécessaire pendant le pipeline.
              Note : sur AMD ROCm, les modèles quantisés sont dequantisés en FP16 au chargement,
              ce qui explique que llama3.2:3b (2 GB sur disque) occupe ~5 GB en VRAM.
            </P>
          </Sub>

          <Sub title="Mécanisme de comparaison — comparaison positionnelle">
            <P>
              Les deux modèles reçoivent le <strong className="text-gray-300">même prompt</strong> sur
              le même article et produisent chacun une liste de 3-5 claims. La comparaison
              se fait ensuite <strong className="text-gray-300">par index positionnel</strong> :
              claim[0] de qwen est comparé à claim[0] de llama, claim[1] à claim[1], etc.
            </P>
            <Code>{`Article : "GPT-5 atteint 92% sur MMLU, dépasse les experts humains selon OpenAI"

qwen3.5 extrait :                        llama3.2 extrait :
  [0] "GPT-5 scores 92% on MMLU"           [0] "GPT-5 achieves 92% on MMLU"
      → supported                               → supported
  [1] "Surpasses human experts"            [1] "Beats human performance"
      → unsupported                             → contested
  [2] "Published by OpenAI"               [2] "OpenAI claims superiority"
      → supported                               → unsupported

Fusion index par index :
  [0] supported + supported  → supported  (accord ✅)
  [1] unsupported + contested → contested  (désaccord ⚠️ → crédit 50%)
  [2] supported + unsupported → contested  (désaccord ⚠️ → crédit 50%)`}</Code>

            <P>
              <strong className="text-yellow-400">Limite connue :</strong> les deux modèles
              n'extraient pas nécessairement les <em>mêmes</em> claims dans le même ordre.
              Si qwen extrait les performances techniques et llama extrait les enjeux business,
              la comparaison par index met en regard des affirmations sans rapport. C'est une
              heuristique — pas une correspondance sémantique exacte.
            </P>
            <P>
              Malgré cette limite, le dual-LLM apporte de la valeur sur deux points :
              (1) <strong className="text-gray-300">fallback</strong> — si un modèle échoue (timeout, réseau),
              l'autre prend le relais sans bloquer le pipeline ;
              (2) <strong className="text-gray-300">biais croisés</strong> — quand deux modèles de familles
              différentes (Alibaba vs Meta, bases d'entraînement distinctes) sont globalement
              en accord sur un article, c'est un signal plus fort qu'un verdict unique.
            </P>
          </Sub>

          <Sub title="Règles de fusion par claim">
            <Table
              headers={["qwen3.5 (primaire)", "llama3.2 (secondaire)", "Consensus stocké", "Crédit scoring"]}
              rows={[
                ["supported",    "supported",    <Badge color="bg-green-900/40 text-green-300">supported</Badge>,     "100%"],
                ["unsupported",  "unsupported",  <Badge color="bg-red-900/40 text-red-300">unsupported</Badge>,       "0%"],
                ["unverifiable", "— (tout)",     <Badge color="bg-gray-800 text-gray-300">unverifiable</Badge>,       "exclu du calcul"],
                ["supported",    "unsupported",  <Badge color="bg-yellow-900/40 text-yellow-300">contested</Badge>,   "50%"],
                ["unsupported",  "supported",    <Badge color="bg-yellow-900/40 text-yellow-300">contested</Badge>,   "50%"],
                ["— (tout)",     "unverifiable", <Badge color="bg-gray-800 text-gray-300">unverifiable</Badge>,       "exclu du calcul"],
                ["— (échec)",    "— (succès)",   "résultat llama seul",                                               "normal"],
                ["— (succès)",   "— (échec)",    "résultat qwen seul",                                                "normal"],
                ["— (échec)",    "— (échec)",    "score neutre 60",                                                   "—"],
              ]}
            />
          </Sub>
        </Section>

        {/* ── 5. Corroboration ── */}
        <Section id="corroboration" title="Corroboration sémantique">
          <P>
            La corroboration est le mécanisme qui détecte automatiquement quand plusieurs sources
            couvrent le même événement. Elle repose sur la similarité vectorielle des embeddings.
          </P>

          <Sub title="Algorithme">
            <Code>{`Pour chaque article A à scorer :
  1. Charger le cache vectoriel (tous les embeddings < 72h, sources différentes)
  2. Calculer la similarité cosinus entre A et chaque article du cache
     sim(A, B) = (A · B) / (|A| × |B|)
  3. Si sim ≥ 0.85 → B corrobore A
     → Stocker dans corroborations(article_id=A, similar_article_id=B, score=sim)
  4. Comptage → score corroboration (voir tableau section Score)`}</Code>
          </Sub>

          <Sub title="Cache vectoriel optimisé">
            <P>
              Pour éviter N requêtes SQL par article, tous les embeddings récents sont chargés
              en mémoire en une seule requête et mis en cache pendant 30 secondes. La comparaison
              est vectorisée via NumPy (multiplication matricielle) — pas de boucle article par article.
            </P>
            <Code>{`# 1 seul chargement pour tout le batch
matrix = np.stack([vec for _, _, _, vec in cache])   # (N, 768)
sims   = (matrix @ vec_a) / (norms_b × norm_a)       # N similarités en 1 opération`}</Code>
          </Sub>
        </Section>

        {/* ── 6. Cluster ── */}
        <Section id="cluster" title="Déduplication par cluster">
          <P>
            Quand plusieurs sources couvrent le même événement, le feed afficherait par défaut
            des articles quasi-identiques. Le système de clustering regroupe ces articles et
            n'en affiche qu'un seul (le "canonique").
          </P>

          <Sub title="Principe">
            <P>
              Après le scoring, le worker de cluster analyse les paires de corroborations
              pour identifier les groupes d'articles similaires. Au sein de chaque groupe,
              l'article avec le meilleur <code className="text-indigo-300 bg-gray-900 px-1 rounded">confidence_score</code> est désigné
              comme canonique.
            </P>
            <Code>{`Articles {A, B, C} couvrent le même sujet :
  A (score 78, arXiv)     ← canonique (meilleur score)
  B (score 65, HN)        → canonical_id = A.id
  C (score 61, Reddit)    → canonical_id = A.id

A apparaît dans le feed avec le badge "2 similar"
B et C sont masqués (deduplicate=true par défaut)`}</Code>
          </Sub>

          <Sub title="Contrôle dans le feed">
            <P>
              La case "Show duplicates" dans les filtres permet d'afficher tous les articles
              d'un cluster. Le badge <span className="text-indigo-400">↔ N similar</span> sur
              une carte indique que N autres sources ont couvert la même information.
            </P>
          </Sub>
        </Section>

        {/* ── 7. Tags ── */}
        <Section id="tags" title="Normalisation des tags">
          <P>
            Sans normalisation, le même concept génère des dizaines de tags distincts :
            <code className="text-indigo-300 bg-gray-900 px-1 rounded"> "LLMs"</code>,{" "}
            <code className="text-indigo-300 bg-gray-900 px-1 rounded"> "large language model"</code>,{" "}
            <code className="text-indigo-300 bg-gray-900 px-1 rounded"> "large-language-models"</code>
            → tous normalisés en <code className="text-green-400 bg-gray-900 px-1 rounded"> "llm"</code>.
          </P>

          <Sub title="Règles appliquées">
            <Table
              headers={["Règle", "Exemple avant", "Exemple après"]}
              rows={[
                ["Lowercase + trim",          "Large Language Model",   "large language model"],
                ["Suppression ponctuation",   "fine_tuning",           "fine tuning"],
                ["Mapping synonymes",         "large language models",  "llm"],
                ["Mapping synonymes",         "artificial intelligence", "ai"],
                ["Mapping synonymes",         "reinforcement learning", "rl"],
                ["Mapping synonymes",         "open source",           "open-source"],
                ["Stopwords rejetés",         "research",              "(supprimé)"],
                ["Stopwords rejetés",         "new",                   "(supprimé)"],
                ["Trop court (< 2 chars)",    "a",                     "(supprimé)"],
                ["Purement numérique",        "2024",                  "(supprimé)"],
              ]}
            />
          </Sub>

          <Sub title="Filtre par tags dans le feed">
            <P>
              Les chips de tags affichés sous la barre de recherche sont les 25 tags les plus
              fréquents. La sélection multiple fonctionne en logique OR : un article doit
              posséder <em>au moins un</em> des tags sélectionnés pour apparaître dans les résultats.
            </P>
          </Sub>
        </Section>

        {/* ── 8. Sources ── */}
        <Section id="sources" title="Sources & collecte">
          <Sub title="Types de sources">
            <Table
              headers={["Type", "Mécanisme", "URL format"]}
              rows={[
                ["RSS / Atom", "feedparser — parse le flux XML",           "https://example.com/feed.xml"],
                ["arXiv",      "feedparser — API export RSS par catégorie", "https://export.arxiv.org/rss/cs.AI"],
                ["HN générique", "Algolia search_by_date — filtre mots-clés IA", "https://hn.algolia.com/api/v1/search_by_date"],
                ["HN ciblé",   "Algolia avec paramètre query spécifique", "https://hn.algolia.com/api/v1/search_by_date?tags=story&query=anthropic"],
              ]}
            />
          </Sub>

          <Sub title="Gestion des sources via l'Admin">
            <P>
              L'onglet Admin permet d'ajouter, modifier, activer/désactiver et supprimer
              des sources. Le champ "Reliability" (0–100) influence directement le score
              de confiance de tous les articles collectés depuis cette source.
            </P>
            <P>
              Le bouton <span className="text-indigo-300">▶ Collect now</span> déclenche
              immédiatement une collecte pour la source sélectionnée, sans attendre le
              prochain cycle planifié.
            </P>
          </Sub>

          <Sub title="Fréquences de collecte">
            <P>
              Configurables via les variables d'environnement en syntaxe cron standard
              (interprétées par APScheduler CronTrigger). Voir la section Pipeline pour le détail.
            </P>
            <Table
              headers={["Source", "Défaut", "Variable .env"]}
              rows={[
                ["RSS / Atom",  "*/30 * * * * (toutes les 30 min)", "RSS_COLLECT_INTERVAL"],
                ["arXiv / HN",  "0 */2 * * * (toutes les 2h)",      "ARXIV_COLLECT_INTERVAL"],
              ]}
            />
          </Sub>
        </Section>

        {/* ── 9. API ── */}
        <Section id="api" title="API REST">
          <P>
            L'API complète est disponible avec interface interactive à{" "}
            <a href="/docs" target="_blank" className="text-indigo-400 hover:text-indigo-300">
              /docs (Swagger) ↗
            </a>. Voici les endpoints principaux.
          </P>

          <Sub title="Articles">
            <Table
              headers={["Méthode", "Endpoint", "Description"]}
              rows={[
                ["GET", "/articles", "Liste paginée avec filtres"],
                ["GET", "/articles/{id}", "Détail + score breakdown + fact-checks"],
                ["GET", "/articles/tags/popular", "Top N tags avec comptage"],
              ]}
            />
            <Code>{`# Paramètres GET /articles
?search=llm            # Recherche plein texte (titre, résumé, tags)
&tags=llm&tags=ai      # Filtre multi-tags (OR)
&min_score=70          # Score de confiance minimum
&source=3              # ID de source
&sort_by=confidence_score&sort_dir=desc
&deduplicate=true      # Masquer les doublons de cluster (défaut: true)
&limit=50&offset=0     # Pagination`}</Code>
          </Sub>

          <Sub title="Sources">
            <Table
              headers={["Méthode", "Endpoint", "Description"]}
              rows={[
                ["GET",    "/sources",              "Liste toutes les sources actives"],
                ["POST",   "/sources",              "Créer une source"],
                ["PATCH",  "/sources/{id}",         "Modifier une source"],
                ["DELETE", "/sources/{id}",         "Désactiver (soft delete)"],
                ["DELETE", "/sources/{id}?hard=true", "Supprimer définitivement (cascade)"],
                ["GET",    "/sources/{id}/collect", "Déclencher une collecte immédiate"],
              ]}
            />
          </Sub>

          <Sub title="Stats & monitoring">
            <Table
              headers={["Méthode", "Endpoint", "Description"]}
              rows={[
                ["GET", "/stats",        "Statistiques globales (total, fiabilité, avg score)"],
                ["GET", "/stats/admin",  "Monitoring complet pipeline, sources, logs, distribution"],
                ["GET", "/stats/db",     "Taille des tables en MB"],
                ["GET", "/health",       "Health check"],
              ]}
            />
          </Sub>
        </Section>

      </div>
    </div>
  );
}
