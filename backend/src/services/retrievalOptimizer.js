import RetrievalFeedback from "../models/RetrievalFeedback.js";
import AIAnalysisService  from "./AIAnalysisService.js";

/**
 * retrievalOptimizer — Block Ranking + Self-Learning Feedback
 *
 * Two responsibilities:
 *
 *   1. RANKING: Score retrieved blocks by intelligence depth so the LLM
 *      gets the richest blocks, not just the most similar ones.
 *
 *   2. FEEDBACK: Auto-rate answer quality via LLM and store the signal
 *      in RetrievalFeedback for future reinforcement learning.
 *
 * The scoring formula weights decisions highest (most actionable), then
 * insights (non-obvious), then action items (concrete). Topics are
 * excluded from scoring because they're present in almost every block.
 */

// ─── Scoring weights ──────────────────────────────────────────────────────────

const WEIGHTS = {
  insights:     2,
  decisions:    3,
  action_items: 2
};

/**
 * Score a single block by intelligence depth.
 * Higher score = block contains more actionable, non-obvious information.
 *
 * @param {object} block - Block object with insights[], decisions[], action_items[]
 * @returns {number}
 */
export function scoreBlock(block) {
  return (
    (block.insights?.length     ?? 0) * WEIGHTS.insights     +
    (block.decisions?.length    ?? 0) * WEIGHTS.decisions    +
    (block.action_items?.length ?? 0) * WEIGHTS.action_items
  );
}

/**
 * Re-rank retrieved blocks by intelligence depth score descending.
 * Combines the original ANN similarity score with the intelligence depth
 * score to balance relevance + richness.
 *
 * @param {Array}  blocks  - Retrieved block objects (from retrieverService)
 * @param {number} [topK]  - How many to return after ranking (default: 3)
 * @returns {Array}        - Re-ranked blocks (best = richest + most relevant)
 */
export function rankBlocks(blocks, topK = 3) {
  return blocks
    .map(b => ({
      ...b,
      _rankScore: (b.score ?? 0) * 10 + scoreBlock(b)
    }))
    .sort((a, b) => b._rankScore - a._rankScore)
    .slice(0, topK);
}

// ─── Adaptive retrieval filter by intent ──────────────────────────────────────

/**
 * Build a Qdrant payload filter hint based on query intent.
 * Currently used as metadata for logging / future Qdrant filter injection.
 * Returns a hint object describing what signal to prioritise.
 *
 * @param {string} intent
 * @returns {object} { boostField: string | null }
 */
export function buildRetrievalHint(intent) {
  const map = {
    decision:         { boostField: "decisions"    },
    action_items:     { boostField: "action_items" },
    deep_explanation: { boostField: "insights"     },
    trend:            { boostField: "topics"       },
    summary:          { boostField: null           },
    question_answer:  { boostField: null           }
  };
  return map[intent] ?? { boostField: null };
}

// ─── Self-learning feedback capture ───────────────────────────────────────────

/**
 * Auto-score the quality of an answer using LLM evaluation.
 * Rating: 1 (poor/hallucinated) → 5 (excellent/specific/insightful)
 *
 * @param {string} question - The user's question
 * @param {string} answer   - The generated answer
 * @param {string} intent   - Detected intent
 * @returns {Promise<number>} Rating 1–5 (defaults to 3 on failure)
 */
async function autoRate(question, answer, intent) {
  const prompt = `Rate the quality of this AI answer on a scale from 1 to 5.

Question: ${question}
Intent:   ${intent}
Answer:   ${answer.slice(0, 600)}

Rating criteria:
5 = Excellent. Direct, specific, non-obvious insights. Fully addresses intent.
4 = Good. Mostly specific, minor gaps.
3 = Average. Addresses the question but lacks depth or specificity.
2 = Weak. Generic or vague. Does not deeply address the intent.
1 = Poor. Hallucinated, off-topic, or completely misses the intent.

RESPOND WITH ONLY A SINGLE DIGIT (1, 2, 3, 4, or 5). Nothing else.`;

  try {
    const raw    = await AIAnalysisService.groqChat(prompt, 0.1);
    const rating = parseInt(raw.trim().charAt(0));
    return (rating >= 1 && rating <= 5) ? rating : 3;
  } catch {
    return 3; // Default neutral score on LLM failure
  }
}

/**
 * Capture retrieval feedback asynchronously.
 * Rates the answer quality and stores a RetrievalFeedback doc.
 * This is always called non-blocking — never awaited by chatWorker.
 *
 * @param {object} params
 * @param {string}   params.userId
 * @param {string}   params.mediaId
 * @param {string}   params.query           - The rewritten query sent to retrieval
 * @param {string}   params.intent          - Detected intent
 * @param {Array}    params.retrievedBlocks - Blocks that were retrieved
 * @param {string}   params.answer          - The generated answer
 */
export async function captureFeedback({ userId, mediaId, query, intent, retrievedBlocks, answer }) {
  if (!userId) return; // Skip for anonymous sessions

  try {
    const rating = await autoRate(query, answer, intent);

    const blockIds = retrievedBlocks
      .map(b => b.blockId)
      .filter(id => typeof id === "number");

    await RetrievalFeedback.create({
      userId,
      mediaId,
      query,
      intent,
      retrievedBlockIds: blockIds,
      rating,
      answer: answer.slice(0, 1000) // Store first 1000 chars only
    });

    console.log(`📈 retrievalOptimizer: feedback stored for ${userId} — rating: ${rating}/5 (intent: ${intent})`);
  } catch (err) {
    // Never let feedback failure surface to the user
    console.warn(`⚠️  retrievalOptimizer: captureFeedback failed (${err.message})`);
  }
}
