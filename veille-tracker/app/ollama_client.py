import struct
from typing import Optional
import httpx
from config import settings


def chat(prompt: str, system: Optional[str] = None) -> str:
    """Chat with the default chat model (qwen3.5)."""
    return chat_with_model(prompt, settings.ollama_chat_model, system)


def chat_with_model(
    prompt: str,
    model: str,
    system: Optional[str] = None,
    max_tokens: int = 512,
) -> str:
    """Chat with an explicit Ollama model. Used for dual-model fact-checking."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    resp = httpx.post(
        f"{settings.ollama_host}/api/chat",
        json={
            "model": model,
            "messages": messages,
            "stream": False,
            "think": False,        # disable thinking/CoT mode if supported
            "options": {
                "num_predict": max_tokens,
            },
        },
        timeout=90,   # gemma4 may take slightly longer to load on first call
    )
    resp.raise_for_status()
    return resp.json()["message"]["content"]


def embed(text: str) -> list[float]:
    resp = httpx.post(
        f"{settings.ollama_host}/api/embeddings",
        json={"model": settings.ollama_embed_model, "prompt": text[:4000]},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def vector_to_bytes(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def bytes_to_vector(b: bytes) -> list[float]:
    n = len(b) // 4
    return list(struct.unpack(f"{n}f", b))
