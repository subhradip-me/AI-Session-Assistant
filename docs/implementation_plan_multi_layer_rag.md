# Multi-Layer RAG Retriever for Chat

## Background

The current chat pipeline has a **single retrieval layer**: it embeds and searches only `BlockAnalysis` documents (8-segment rollups) in one Qdrant collection (`session_blocks`). This is efficient but lossy — fine-grained segment details are dropped, and the global session context is only a static header.

The goal is a **3-layer context window**:

| Layer | Source | Granularity | Role |
|---|---|---|---|
| Global | `SessionContext` | Whole session | Anchors answer to the full session picture |
| Block | `BlockAnalysis` (existing) | 8 segments ≈ ~12 min | High-level thematic chunks |
| Segment | `SegmentAnalysis` (new) | 1 grouped segment ≈ ~90 s | Fine-grained detail for specific facts |

**Cost discipline**: no new paid services. Reuses existing Ollama/Qdrant. Only numeric `segmentId` rows (Path B full-transcript) are embedded — Path A window-based String IDs are skipped entirely.

---

## Proposed Changes

### Qdrant / Vector Layer

#### [MODIFY] [vectorService.js](file:///d:/ai-meeting-assistant/backend/src/services/vectorService.js)

- Add `SEGMENT_COLLECTION = "session_segments"` constant
- Add generic `initCollectionByName(name)`, `insertVectorToCollection(col, id, vec, payload)`, `searchVectorInCollection(col, vec, mediaId, limit)` helpers
- Keep old `initCollection()`, `insertVector()`, `searchVector()` as thin wrappers → zero breaking changes

---

### Embedding Layer

#### [MODIFY] [embeddingWorker.js](file:///d:/ai-meeting-assistant/backend/workers/embeddingWorker.js)

- On startup, also init `session_segments` Qdrant collection
- Dispatch on `job.data.type`:
  - `"block"` (default/missing) — existing logic, unchanged
  - `"segment"` — fetch `SegmentAnalysis`, embed into `session_segments`
- Segment payload: `{ mediaId, segmentId, topics, summary, blockId }`
- Cost guard: `if (typeof segmentId !== "number") return` — Path A window-ID strings skipped

#### [MODIFY] [blockAggregatorWorker.js](file:///d:/ai-meeting-assistant/backend/workers/blockAggregatorWorker.js)

- After the block embedding job, also enqueue one `embed-segment` job per segmentId in the block
- `jobId: embed-seg-${mediaId}-${segmentId}` for BullMQ dedup
- Same embedding queue, no new queue needed

---

### Retrieval Layer

#### [MODIFY] [retrieverService.js](file:///d:/ai-meeting-assistant/backend/src/services/retrieverService.js)

- ONE `embed(query)` call shared across both searches
- Block search (limit 5) + segment search (limit 5) run in parallel
- Topic boost (+0.1) applied independently to each set
- If a segment is in an already-retrieved block, reduce boost by 0.05
- Returns `{ blocks: top-3, segments: top-3 }` (typed)

New signature: `retrieve(mediaId, query, topKBlocks=3, topKSegments=3)`

---

### Context Builder

#### [MODIFY] [contextBuilder.js](file:///d:/ai-meeting-assistant/backend/src/services/contextBuilder.js)

New 3-section structure:
```
[SECTION 1] Session Overview — SessionContext (summary + topics + insights)
[SECTION 2] Relevant Discussion Blocks — BlockAnalysis (full detail)
[SECTION 3] Supporting Segment Details — SegmentAnalysis (summary + topics + actions)
```

New signature: `buildContext(mediaId, { blocks, segments })`

---

### Chat Worker

#### [MODIFY] [chatWorker.js](file:///d:/ai-meeting-assistant/backend/workers/chatWorker.js)

- Destructure `{ blocks, segments }` from `retrieve()`
- Pass typed object to `buildContext(mediaId, { blocks, segments })`
- Log: `Retrieved N block(s), M segment(s)`
- Update prompt to name all three context layers

---

## Verification Plan

### Log Inspection
After uploading a file, `embeddingWorker` logs should show:
- `Embedded block N` (as before)
- `Embedded segment N` (new, 8x quantity of blocks)

### Qdrant Check
`GET http://localhost:6333/collections` — should show both `session_blocks` and `session_segments`.

### Chat Quality
```json
POST /api/chat
{ "mediaId": "session_<id>", "question": "What specific commands were discussed?" }
```
Worker log: `Retrieved 3 block(s), 3 segment(s)`
