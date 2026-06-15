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
  { id: "glossary",       label: "Glossaire" },
  { id: "pipeline",       label: "Pipeline de traitement" },
  { id: "relevance",      label: "Pertinence & filtrage" },
  { id: "score",          label: "Score de confiance" },
  { id: "factcheck",      label: "Double vérification LLM" },
  { id: "corroboration",  label: "Corroboration sémantique" },
  { id: "cluster",        label: "Déduplication par cluster" },
  { id: "tags",           label: "Normalisation des tags" },
  { id: "sources",        label: "Sources & collecte" },
  { id: "monitoring",     label: "Monitoring & erreurs" },
  { id: "api",            label: "API REST" },
];

/** Plain-language one-liner shown at the top of a section. */
function Tldr({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-start bg-indigo-950/40 border border-indigo-900/50 rounded-lg px-4 py-3 mb-5">
      <span className="text-indigo-400 text-sm">💡</span>
      <p className="text-sm text-indigo-200/90 leading-relaxed m-0">{children}</p>
    </div>
  );
}

/** Architecture diagram — proper SVG (ASCII renders unevenly in proportional fonts). */
function ArchitectureDiagram() {
  return (
    <div className="mb-5 rounded-lg border border-gray-800 bg-gray-950/40 p-4">
      <svg
        viewBox="0 0 720 880"
        className="block w-full h-auto"
        style={{ maxWidth: "720px", margin: "0 auto" }}
        role="img"
        aria-label="Architecture du système de veille — pipeline complet"
      >
        <defs>
          <marker id="ar-indigo" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#6366f1"/>
          </marker>
          <marker id="ar-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#dc2626"/>
          </marker>
          <marker id="ar-emerald" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#10b981"/>
          </marker>
          <marker id="ar-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#a855f7"/>
          </marker>
        </defs>

        {/* ── SOURCES ── */}
        <rect x="260" y="14" width="200" height="46" rx="6" fill="#111827" stroke="#4b5563" strokeWidth="1.2"/>
        <text x="360" y="34" textAnchor="middle" fill="#e5e7eb" fontSize="13" fontWeight="600">SOURCES</text>
        <text x="360" y="50" textAnchor="middle" fill="#9ca3af" fontSize="10">17 sources · RSS · API · Hacker News</text>

        <line x1="360" y1="60" x2="360" y2="94" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>
        <text x="367" y="80" fill="#6b7280" fontSize="10">collecteurs · cron APScheduler</text>

        {/* ── MariaDB ── */}
        <rect x="110" y="98" width="500" height="86" rx="6" fill="#111827" stroke="#4b5563" strokeWidth="1.2"/>
        <text x="360" y="120" textAnchor="middle" fill="#e5e7eb" fontSize="13" fontWeight="600">MariaDB 11</text>
        <text x="360" y="135" textAnchor="middle" fill="#6b7280" fontSize="10" fontStyle="italic">état du pipeline</text>
        <text x="360" y="156" textAnchor="middle" fill="#9ca3af" fontSize="10.5" fontFamily="ui-monospace, monospace">articles · embeddings · corroborations · fact_checks</text>
        <text x="360" y="172" textAnchor="middle" fill="#9ca3af" fontSize="10.5" fontFamily="ui-monospace, monospace">topic_anchors · feedback · ml_models · tags · sources</text>

        <line x1="360" y1="184" x2="360" y2="218" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>
        <text x="367" y="204" fill="#6b7280" fontSize="10">pipeline continu (thread polling)</text>

        {/* ── PIPELINE container ── */}
        <rect x="30" y="222" width="660" height="400" rx="10" fill="#0a0e16" stroke="#1f2937" strokeWidth="1.2" strokeDasharray="2 4"/>
        <text x="50" y="242" fill="#6366f1" fontSize="11" fontWeight="600" letterSpacing="0.05em">PIPELINE CONTINU · 5 workers en parallèle</text>

        {/* status: collecte */}
        <rect x="105" y="258" width="90" height="24" rx="12" fill="#1f2937" stroke="#374151" strokeWidth="1"/>
        <text x="150" y="274" textAnchor="middle" fill="#d1d5db" fontSize="11" fontFamily="ui-monospace, monospace">collecte</text>

        <line x1="150" y1="282" x2="150" y2="300" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>

        {/* ① GATE */}
        <rect x="60" y="302" width="380" height="50" rx="6" fill="#111827" stroke="#6366f1" strokeWidth="1.5"/>
        <text x="250" y="322" textAnchor="middle" fill="#e5e7eb" fontSize="12" fontWeight="600">① GATE PERTINENCE</text>
        <text x="250" y="340" textAnchor="middle" fill="#9ca3af" fontSize="10">nomic-embed-text + ancres ± (positive / negative)</text>

        {/* GATE → hors_sujet branch */}
        <line x1="440" y1="325" x2="478" y2="325" stroke="#dc2626" strokeWidth="1.5" markerEnd="url(#ar-red)"/>
        <text x="446" y="318" fill="#dc2626" fontSize="9">marge &lt; t_low</text>

        {/* hors_sujet box */}
        <rect x="480" y="304" width="170" height="42" rx="6" fill="#1f1115" stroke="#7f1d1d" strokeWidth="1.2"/>
        <text x="565" y="320" textAnchor="middle" fill="#fca5a5" fontSize="11" fontWeight="600">hors_sujet</text>
        <text x="565" y="335" textAnchor="middle" fill="#fca5a5" fontSize="9" opacity="0.75">terminal · masqué du feed</text>

        {/* GATE → pertinent */}
        <line x1="150" y1="352" x2="150" y2="372" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>
        <text x="158" y="368" fill="#6b7280" fontSize="9">marge ≥ t_low</text>

        {/* pertinent pill */}
        <rect x="105" y="372" width="90" height="24" rx="12" fill="#1f1b3a" stroke="#4338ca" strokeWidth="1"/>
        <text x="150" y="388" textAnchor="middle" fill="#c7d2fe" fontSize="11" fontFamily="ui-monospace, monospace">pertinent</text>

        <line x1="150" y1="396" x2="150" y2="412" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>

        {/* ② ENRICHEUR */}
        <rect x="60" y="414" width="380" height="42" rx="6" fill="#111827" stroke="#374151" strokeWidth="1.2"/>
        <text x="250" y="432" textAnchor="middle" fill="#e5e7eb" fontSize="12" fontWeight="600">② ENRICHEUR (qwen3.5:9b)</text>
        <text x="250" y="448" textAnchor="middle" fill="#9ca3af" fontSize="10">résumé · tags · verdict pertinence</text>

        <line x1="150" y1="456" x2="150" y2="472" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>

        {/* enrichi pill */}
        <rect x="105" y="472" width="90" height="24" rx="12" fill="#172a3a" stroke="#1e40af" strokeWidth="1"/>
        <text x="150" y="488" textAnchor="middle" fill="#93c5fd" fontSize="11" fontFamily="ui-monospace, monospace">enrichi</text>

        <line x1="150" y1="496" x2="150" y2="512" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>

        {/* ③ SCORER */}
        <rect x="60" y="514" width="380" height="42" rx="6" fill="#111827" stroke="#374151" strokeWidth="1.2"/>
        <text x="250" y="532" textAnchor="middle" fill="#e5e7eb" fontSize="12" fontWeight="600">③ SCORER (qwen3.5 + llama3.2)</text>
        <text x="250" y="548" textAnchor="middle" fill="#9ca3af" fontSize="10">corroboration · fact-check dual · fraîcheur</text>

        <line x1="150" y1="556" x2="150" y2="572" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>

        {/* score pill */}
        <rect x="105" y="572" width="90" height="24" rx="12" fill="#14271d" stroke="#15803d" strokeWidth="1"/>
        <text x="150" y="588" textAnchor="middle" fill="#86efac" fontSize="11" fontFamily="ui-monospace, monospace">score</text>

        {/* score → CLUSTER */}
        <line x1="198" y1="584" x2="475" y2="584" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>

        {/* ④ CLUSTER */}
        <rect x="478" y="566" width="172" height="40" rx="6" fill="#111827" stroke="#374151" strokeWidth="1.2"/>
        <text x="564" y="584" textAnchor="middle" fill="#e5e7eb" fontSize="12" fontWeight="600">④ CLUSTER</text>
        <text x="564" y="598" textAnchor="middle" fill="#9ca3af" fontSize="10">déduplication sémantique</text>

        {/* ── out of pipeline → FEED + ADMIN ── */}
        <line x1="360" y1="622" x2="360" y2="640" stroke="#6366f1" strokeWidth="1.5"/>
        <line x1="180" y1="640" x2="540" y2="640" stroke="#6366f1" strokeWidth="1.5"/>
        <line x1="180" y1="640" x2="180" y2="658" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>
        <line x1="540" y1="640" x2="540" y2="658" stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#ar-indigo)"/>

        {/* FEED */}
        <rect x="80" y="660" width="200" height="72" rx="6" fill="#111827" stroke="#4b5563" strokeWidth="1.2"/>
        <text x="180" y="680" textAnchor="middle" fill="#e5e7eb" fontSize="13" fontWeight="600">FEED (React)</text>
        <text x="180" y="697" textAnchor="middle" fill="#9ca3af" fontSize="10">badges pertinence · 👍 / 👎</text>
        <text x="180" y="711" textAnchor="middle" fill="#9ca3af" fontSize="10">🎯 À trier · recherche · filtres</text>
        <text x="180" y="725" textAnchor="middle" fill="#9ca3af" fontSize="10">tri par incertitude</text>

        {/* ADMIN */}
        <rect x="440" y="660" width="200" height="72" rx="6" fill="#111827" stroke="#4b5563" strokeWidth="1.2"/>
        <text x="540" y="680" textAnchor="middle" fill="#e5e7eb" fontSize="13" fontWeight="600">ADMIN (React)</text>
        <text x="540" y="697" textAnchor="middle" fill="#9ca3af" fontSize="10">monitoring pipeline · sources</text>
        <text x="540" y="711" textAnchor="middle" fill="#9ca3af" fontSize="10">ancres · ML · erreurs détaillées</text>
        <text x="540" y="725" textAnchor="middle" fill="#9ca3af" fontSize="10">statistiques</text>

        {/* feedback arrow FEED → ML */}
        <line x1="180" y1="732" x2="180" y2="768" stroke="#10b981" strokeWidth="1.5" markerEnd="url(#ar-emerald)"/>
        <text x="190" y="755" fill="#10b981" fontSize="10">votes 👍/👎</text>

        {/* ⑤ CLASSIFIEUR ML */}
        <rect x="60" y="770" width="380" height="90" rx="6" fill="#1a132e" stroke="#a855f7" strokeWidth="1.5"/>
        <text x="250" y="792" textAnchor="middle" fill="#e9d5ff" fontSize="13" fontWeight="600">⑤ CLASSIFIEUR ML</text>
        <text x="250" y="810" textAnchor="middle" fill="#c4b5fd" fontSize="11">régression logistique numpy · CPU · zéro VRAM</text>
        <text x="250" y="827" textAnchor="middle" fill="#c4b5fd" fontSize="10">embeddings 768d → ml_relevance (proba 0–100)</text>
        <text x="250" y="843" textAnchor="middle" fill="#c4b5fd" fontSize="10">retrain horaire si nouveaux votes (min 10/classe)</text>

        {/* curved loop-back from ML to DB (active learning closure) */}
        <path
          d="M 440,800 C 690,800 690,140 614,140"
          stroke="#a855f7"
          strokeWidth="1.5"
          fill="none"
          strokeDasharray="4 3"
          markerEnd="url(#ar-purple)"
        />
        <text x="678" y="470" textAnchor="end" fill="#a855f7" fontSize="9" opacity="0.85">
          écrit ml_relevance en base
        </text>
        <text x="678" y="482" textAnchor="end" fill="#a855f7" fontSize="9" opacity="0.7">
          (relu au prochain refresh)
        </text>
      </svg>

      {/* Color legend */}
      <div className="mt-4 pt-3 border-t border-gray-800 text-xs text-gray-500 flex flex-wrap gap-x-5 gap-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 bg-indigo-500"/> flux principal des articles
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 bg-red-600"/> rejet par le gate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 bg-emerald-500"/> feedback humain
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dashed border-purple-500"/> boucle d'apprentissage (asynchrone)
        </span>
      </div>
    </div>
  );
}

