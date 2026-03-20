import { embed } from "./embeddingService.js";
import {
  searchVectorInCollection,
  BLOCK_COLLECTION,
  SEGMENT_COLLECTION
} from "./vectorService.js";
import { rankBlocks } from "./retrievalOptimizer.js";

/**
 * Multi-layer RAG retriever with intent-aware ranking.
 *
 * Retrieves context from two Qdrant collections in parallel:
 *   1. session_blocks   — BlockAnalysis embeddings (~12-min chunks)
 *   2. session_segments — SegmentAnalysis embeddings (~90-s fine-grained detail)
 *
 * Ranking pipeline (blocks):
 *   1. ANN similarity search (Qdrant)
 *   2. Topic keyword boost (+0.1) if topics ∩ query keywords
 *   3. Intelligence depth ranking via retrievalOptimizer.rankBlocks()
 *      — weights decisions×3, insights×2, action_items×2
 *      — blocks with more actionable content rank above shallow ones
 *
 * Ranking pipeline (segments):
 *   1. ANN similarity search (Qdrant)
 *   2. Topic keyword boost (+0.1)
 *   3. Redundancy dampening (−0.05) for segments in already-retrieved blocks
 *
 * Query vector nudging (personalization — when userMemory provided):
 *   The query vector is lightly nudged toward the user's historical topic
 *   profile (alpha = 0.12). This shifts the semantic search toward the
 *   user's known interests without overriding the literal query.
 *
 * @param {string}  mediaId
 * @param {string}  query
 * @param {number}  [topKBlocks=3]
 * @param {number}  [topKSegments=3]
 * @param {string}  [userId=null]
 * @param {object}  [userMemory=null]  - UserMemory doc (for vector nudging)
 * @returns {Promise<{ blocks: Array, segments: Array }>}
 */
export async function retrieve(
  mediaId,
  query,
  topKBlocks   = 3,
  topKSegments = 3,
  userId       = null,
  userMemory   = null
) {
  // ── 1. Embed query ─────────────────────────────────────────────────────────
  let queryVector = await embed(query);

  // ── 2. Personalized vector nudging (Level 1 — prompt-augmented embedding) ──
  // If the user has historical interests, nudge the query vector slightly
  // toward their profile so retrieval naturally gravitates to their domain.
  if (userMemory?.topics?.length >= 3) {
    const profileText   = userMemory.topics.slice(0, 5).join(" ");
    const profileVector = await embed(profileText);

    const ALPHA  = 0.12; // 12% personal preference, 88% literal query
    queryVector  = queryVector.map((v, i) => v * (1 - ALPHA) + profileVector[i] * ALPHA);

    console.log(`🎯 retrieverService: query vector nudged with user profile (α=${ALPHA})`);
  }

  const queryLower = query.toLowerCase();

  // ── 3. Parallel ANN search in both collections ─────────────────────────────
  const [blockResults, segmentResults] = await Promise.all([
    searchVectorInCollection(BLOCK_COLLECTION,   queryVector, mediaId, 5, userId).catch(() => []),
    searchVectorInCollection(SEGMENT_COLLECTION, queryVector, mediaId, 5, userId).catch(() => [])
  ]);

  // ── 4. Topic boost on block results ───────────────────────────────────────
  const boostedBlocks = blockResults.map(r => {
    const boost = r.payload?.topics?.some(t =>
      queryLower.includes(t.toLowerCase())
    ) ? 0.1 : 0;

    return {
      score: (r.score ?? 0) + boost,
      type:  "block",
      ...r.payload
    };
  });

  // ── 5. Intelligence depth ranking (NEW) ────────────────────────────────────
  // Re-ranks by combining ANN score with content richness score.
  // This means a block with 3 decisions + 2 insights ranks above an equally
  // similar block that only has topics. Richer blocks = better answers.
  const rankedBlocks = rankBlocks(boostedBlocks, topKBlocks);

  // Set of blockIds already captured by the block layer (for dedup dampening)
  const retrievedBlockIds = new Set(rankedBlocks.map(b => b.blockId));

  // ── 6. Topic boost + redundancy dampening on segment results ───────────────
  const rankedSegments = segmentResults
    .map(r => {
      let boost = 0;

      if (r.payload?.topics?.some(t => queryLower.includes(t.toLowerCase()))) {
        boost += 0.1;
      }

      if (r.payload?.blockId != null && retrievedBlockIds.has(r.payload.blockId)) {
        boost -= 0.05;
      }

      return {
        score: (r.score ?? 0) + boost,
        type:  "segment",
        ...r.payload
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topKSegments);

  return { blocks: rankedBlocks, segments: rankedSegments };
}