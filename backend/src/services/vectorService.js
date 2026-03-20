import { QdrantClient } from "@qdrant/js-client-rest";
import { v5 as uuidv5 } from "uuid";

const client = new QdrantClient({
    url: process.env.QDRANT_URL || "http://localhost:6333"
});

// ─── Collection names ──────────────────────────────────────────────────────────
export const BLOCK_COLLECTION   = "session_blocks";
export const SEGMENT_COLLECTION = "session_segments";

// All collections use 768-dim nomic-embed-text vectors with Cosine distance
const VECTOR_SIZE = 768;

// Namespace UUID for deterministic point ID generation (fixed, do not change)
const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * Convert an arbitrary string key into a deterministic UUID
 * suitable for use as a Qdrant point ID.
 */
function toPointId(key) {
    return uuidv5(key, NAMESPACE);
}

// ─── Generic collection helpers ────────────────────────────────────────────────

/**
 * Ensure a named Qdrant collection exists with the correct dimensions.
 * Safe to call multiple times — no-ops if the collection already exists.
 *
 * @param {string} name - Collection name (use BLOCK_COLLECTION / SEGMENT_COLLECTION)
 */
export async function initCollectionByName(name) {
    const result = await client.getCollections();
    const found  = result.collections.find(c => c.name === name);
    if (found) return;

    await client.createCollection(name, {
        vectors: {
            size:     VECTOR_SIZE,
            distance: "Cosine"
        }
    });

    console.log(`✅ Qdrant collection "${name}" created (${VECTOR_SIZE}-dim Cosine)`);
}

/**
 * Upsert a single vector into the specified collection.
 *
 * @param {string}   collection - Target collection name
 * @param {string}   id        - Logical string key (converted to deterministic UUID)
 * @param {number[]} vector    - Embedding vector (must match collection dimensions)
 * @param {object}   payload   - Metadata stored alongside the vector (for filtering/context)
 */
export async function insertVectorToCollection(collection, id, vector, payload) {
    await client.upsert(collection, {
        points: [
            {
                id:      toPointId(id),
                vector,
                payload
            }
        ]
    });
}

/**
 * ANN search within a named collection, filtered to a specific session.
 * When userId is provided, an additional user-scope filter is applied so
 * one user can never retrieve another user's vectors.
 *
 * @param {string}   collection - Collection name to search
 * @param {number[]} vector     - Query embedding vector
 * @param {string}   mediaId    - Session filter
 * @param {number}   [limit=10] - Maximum candidates to return
 * @param {string}   [userId]   - Optional: restrict results to this user
 * @returns {Promise<Array>}    - Qdrant search results
 */
export async function searchVectorInCollection(collection, vector, mediaId, limit = 10, userId = null) {
  const mustFilters = [
    {
      key:   "mediaId",
      match: { value: mediaId }
    }
  ];

  // 🔒 Critical security gate: when userId is provided, only vectors owned
  // by that user are returned — prevents cross-tenant data leakage.
  if (userId) {
    mustFilters.push({
      key:   "userId",
      match: { value: userId }
    });
  }

  return client.search(collection, {
    vector,
    limit,
    filter: { must: mustFilters }
  });
}

// ─── Backward-compatible wrappers (used by existing code — do not remove) ──────

/** @deprecated Use initCollectionByName(BLOCK_COLLECTION) */
export async function initCollection() {
    return initCollectionByName(BLOCK_COLLECTION);
}

/** @deprecated Use insertVectorToCollection(BLOCK_COLLECTION, ...) */
export async function insertVector(id, vector, payload) {
    return insertVectorToCollection(BLOCK_COLLECTION, id, vector, payload);
}

/** @deprecated Use searchVectorInCollection(BLOCK_COLLECTION, ...) */
export async function searchVector(vector, mediaId) {
    return searchVectorInCollection(BLOCK_COLLECTION, vector, mediaId, 10);
}