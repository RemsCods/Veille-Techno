"""
Tag normalization for consistent tagging across all collectors.

Problems solved:
- Same concept stored under multiple spellings: "llms", "large language model", "LLM"
- Tags that are just noise: "the", "a", "new"
- Punctuation variants: "fine-tuning" vs "finetuning" vs "fine_tuning"
- Plural/singular inconsistency: "transformers" vs "transformer"

Usage:
    from tag_normalizer import normalize_tag
    clean = normalize_tag("Large Language Models")  # → "llm"
    clean = normalize_tag("the")                    # → None  (reject)
"""

import re
from typing import Optional

# ── Stopwords ─────────────────────────────────────────────────────────────────
# Tags that are meaningless on their own — reject them entirely.
STOP_WORDS: frozenset[str] = frozenset({
    "the", "a", "an", "and", "or", "for", "in", "on", "of", "with",
    "this", "that", "to", "is", "are", "was", "were", "be", "been",
    "it", "its", "by", "at", "as", "from", "about", "new", "via",
    "using", "based", "paper", "study", "research", "update", "release",
    "introduction", "overview", "summary", "analysis", "review",
    "article", "post", "blog", "news",
})

# ── Synonym map ───────────────────────────────────────────────────────────────
# Maps various spellings → canonical form.
# Keys are already lowercased & stripped.
SYNONYMS: dict[str, str] = {
    # LLM
    "llms":                       "llm",
    "large language model":       "llm",
    "large language models":      "llm",
    "large-language-model":       "llm",
    "large-language-models":      "llm",
    "large language":             "llm",

    # GPT variants
    "gpt-4":                      "gpt4",
    "gpt-4o":                     "gpt4o",
    "gpt 4":                      "gpt4",
    "gpt-3.5":                    "gpt3.5",
    "gpt-3":                      "gpt3",
    "gpt 3":                      "gpt3",

    # Common AI
    "artificial intelligence":    "ai",
    "machine-learning":           "machine learning",
    "machine_learning":           "machine learning",
    "deep-learning":              "deep learning",
    "deep_learning":              "deep learning",

    # Neural networks
    "neural network":             "neural networks",
    "neural-network":             "neural networks",
    "neural-networks":            "neural networks",
    "neural net":                 "neural networks",
    "neural nets":                "neural networks",

    # RL
    "reinforcement learning":     "rl",
    "reinforcement-learning":     "rl",
    "reinforcement_learning":     "rl",

    # Fine-tuning
    "finetuning":                 "fine-tuning",
    "fine_tuning":                "fine-tuning",
    "fine tuning":                "fine-tuning",

    # RAG
    "retrieval augmented generation":  "rag",
    "retrieval-augmented generation":  "rag",
    "retrieval augmented":             "rag",

    # Open source
    "open source":                "open-source",
    "opensource":                 "open-source",
    "open_source":                "open-source",

    # Orgs
    "huggingface":                "hugging face",
    "hugging-face":               "hugging face",

    # NLP
    "natural language processing": "nlp",
    "natural-language-processing": "nlp",

    # Generative AI
    "generative ai":              "generative-ai",
    "gen ai":                     "generative-ai",
    "genai":                      "generative-ai",

    # Embeddings (keep plural for the concept, singular for a single object)
    "embeddings":                 "embedding",
    "word embeddings":            "embedding",
    "vector embeddings":          "embedding",

    # Transformers (model architecture, not the library)
    "transformers":               "transformer",

    # Inference
    "model inference":            "inference",

    # Multimodal
    "multi-modal":                "multimodal",
    "multi modal":                "multimodal",

    # Computer vision
    "computer-vision":            "computer vision",

    # Agents
    "ai agents":                  "agents",
    "llm agents":                 "agents",

    # Benchmark
    "benchmarks":                 "benchmark",
    "benchmarking":               "benchmark",

    # Dataset
    "datasets":                   "dataset",
    "training data":              "dataset",

    # Safety / Alignment
    "ai safety":                  "ai safety",
    "ai alignment":               "alignment",
    "ai ethics":                  "ethics",
    "responsible ai":             "ethics",
}


def normalize_tag(name: str) -> Optional[str]:
    """
    Normalize a tag name.

    Returns:
        Cleaned canonical name, or None if the tag should be rejected.
    """
    if not name:
        return None

    # 1. Lowercase & trim
    name = name.strip().lower()

    # 2. Remove characters that are clearly noise (keep letters, digits, space, hyphen)
    name = re.sub(r"[^\w\s\-]", "", name)   # \w = [a-z0-9_], keep hyphen and space
    name = re.sub(r"_", " ", name)           # underscores → spaces
    name = re.sub(r"\s+", " ", name).strip() # collapse whitespace

    if not name:
        return None

    # 3. Apply synonym mapping (before stop word check, to catch multi-word synonyms)
    name = SYNONYMS.get(name, name)

    # 4. Reject stop words and very short tags
    if name in STOP_WORDS:
        return None
    if len(name) < 2:
        return None

    # 5. Reject tags that are purely numeric (e.g. "2024", "42")
    if name.isdigit():
        return None

    return name


def normalize_tag_list(raw_tags: list[str]) -> list[str]:
    """
    Normalize a list of tags, deduplicate, and remove None values.
    Preserves order of first occurrence.
    """
    seen: set[str] = set()
    result: list[str] = []
    for raw in raw_tags:
        clean = normalize_tag(raw)
        if clean and clean not in seen:
            seen.add(clean)
            result.append(clean)
    return result
