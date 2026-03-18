import { QdrantClient } from "@qdrant/js-client-rest";
import { v5 as uuidv5 } from "uuid";

const client = new QdrantClient({
    url: process.env.QDRANT_URL || "http://localhost:6333"
});

const COLLECTION = "session_blocks";

// Namespace UUID for deterministic point ID generation
const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * Convert an arbitrary string key into a deterministic UUID
 * suitable for use as a Qdrant point ID.
 */
function toPointId(key) {
    return uuidv5(key, NAMESPACE);
}

export async function initCollection() {
    // getCollections() returns { collections: [{ name, ... }, ...] }
    const result = await client.getCollections();

    const found = result.collections.find(c => c.name === COLLECTION);
    if (found) return;

    await client.createCollection(COLLECTION, {
        vectors: {
            size: 768,
            distance: "Cosine"
        }
    });

    console.log(`✅ Qdrant collection "${COLLECTION}" created`);
}

export async function insertVector(id, vector, payload) {
    await client.upsert(COLLECTION, {
        points: [
            {
                id: toPointId(id),
                vector,
                payload
            }
        ]
    });
}

export async function searchVector(vector, mediaId) {
    return client.search(COLLECTION, {
        vector,
        limit: 10,
        filter: {
            must: [
                {
                    key: "mediaId",
                    match: {
                        value: mediaId
                    }
                }
            ]
        }
    });
}