import { embed } from "./embeddingService.js";
import { searchVector } from "./vectorService.js";

/**
 * Retrieve the most relevant blocks for a given query within a session.
 *
 * Enhancement: Topic Boosting (hybrid retrieval)
 *   - If any topic stored in a block payload matches a keyword in the query,
 *     its score is boosted by +0.1 before re-ranking.
 *   - Final list is sorted by boosted score and capped at the top 3 results.
 *
 * @param {string} mediaId   - Session identifier
 * @param {string} query     - User's natural language question
 * @param {number} [topK=3]  - Number of results to return
 * @returns {Promise<Array<{ score: number, mediaId: string, blockId: number, topics: string[] }>>}
 */
export async function retrieve(mediaId, query, topK = 3) {
  // 1. Convert query text → embedding vector
  const queryVector = await embed(query);

  // 2. ANN search in Qdrant (returns up to 10 candidates)
  const results = await searchVector(queryVector, mediaId);

  if (!results || results.length === 0) return [];

  const queryLower = query.toLowerCase();

  // 3. Apply topic boost + re-rank
  const ranked = results
    .map((r) => {
      let boost = 0;

      // Keyword overlap between query and stored block topics
      if (r.payload?.topics?.some(t => queryLower.includes(t.toLowerCase()))) {
        boost += 0.1;
      }

      return {
        score: (r.score ?? 0) + boost,
        ...r.payload
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return ranked;
}