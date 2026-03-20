import AIAnalysisService from "./AIAnalysisService.js";

/**
 * intentService — Query Intent Classification + Rewriting
 *
 * Two-function service that upgrades the chat pipeline from "similarity search"
 * to "purpose-driven search":
 *
 *   1. detectIntent(query)           — classifies user intent into one of 6 labels
 *   2. rewriteQuery(query, intent, userMemory) — makes query semantically richer
 *      for ANN retrieval by injecting intent framing and user profile context
 *
 * Both use groqChat() at very low temperature for maximum consistency.
 * Both are fail-safe: fall back to defaults on any LLM error.
 */

const VALID_INTENTS = new Set([
  "summary",
  "deep_explanation",
  "decision",
  "action_items",
  "question_answer",
  "trend"
]);

/**
 * Classify the user's query into one of 6 intent buckets.
 * The intent drives both retrieval filtering and context emphasis.
 *
 * @param {string} query - The raw user question
 * @returns {Promise<string>} One of: summary | deep_explanation | decision |
 *                            action_items | question_answer | trend | unknown
 */
export async function detectIntent(query) {
  const prompt = `Classify the user query into EXACTLY ONE of these intent labels:
- summary         → wants a high-level overview or recap
- deep_explanation → wants detailed understanding of a concept
- decision        → asking about choices, decisions, or conclusions reached
- action_items    → asking about tasks, next steps, or things to do
- question_answer → asking a specific factual question
- trend           → asking about patterns, recurring themes, or changes over time

Query: "${query}"

CRITICAL: Respond with ONLY the label. No explanation. No punctuation. Just the label word.`;

  try {
    const raw    = await AIAnalysisService.groqChat(prompt, 0.1);
    const intent = raw.trim().toLowerCase().replace(/[^a-z_]/g, "");

    if (VALID_INTENTS.has(intent)) {
      return intent;
    }

    // Partial match fallback
    for (const label of VALID_INTENTS) {
      if (intent.includes(label)) return label;
    }

    console.warn(`⚠️  intentService: unrecognised intent "${raw}" — defaulting to question_answer`);
    return "question_answer";

  } catch (err) {
    console.warn(`⚠️  intentService: detectIntent failed (${err.message}) — defaulting`);
    return "question_answer";
  }
}

/**
 * Rewrite the user query to be semantically richer for ANN retrieval.
 * Injects intent framing + user memory profile into the embedding query
 * so the vector search lands in the right semantic zone even when the
 * raw question is short or ambiguous.
 *
 * @param {string} query      - Original user question
 * @param {string} intent     - Detected intent label
 * @param {object} userMemory - UserMemory document (can be null)
 * @returns {Promise<string>} Rewritten query string
 */
export async function rewriteQuery(query, intent, userMemory = null) {
  const memoryContext = userMemory?.topics?.length
    ? `User's known interests: ${userMemory.topics.slice(0, 5).join(", ")}.`
    : "";

  const prompt = `Rewrite the following query to be more specific and semantically rich for retrieval.

Intent: ${intent}
${memoryContext}
Original query: "${query}"

Rules:
- Keep the original meaning exactly — do NOT change what is being asked
- Make it more specific and descriptive (more words = better embeddings)
- If intent is "decision" → emphasise "decisions made, conclusions reached, choices"
- If intent is "action_items" → emphasise "tasks, next steps, responsibilities, owners"
- If intent is "summary" → emphasise "overview, key themes, main points"
- If intent is "deep_explanation" → emphasise "explanation, how it works, why"
- If intent is "trend" → emphasise "patterns, recurring, over time, trends"
- Incorporate the user's known interests ONLY IF directly relevant
- Return ONLY the rewritten query. No explanation. No quotes.`;

  try {
    const rewritten = await AIAnalysisService.groqChat(prompt, 0.2);
    const cleaned   = rewritten.trim().replace(/^["']|["']$/g, "");

    console.log(`🔄 intentService: "${query}" → "${cleaned}" (${intent})`);
    return cleaned || query;

  } catch (err) {
    console.warn(`⚠️  intentService: rewriteQuery failed (${err.message}) — using original`);
    return query;
  }
}
