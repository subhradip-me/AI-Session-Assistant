/**
 * LLM Provider Router
 *
 * Centralises all routing decisions for which AI provider handles a given job.
 * Workers call getProvider() — they never hard-code a provider name.
 *
 * Current strategy: 70% Groq / 30% Gemini weighted random split.
 * This distributes load across both free-tier quotas and reduces the chance
 * of hitting one provider's rate limit.
 *
 * Future providers to plug in here (no worker changes needed):
 *   - OpenRouter (cloud aggregator)
 *   - Ollama / LM Studio (local LLM)
 *   - Anthropic Claude
 *   - OpenAI GPT-4o
 */

// ── Provider weights ─────────────────────────────────────────────────────────
const PROVIDERS = {
  groq:   0.70,   // 70% — primary (faster, higher TPM on free tier)
  gemini: 0.30    // 30% — secondary (higher daily limit on free tier)
};

/**
 * Returns a provider name based on weighted probability.
 * @returns {"groq" | "gemini"}
 */
export function getProvider() {
  const rand = Math.random();
  let cumulative = 0;

  for (const [name, weight] of Object.entries(PROVIDERS)) {
    cumulative += weight;
    if (rand < cumulative) return name;
  }

  // Fallback (floating-point edge case)
  return "groq";
}

/**
 * Returns all configured provider names.
 * @returns {string[]}
 */
export function listProviders() {
  return Object.keys(PROVIDERS);
}

export default { getProvider, listProviders };
