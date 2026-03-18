// Node.js v18+ has native fetch built-in — no external package needed.

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

/**
 * Embed text using Ollama (nomic-embed-text → 768 dimensions).
 *
 * @param {string} text - Input text to embed
 * @returns {Promise<number[]>} 768-dimensional float vector
 */
export async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBED_MODEL,
      prompt: text
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama embedding failed (${res.status}): ${body}`);
  }

  const data = await res.json();

  if (!data.embedding || !Array.isArray(data.embedding)) {
    throw new Error(`Ollama returned unexpected response: ${JSON.stringify(data)}`);
  }

  return data.embedding; // 768-dim vector
}