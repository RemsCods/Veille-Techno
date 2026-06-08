import struct
from typing import Optional
import httpx
from config import settings


def chat(prompt: str, system: Optional[str] = None) -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    resp = httpx.post(
        f"{settings.ollama_host}/api/chat",
        json={
            "model": settings.ollama_chat_model,
            "messages": messages,
            "stream": False,
            "think": False,        # disable Qwen3 thinking mode (CoT tokens = 2min overhead)
            "options": {
                "num_predict": 512,  # cap output tokens — summary+tags fit in 512
            },
        },
        timeout=60,
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