/** Glossary entry — definition list row with anchor + highlight on hover. */
function Term({
  name, emphasize, children,
}: {
  name: string;
  emphasize?: boolean;
  children: React.ReactNode;
}) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return (
    <div
      id={`term-${slug}`}
      className={`group rounded-lg border px-4 py-3 transition-colors scroll-mt-24 ${
        emphasize
          ? "bg-gray-900/40 border-indigo-900/40 hover:border-indigo-700/60"
          : "bg-gray-900/20 border-gray-800/60 hover:border-gray-700"
      }`}
    >
      <dt className={`flex items-center gap-2 mb-1.5 ${emphasize ? "text-indigo-300" : "text-gray-200"} font-medium text-sm`}>
        <a
          href={`#term-${slug}`}
          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-indigo-400 transition-opacity text-xs"
          aria-label={`Lien vers ${name}`}
        >
          #
        </a>
        {name}
      </dt>
      <dd className="text-gray-400 leading-relaxed">{children}</dd>
    </div>
  );
}

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

        {/* ── Quick summary for newcomers ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-12">
          <h2 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-3">
            ⚡ Le système en 30 secondes
          </h2>
          <div className="text-sm text-gray-300 leading-relaxed space-y-2">
            <p>
              Ce site surveille automatiquement <strong>l'actualité IA/LLM</strong> depuis ~17 sources
              (arXiv, blogs officiels, Hacker News, Reddit…). Chaque article collecté est évalué sur
              <strong> deux axes indépendants</strong> :
            </p>
            <ul className="list-none space-y-1.5 pl-1">
              <li>
                🎯 <strong className="text-gray-200">La pertinence</strong> — est-ce dans notre sujet de
                veille ? Un filtre par embeddings élimine le spam <em>avant</em> tout traitement coûteux,
                un LLM confirme, et vos votes 👍/👎 affinent le système en continu.
              </li>
              <li>
                🛡️ <strong className="text-gray-200">La confiance</strong> — peut-on s'y fier ? Fiabilité
                de la source + corroboration entre sources indépendantes + double fact-check LLM + fraîcheur.
              </li>
            </ul>
            <p className="text-gray-400">
              Idée clé du projet : <em>« la présence d'une information en plusieurs endroits ne prouve pas
              sa fiabilité »</em> — et son pendant : <em>un article fiable n'est pas forcément pertinent,
              ni l'inverse</em>. D'où deux scores séparés, jamais fusionnés.
            </p>
          </div>
        </div>

        {/* ── 1. Vue d'ensemble ── */}
        <Section id="overview" title="Vue d'ensemble">
          <P>
            Le système est une plateforme de veille technologique sur l'IA et les LLM. Il collecte
            automatiquement des articles depuis des sources hétérogènes (RSS, arXiv, Hacker News),
            les filtre par pertinence, les enrichit via des modèles de langage locaux, calcule un
            score de confiance et les présente dans un feed filtrable.
          </P>

          <Sub title="Architecture globale">
            <P>
              Le système orchestre <strong className="text-gray-300">trois familles de traitements</strong> autour
              d'une base de données unique : un gate géométrique sans LLM (ancres ± + embeddings),
              une chaîne LLM (enrichissement, fact-check dual, clustering) et un classifieur ML
              personnel entraîné sur vos votes. Les boucles humaines bouclent toujours via la base.
            </P>
            <ArchitectureDiagram />
            <p className="text-xs text-gray-600 leading-relaxed mb-4">
              Les 5 étages numérotés sont des workers séparés qui tournent en parallèle dans un
              <code className="text-indigo-300 bg-gray-900 px-1 rounded mx-1">ThreadPoolExecutor</code>. La transition entre étages est
              matérialisée par le champ <code className="text-indigo-300 bg-gray-900 px-1 rounded">articles.status</code> en base —
              chaque flèche pleine correspond à une mise à jour de ce champ.
            </p>
          </Sub>

          <Sub title="Stack technique">
            <Table
              headers={["Composant", "Technologie", "Rôle"]}
              rows={[
                ["Backend",    "FastAPI + Python 3.12",    "API REST, orchestration pipeline"],
                ["Base de données", "MariaDB 11",          "Stockage articles, embeddings (BLOB), tags, ancres, feedback, modèles ML"],
                ["LLM principal", "qwen3.5:9b",            "Enrichissement (résumé + tags + verdict pertinence) + fact-check primaire"],
                ["LLM secondaire", "llama3.2:3b",          "Fact-check secondaire (contre-vérification cross-famille)"],
                ["Embeddings",  "nomic-embed-text",         "Vecteurs sémantiques 768 dim. — articles, ancres de pertinence"],
                ["Gate pertinence", "numpy (pas de LLM)",   "Filtre géométrique sur embeddings vs ancres ± avant tout appel LLM"],
                ["Classifieur ML", "régression logistique numpy", "Apprend la pertinence depuis vos 👍/👎 — CPU, zéro VRAM"],
                ["Scheduler",   "APScheduler",             "Collecte via CronTrigger + pipeline continu (thread)"],
                ["Frontend",    "React 19 + Vite + Tailwind",  "Feed · Admin · ArticleDetail · Docs"],
                ["Déploiement", "Docker Compose",           "Conteneurisation (3 services : db + app + web)"],
              ]}
            />
            <p className="text-xs text-gray-600 leading-relaxed mt-3 mb-4">
              <strong className="text-gray-400">VRAM totale ~11 Go / 16 Go</strong> : qwen3.5 (~5,6 Go) + llama3.2 (~5 Go) + nomic-embed (~0,3 Go).
              Le gate et le classifieur ML tournent sur CPU — ils ne consomment pas de VRAM.
            </p>
          </Sub>
        </Section>

        {/* ── 2. Glossaire ── */}
        <Section id="glossary" title="Glossaire">
          <Tldr>
            Le projet mélange volontairement vocabulaire de veille (corroboration, source, fact-check)
            et de machine learning (embedding, cosinus, marge contrastive, active learning).
            Cette section les fixe une bonne fois pour toutes — toutes les autres sections y renvoient.
          </Tldr>

          <Sub title="Vocabulaire de veille">
            <dl className="space-y-4 text-sm">
              <Term name="Veille technologique">
                Surveillance organisée et continue de l'actualité d'un domaine pour rester informé
                des évolutions importantes. Ici : IA / LLM. Le système automatise la collecte et le
                pré-tri, l'humain reste juge final.
              </Term>
              <Term name="Source" emphasize>
                Un flux d'information identifié (RSS, API). Chaque source a une{" "}
                <em>fiabilité</em> définie manuellement (0–100) qui reflète ses standards éditoriaux —
                arXiv (95), OpenAI Blog (90), un forum Reddit (60), un agrégateur générique (50).
                C'est <strong className="text-gray-300">la composante la plus lourde (40 %)</strong> du score de confiance.
              </Term>
              <Term name="Corroborer" emphasize>
                Confirmer une information en la retrouvant ailleurs, depuis une{" "}
                <strong className="text-gray-300">autre source indépendante</strong>.
                Ici : deux articles corroborent s'ils traitent du même sujet (similarité cosinus
                ≥ 0,85 sur leurs embeddings) et viennent de sources différentes, dans une fenêtre
                de 72 h. <em>Idée clé du projet</em> : la présence d'une information à plusieurs
                endroits ne prouve pas sa fiabilité — il faut que les sources soient
                <strong className="text-gray-300"> réellement indépendantes</strong> (un article republié sur 5
                agrégateurs n'est PAS corroboré). Voir{" "}
                <a href="#corroboration" className="text-indigo-400 hover:text-indigo-300">section Corroboration</a>.
              </Term>
              <Term name="Fact-check">
                Examen des affirmations factuelles (« claims ») d'un article : sont-elles{" "}
                <Badge color="bg-green-900/40 text-green-300">supported</Badge>{" "}
                (attestées, attribuées) /{" "}
                <Badge color="bg-red-900/40 text-red-300">unsupported</Badge>{" "}
                (affirmées sans preuve) /{" "}
                <Badge color="bg-gray-800 text-gray-300">unverifiable</Badge>{" "}
                (opinion, prédiction) /{" "}
                <Badge color="bg-yellow-900/40 text-yellow-300">contested</Badge>{" "}
                (les deux LLM ne sont pas d'accord) ?
                Réalisé par <em>deux</em> LLM indépendants ici, d'où le terme{" "}
                <em>dual LLM fact-check</em>. Voir{" "}
                <a href="#factcheck" className="text-indigo-400 hover:text-indigo-300">section Double vérification LLM</a>.
              </Term>
              <Term name="Confiance vs Pertinence" emphasize>
                Deux axes <strong className="text-gray-300">orthogonaux</strong> et jamais mélangés dans ce système :
                <br/>
                — <strong className="text-emerald-400">Confiance</strong> = « peut-on s'y fier ? »
                (fiabilité de la source × corroboration × fact-check × fraîcheur)
                <br/>
                — <strong className="text-amber-400">Pertinence</strong> = « est-ce dans notre sujet de veille ? »
                (ancres contrastives + verdict LLM + feedback humain)
                <br/>
                Conséquence : un article peut être <em>très fiable mais hors sujet</em> (rapport
                financier d'OpenAI, fiable mais pas IA technique) ou{" "}
                <em>pertinent mais peu fiable</em> (rumeur sur Reddit r/LocalLLaMA). Les deux scores
                restent visibles séparément.
              </Term>
              <Term name="Cluster sémantique">
                Groupe d'articles qui couvrent la même information depuis des sources différentes
                (« GPT-5 sort aujourd'hui » publié par OpenAI Blog + Hacker News + The Decoder).
                Le système élit un article <strong className="text-gray-300">canonique</strong> (le
                mieux scoré) et masque les autres dans le feed par défaut, avec un badge{" "}
                <span className="text-indigo-400">↔ N similar</span>. Voir{" "}
                <a href="#cluster" className="text-indigo-400 hover:text-indigo-300">section Déduplication</a>.
              </Term>
            </dl>
          </Sub>

          <Sub title="Vocabulaire ML / vecteurs">
            <dl className="space-y-4 text-sm">
              <Term name="Embedding" emphasize>
                Représentation numérique d'un texte sous forme de <strong className="text-gray-300">vecteur
                de 768 nombres</strong> (modèle nomic-embed-text). Deux textes au sens proche
                produisent des vecteurs proches. C'est ce qui permet de comparer des articles{" "}
                <em>par le sens</em> et non par les mots exacts — un article qui parle de
                « grand modèle de langage » et un autre qui parle de « LLM » ont des embeddings
                similaires même sans partager un seul mot. Stockés en base dans un BLOB binaire
                (float32 × 768 = 3 072 octets par article).
              </Term>
              <Term name="Similarité cosinus">
                Mesure de similarité entre deux vecteurs : <code className="text-indigo-300 bg-gray-900 px-1 rounded">cos(a, b) = (a · b) / (|a| × |b|)</code>.
                Vaut 1 si les vecteurs pointent dans la même direction, 0 s'ils sont orthogonaux,
                −1 s'ils sont opposés. <strong className="text-gray-300">Insensible à la longueur</strong> des
                textes — c'est pourquoi on l'utilise ici pour comparer des articles de tailles
                très différentes (un tweet de 280 caractères et un papier arXiv de 30 pages).
                Seuil de corroboration : 0,85.
              </Term>
              <Term name="Ancre thématique" emphasize>
                Phrase courte qui décrit explicitement{" "}
                <strong className="text-emerald-400">un aspect du périmètre de veille</strong>{" "}
                (ancre <em>positive</em>) ou{" "}
                <strong className="text-red-400">une catégorie de bruit à exclure</strong> (ancre <em>négative</em>).
                Chaque ancre est embeddée une seule fois ; chaque nouvel article est comparé à
                toutes les ancres actives. Exemples : <em>positive</em> = « large language models,
                LLM releases, benchmarks and evaluations » · <em>négative</em> = « online casino,
                sports betting tips, gambling promotions ». Éditables dans l'Admin.
              </Term>
              <Term name="Marge contrastive" emphasize>
                Le signal de pertinence du gate : <code className="text-indigo-300 bg-gray-900 px-1 rounded">margin = max_cos(ancres positives) − max_cos(ancres négatives)</code>.
                Une marge fortement positive = l'article ressemble bien plus aux sujets de veille
                qu'au bruit ; une marge négative = c'est l'inverse. Pourquoi pas juste la
                similarité aux positives ? Parce qu'<strong className="text-gray-300">elle ne fonctionne pas</strong> sur
                ce corpus (espace cosinus de nomic compressé entre 0,39 et 0,82 — le spam scorait 0,55,
                en plein milieu de la distribution légitime). La marge, elle, sépare proprement.
                Histoire complète dans la <a href="#relevance" className="text-indigo-400 hover:text-indigo-300">section Pertinence</a>.
              </Term>
              <Term name="Régression logistique">
                Le modèle ML utilisé pour le classifieur de pertinence personnel. Prend un
                embedding (768 nombres) en entrée, produit une probabilité (0–1) que l'article
                soit pertinent selon <em>vos</em> votes. Très simple, très rapide à entraîner
                (millisecondes en CPU pur), parfait quand on a peu d'exemples et qu'on veut
                un modèle interprétable. Implémenté ici en numpy pur — pas de dépendance
                scikit-learn.
              </Term>
              <Term name="Active learning" emphasize>
                Stratégie d'entraînement où c'est <strong className="text-gray-300">le modèle qui
                choisit quels exemples</strong> il veut voir étiquetés — concrètement, ceux dont
                il est le moins sûr. Le mode <strong className="text-indigo-300">🎯 À trier</strong> du
                feed implémente cette idée par <em>uncertainty sampling</em> : il vous présente
                en priorité les articles dont la proba prédite est proche de 50 %. Chaque vote
                à cet endroit apprend au modèle bien plus qu'un vote sur un article évident.
              </Term>
              <Term name="Backfill">
                Application rétroactive d'une nouvelle logique à toutes les données existantes.
                Ici : recalculer la pertinence des 4 580 articles d'avant le gate. Le statut
                pipeline (<code className="text-indigo-300 bg-gray-900 px-1 rounded">score</code>) est conservé
                — seule la colonne <code className="text-indigo-300 bg-gray-900 px-1 rounded">relevance</code> est remplie.
              </Term>
            </dl>
          </Sub>

          <Sub title="États du pipeline (statuses)">
            <P>
              Le champ <code className="text-indigo-300 bg-gray-900 px-1 rounded">articles.status</code> matérialise
              la position de l'article dans le pipeline. C'est aussi un mécanisme de claim
              atomique (un seul worker peut faire transiter un article à la fois).
            </P>
            <Table
              headers={["Status", "Sens", "Transition"]}
              rows={[
                [<Badge color="bg-gray-800 text-gray-300">collecte</Badge>,         "Brut, vient d'être inséré",                  "Le gate le prend"],
                [<Badge color="bg-purple-900/40 text-purple-300">pertinent</Badge>,  "A passé le gate — embedding + classification","L'enricher le prend"],
                [<Badge color="bg-yellow-900/40 text-yellow-300">processing</Badge>, "En cours d'enrichissement (verrou)",          "→ enrichi (succès) ou pertinent (échec)"],
                [<Badge color="bg-blue-900/40 text-blue-300">enrichi</Badge>,        "Résumé + tags + verdict pertinence LLM",      "Le scorer le prend"],
                [<Badge color="bg-green-900/40 text-green-300">score</Badge>,        "Score de confiance calculé — état final",     "Visible dans le feed"],
                [<Badge color="bg-red-900/40 text-red-300">hors_sujet</Badge>,       "Écarté (gate ou LLM) — terminal",             "Conservé en base, masqué par défaut"],
              ]}
            />
          </Sub>
        </Section>

        {/* ── 2. Pipeline ── */}
        <Section id="pipeline" title="Pipeline de traitement">
          <P>
            Le pipeline est continu — un thread dédié tourne en permanence et traite les
            articles dès qu'ils arrivent dans la base. Chaque article transite par 6{" "}
            <a href="#glossary" className="text-indigo-400 hover:text-indigo-300">statuts</a>{" "}
            (voir tableau dans le glossaire),
            le passage étant matérialisé par le champ{" "}
            <code className="text-indigo-300 bg-gray-900 px-1 rounded">articles.status</code>.
          </P>

          <Sub title="États d'un article">
            <Table
              headers={["Status", "Signification", "Transition suivante"]}
              rows={[
                [<Badge color="bg-gray-800 text-gray-300">collecte</Badge>,    "Vient d'être collecté, brut",                  "Le gate de pertinence le prend en charge"],
                [<Badge color="bg-purple-900/40 text-purple-300">pertinent</Badge>, "A passé le gate (embedding + ancres)",     "L'enricher le prend en charge"],
                [<Badge color="bg-yellow-900/40 text-yellow-300">processing</Badge>, "En cours d'enrichissement",               "→ enrichi si succès, retour à pertinent si échec"],
                [<Badge color="bg-blue-900/40 text-blue-300">enrichi</Badge>,  "Résumé + tags + verdict pertinence LLM",        "Le scorer le prend en charge"],
                [<Badge color="bg-green-900/40 text-green-300">score</Badge>,  "Score de confiance calculé, visible",           "État final — affiché dans le feed"],
                [<Badge color="bg-red-900/40 text-red-300">hors_sujet</Badge>, "Écarté par le gate ou le LLM (spam, hors veille)", "État final — conservé en base, masqué du feed"],
              ]}
            />
            <P>
              Les articles <Badge color="bg-red-900/40 text-red-300">hors_sujet</Badge> ne sont
              <strong className="text-gray-300"> jamais supprimés</strong> : principe de veille — rater une
              information importante (faux négatif) coûte plus cher que tolérer du bruit. Ils restent
              auditables via la case "Show off-topic" du feed, et un 👍 les réintègre.
            </P>
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
    lancer en parallèle : gate×1 + enricher×3 + scorer×3 + embedder×1 + cluster×1
    attendre que tous les workers terminent
    si rien à traiter → dormir 15 secondes
    sinon             → cycle suivant immédiatement

→ Dès qu'un article est collecté, il est traité dans les secondes qui suivent.
→ Aucune latence d'attente de tick cron pour le pipeline.`}</Code>
          </Sub>

          <Sub title="Étape 2 — Gate de pertinence (nomic-embed-text, aucun LLM)">
            <P>
              Premier filtre après la collecte : l'article est vectorisé (titre + début du contenu)
              et comparé aux <strong className="text-gray-300">ancres thématiques</strong> du périmètre
              de veille. Le spam évident part en <Badge color="bg-red-900/40 text-red-300">hors_sujet</Badge> ici,
              <strong className="text-gray-300"> avant</strong> de consommer les 3 appels LLM
              (1 enrichissement + 2 fact-check). Détail complet dans la section{" "}
              <a href="#relevance" className="text-indigo-400 hover:text-indigo-300">Pertinence & filtrage</a>.
              L'embedding produit ici est réutilisé ensuite pour la corroboration.
            </P>
          </Sub>

          <Sub title="Étape 3 — Enrichissement (qwen3.5:9b, 3 workers en parallèle)">
            <P>
              Le worker réclame un lot d'articles atomiquement (passage <code className="text-indigo-300 bg-gray-900 px-1 rounded">pertinent → processing</code>)
              puis appelle qwen3.5:9b pour chaque article. Le prompt v2 demande résumé, tags
              <strong className="text-gray-300"> et verdict de pertinence</strong> — le deuxième signal
              de pertinence, sans appel LLM supplémentaire.
            </P>
            <Code>{`Prompt enrichissement (v2) :
"You are a technical assistant for a technology watch on AI/ML/LLMs.
Reply ONLY with JSON:
{"summary": "...", "tags": [...],
 "relevance": "on_topic|borderline|off_topic", "relevance_reason": "..."}"

→ Le résumé est stocké dans articles.summary
→ Les tags sont normalisés (voir section Tags)
→ Le verdict relevance est fusionné avec celui du gate (voir section Pertinence)`}</Code>
          </Sub>

          <Sub title="Étape 4 — Scoring (3 workers en parallèle)">
            <P>
              Calcule le score de confiance sur 100 en combinant 4 composantes. Voir la section
              dédiée ci-dessous pour la formule complète. Les appels LLM (fact-check) tournent en
              parallèle, mais l'écriture des résultats <code className="text-indigo-300 bg-gray-900 px-1 rounded">fact_checks</code> est{" "}
              <strong className="text-gray-300">sérialisée + ré-essayée</strong> entre les 3 workers
              (voir <a href="#monitoring" className="text-indigo-400 hover:text-indigo-300">Monitoring & erreurs</a>)
              pour éviter les deadlocks.
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

        {/* ── 2b. Pertinence ── */}
        <Section id="relevance" title="Pertinence & filtrage">
          <Tldr>
            « Est-ce dans notre sujet de veille ? » est une question différente de « peut-on s'y
            fier ? ». Le système y répond avec trois signaux successifs : un filtre géométrique
            instantané (ancres), un avis LLM gratuit, et vos votes 👍/👎 qui entraînent un
            classifieur personnel.
          </Tldr>

          <Sub title="Pourquoi un axe séparé de la confiance ?">
            <P>
              Audit réel du 12/06/2026 : la source Dev.to AI (628 articles) contenait ~50 % de spam
              pur — <em>« Buy Verified PayPal Accounts »</em>, pronostics UFC, spa à New York… Ces
              articles obtenaient des <strong className="text-gray-300">scores de confiance moyens
              (44–57)</strong> : la confiance mesure la fiabilité, pas le sujet. Chaque spam consommait
              en plus 3 appels LLM. D'où un axe « pertinence » orthogonal, avec son propre cycle de vie.
            </P>
          </Sub>

          <Sub title="Signal 1 — Ancres contrastives (gate, avant tout LLM)">
            <P>
              Le périmètre de veille est défini par des phrases-ancres <strong className="text-emerald-400">positives</strong> (« large
              language models, releases, benchmarks… ») et <strong className="text-red-400">négatives</strong> (« comptes
              PayPal à vendre, casino, spa… » — les catégories de bruit observées). Éditables dans
              l'Admin, embarquées une seule fois chacune.
            </P>
            <Code>{`marge = max_cos(article, ancres_positives) − max_cos(article, ancres_négatives)

marge < −0.12          → off_topic   (statut hors_sujet, 0 appel LLM)
−0.12 ≤ marge < +0.05  → borderline  (continue, le LLM tranchera)
marge ≥ +0.05          → on_topic    (continue)`}</Code>
            <P>
              <strong className="text-yellow-400">Pourquoi une marge et pas un simple seuil ?</strong>{" "}
              C'est un résultat de calibration mesuré sur les 4 568 articles du corpus : le cosinus
              absolu ne sépare PAS le spam (l'espace nomic est compressé — le spam PayPal scorait
              0.55, en plein milieu de la distribution légitime, et les pires scores absolus étaient…
              des articles légitimes en chinois). La marge contrastive, elle, isole proprement le
              spam : tout le spam connu &lt; −0.12, tout le légitime observé &gt; −0.10. Hypothèse →
              mesure → pivot : la démarche complète est documentée dans le DEVLOG (session 16).
            </P>
          </Sub>

          <Sub title="Signal 2 — Verdict LLM (gratuit, à l'enrichissement)">
            <P>
              Pour tout ce qui passe le gate, le prompt d'enrichissement (déjà payé) retourne aussi
              <code className="text-indigo-300 bg-gray-900 px-1 rounded"> relevance</code> +
              une justification d'une phrase. Fusion des deux signaux :
            </P>
            <Table
              headers={["Gate (embedding)", "LLM", "Bucket final", "Statut"]}
              rows={[
                ["on_topic / borderline", "on_topic",   <Badge color="bg-green-900/40 text-green-300">on_topic</Badge>, "enrichi → score"],
                ["on_topic / borderline", "borderline", <Badge color="bg-yellow-900/40 text-yellow-300">borderline</Badge>, "enrichi → score (affiché, flaggé)"],
                ["borderline",            "off_topic",  <Badge color="bg-red-900/40 text-red-300">off_topic</Badge>, "hors_sujet (jamais scoré)"],
                ["on_topic",              "off_topic",  <Badge color="bg-yellow-900/40 text-yellow-300">borderline</Badge>, "désaccord → affiché mais flaggé"],
                ["—",                     "illisible",  "bucket du gate", "—"],
              ]}
            />
            <P>
              En cas de désaccord fort, on n'écarte jamais silencieusement : l'article reste visible
              avec le badge borderline (faux négatif &gt; faux positif).
            </P>
          </Sub>

          <Sub title="Signal 3 — Vos votes 👍/👎 (active learning)">
            <P>
              Chaque carte du feed a des boutons 👍/👎. Un vote agit <strong className="text-gray-300">immédiatement</strong>{" "}
              (👎 masque l'article, 👍 le réintègre — l'humain gagne toujours) et alimente un
              <strong className="text-gray-300"> classifieur personnel</strong> : une régression logistique
              (numpy pur, CPU, entraînement en millisecondes — zéro VRAM) sur les embeddings 768d déjà stockés.
            </P>
            <P>
              Le mode <strong className="text-indigo-300">🎯 À trier</strong> du feed est la partie
              « active » : il présente en priorité les articles où le classifieur hésite le plus
              (probabilité ~50 %) — c'est là que chaque vote lui apprend le maximum. Le modèle se
              ré-entraîne automatiquement chaque heure si de nouveaux votes existent (min. 10 exemples
              par classe), ou manuellement depuis l'Admin.
            </P>
          </Sub>

          <Sub title="Comment lire le feed">
            <Table
              headers={["Élément", "Signification"]}
              rows={[
                [<Badge color="bg-amber-950 text-amber-400">borderline</Badge>, "Pertinence incertaine — l'article est affiché mais flaggé ; votre vote aide"],
                [<Badge color="bg-red-950 text-red-400">hors sujet</Badge>, "Classé hors veille — visible uniquement avec la case « Show off-topic »"],
                ["(pas de badge)", "on_topic — le cas normal, pas de bruit visuel"],
                ["👍 / 👎", "Votre verdict — corrige le classement immédiatement + entraîne le classifieur"],
                ["🎯 À trier", "File des articles incertains non votés, triés par incertitude décroissante"],
              ]}
            />
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
              dans une fenêtre de 72 heures <strong className="text-gray-300">centrée sur la date de
              collecte de l'article</strong> (±72h, pas « maintenant » — un vieil article retrouve ainsi
              ses contemporains lors d'un re-scoring). La similarité est calculée par cosinus sur les
              vecteurs d'embedding (seuil : <strong className="text-gray-300">0.78</strong>, calibré pour
              l'espace cosinus compressé de nomic).
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
              La fenêtre de 72h et le seuil cosinus 0.78 sont configurables via les variables
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
              Moyenne de deux sous-scores distincts : la <strong className="text-gray-300">récence</strong> (date
              de publication) et la <strong className="text-gray-300">complétude</strong> (métadonnées).
              Historiquement les deux étaient mélangés dans une somme opaque dont le maximum réel
              était 85/100 — ils sont désormais séparés et le détail est visible sur la page article.
              La récence utilise des <strong className="text-gray-300">planchers</strong> (40 pour les
              vieux articles, 50 si la date est inconnue) plutôt que 0 : re-scorer un vieil article ne
              fait plus s'effondrer son score.
            </P>
            <Code>{`freshness = (recency + completeness) / 2`}</Code>
            <Table
              headers={["Sous-score", "Critère", "Valeur"]}
              rows={[
                ["Récence",    "Publié < 24h",                 "100"],
                ["Récence",    "Publié < 3 jours",             "80"],
                ["Récence",    "Publié < 7 jours",             "65"],
                ["Récence",    "Publié < 30 jours",            "50"],
                ["Récence",    "> 30 jours",                   "40 (plancher)"],
                ["Récence",    "Date inconnue",                "50"],
                ["Complétude", "Auteur identifié",             "+40"],
                ["Complétude", "Contenu > 500 caractères",     "+60"],
                ["Complétude", "Contenu entre 100 et 500 car.","+25"],
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
  3. Si sim ≥ 0.78 → B corrobore A
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
            <P>
              <strong className="text-yellow-400">Seuil découplé du scoring :</strong> le clustering
              n'utilise <em>pas</em> le seuil de corroboration 0.78 mais un seuil plus strict{" "}
              <code className="text-indigo-300 bg-gray-900 px-1 rounded">CLUSTER_COSINE_THRESHOLD = 0.88</code>{" "}
              (reposts quasi identiques uniquement). Avec 0.78 partagé, la fermeture transitive
              chaînait des articles <em>même-thème</em> (pas même-histoire) en méga-clusters — un blob
              de 360 articles OpenAI — qui aurait vidé le feed. À 0.88 la taille max de cluster retombe
              à ~6, et les articles couvrant le même évènement mais rédigés différemment ne fusionnent
              pas (ce ne sont pas des doublons) : ils portent à la place un <em>score</em> de
              corroboration élevé.
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

        {/* ── 8b. Monitoring & erreurs ── */}
        <Section id="monitoring" title="Monitoring & erreurs">
          <P>
            Le pipeline tourne en continu sur trois workers concurrents par étape : des erreurs
            transitoires (deadlock DB, timeout LLM) sont normales. Plutôt que d'empiler des tracebacks
            bruts, le moniteur <strong className="text-gray-300">classe chaque erreur par cause et par
            gravité</strong> et fait ressortir le <strong className="text-gray-300">plus gros
            responsable</strong>. Les erreurs réellement transitoires sont ré-essayées et n'apparaissent
            même pas.
          </P>

          <Sub title="Le moniteur (page Admin)">
            <P>
              Le bandeau « pipeline errors since startup » indique la <strong className="text-gray-300">cause
              principale</strong>. Dépliée, la carte montre une <strong className="text-gray-300">répartition
              par cause</strong> (barres + %, triée par fréquence) puis les dernières erreurs sous forme de
              cartes <strong className="text-gray-300">colorées selon la gravité</strong> — résumé lisible en
              clair, traceback technique replié dans un <code className="text-indigo-300 bg-gray-900 px-1 rounded">détail</code> sur demande.
              Les compteurs sont en mémoire (remis à zéro au redémarrage du conteneur).
            </P>
          </Sub>

          <Sub title="Échelle de gravité">
            <Table
              headers={["Gravité", "Sens", "Exemple"]}
              rows={[
                [<Badge color="bg-slate-700/60 text-slate-300">transitoire</Badge>, "Auto-récupéré — ré-essayé avec succès, sans impact", "Deadlock DB résolu au retry"],
                [<Badge color="bg-amber-900/50 text-amber-300">avertissement</Badge>, "Dégradé mais le pipeline continue (fallback / retry de l'article)", "Timeout LLM, JSON LLM invalide"],
                [<Badge color="bg-red-900/50 text-red-300">erreur</Badge>, "L'article échoue cette étape ; re-tenté jusqu'au plafond", "Ollama injoignable, connexion DB perdue"],
                [<Badge color="bg-red-700/70 text-red-100">critique</Badge>, "Échec répété — article parqué", "error_count ≥ MAX_PIPELINE_ATTEMPTS"],
              ]}
            />
          </Sub>

          <Sub title="Catégories d'erreurs">
            <Table
              headers={["Catégorie", "Origine"]}
              rows={[
                ["db_deadlock / db_lock_timeout", "Verrous concurrents MySQL (1213/1020/1205) — transitoire, ré-essayé"],
                ["db_connection / db_error",      "Connexion DB perdue ou autre erreur SQL"],
                ["llm_timeout",                   "Délai dépassé sur un appel Ollama (httpx)"],
                ["llm_json",                      "Réponse du modèle non parsable (JSON) → fallback dégradé"],
                ["llm_unavailable",               "Ollama injoignable ou en erreur 5xx"],
                ["http_error",                    "Erreur HTTP sur une requête externe"],
                ["unknown",                       "Exception non classée (fallback)"],
              ]}
            />
          </Sub>

          <Sub title="Résilience : retry deadlock + articles parqués">
            <P>
              <strong className="text-gray-300">Deadlock fact_checks.</strong> Les 3 workers de scoring
              écrivent dans la même table <code className="text-indigo-300 bg-gray-900 px-1 rounded">fact_checks</code>.
              Les appels LLM (lents) tournent en parallèle, mais la courte écriture
              (DELETE + INSERT + commit) est <strong className="text-gray-300">sérialisée par un verrou</strong>{" "}
              puis <strong className="text-gray-300">ré-essayée avec backoff</strong> en cas de deadlock
              (codes 1213/1020/1205) : un deadlock résolu au retry n'est pas compté comme erreur.
            </P>
            <P>
              <strong className="text-gray-300">Articles parqués.</strong> Chaque échec d'étape incrémente{" "}
              <code className="text-indigo-300 bg-gray-900 px-1 rounded">articles.error_count</code> et mémorise{" "}
              <code className="text-indigo-300 bg-gray-900 px-1 rounded">last_error</code>. Après{" "}
              <code className="text-indigo-300 bg-gray-900 px-1 rounded">MAX_PIPELINE_ATTEMPTS</code> (3) échecs
              consécutifs, l'article est <strong className="text-gray-300">parqué</strong> (plus réclamé par les
              workers) pour ne pas boucler indéfiniment ; un succès remet le compteur à 0 (les erreurs
              transitoires s'auto-réparent). Les articles parqués sont listés dans l'Admin avec
              re-traitement (<code className="text-indigo-300 bg-gray-900 px-1 rounded">reprocess</code>) ou
              suppression à l'unité.
            </P>
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
                ["GET", "/articles/{id}", "Détail + score breakdown + fact-checks + pertinence"],
                ["GET", "/articles/tags/popular", "Top N tags avec comptage"],
                ["PUT", "/articles/{id}/feedback", "Verdict humain 👍/👎 (body: {verdict})"],
                ["DELETE", "/articles/{id}/feedback", "Retirer le verdict (bucket recalculé)"],
                ["POST", "/articles/{id}/reprocess", "Re-traiter un article parqué/en erreur (reset collecte, error_count=0)"],
                ["DELETE", "/articles/{id}", "Supprimer l'article + lignes dépendantes (corroborations, fact-checks, embeddings, tags)"],
              ]}
            />
            <Code>{`# Paramètres GET /articles
?search=llm            # Recherche plein texte (titre, résumé, tags)
&tags=llm&tags=ai      # Filtre multi-tags (OR)
&min_score=70          # Score de confiance minimum
&source=3              # ID de source
&relevance=borderline  # Filtre par bucket de pertinence
&show_off_topic=true   # Afficher les hors-sujet (masqués par défaut)
&sort_by=confidence_score&sort_dir=desc
&sort_by=uncertainty   # File "à trier" (articles incertains non votés)
&deduplicate=true      # Masquer les doublons de cluster (défaut: true)
&limit=50&offset=0     # Pagination`}</Code>
          </Sub>

          <Sub title="Pertinence (ancres & ML)">
            <Table
              headers={["Méthode", "Endpoint", "Description"]}
              rows={[
                ["GET",    "/relevance/anchors",      "Liste des ancres (positives + négatives)"],
                ["POST",   "/relevance/anchors",      "Ajouter une ancre {phrase, polarity}"],
                ["PATCH",  "/relevance/anchors/{id}", "Modifier / activer / désactiver"],
                ["DELETE", "/relevance/anchors/{id}", "Supprimer"],
                ["GET",    "/relevance/model",        "État du classifieur ML (feedbacks, accuracy)"],
                ["POST",   "/relevance/retrain",      "Ré-entraîner le classifieur maintenant"],
              ]}
            />
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
                ["GET", "/stats/admin",  "Monitoring complet : pipeline, débit/ETA, erreurs par cause + gravité, articles parqués, distribution"],
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
