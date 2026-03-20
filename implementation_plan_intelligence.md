# Intelligence Layer Upgrade — Implementation Plan

## Summary

This plan upgrades the AI Session Assistant from a **smart RAG system** into an **adaptive intelligence engine**. The upgrade adds five new capability layers on top of the existing pipeline, with zero breaking changes to the hot path.

---

## System Analysis

### What Exists Today

The current pipeline already has a strong 3-layer RAG architecture:

| Layer | Implementation | Gap |
|---|---|---|
| Retrieval | `retrieverService.js` — parallel block + segment search + topic boost | Retrieves by **similarity only**, not by user intent purpose |
| Context | `contextBuilder.js` — 3-layer: SessionContext + BlockAnalysis + SegmentAnalysis | Context is a "raw dump" — no user intent, no cross-session memory |
| LLM | `chatWorker.js` → `AIAnalysisService.groqChat()` | Prompt is good but single-step (no reasoning layer) |
| Memory | ❌ None | System forgets everything after session ends |
| Learning | ❌ None | No feedback loop — retrieval stays static forever |

### Key Integration Points

- `insightAggregatorWorker.js` emits `SESSION_INTELLIGENCE_READY` and has `userId` from job data → **perfect hook for memory update**
- `retrieverService.js` exports `retrieve(mediaId, query, topKBlocks, topKSegments, userId)` → **already userId-aware**
- `chatWorker.js` receives `{ mediaId, question, userId }` → **userId available for all new features**
- `AIAnalysisService.groqChat(prompt, temperature)` is a plain text LLM call → **reuse for intent detection + query rewriting**
- `vectorService.js` `searchVectorInCollection` has optional userId filter → **security already in place**

---

## New Files to Create

### Models

#### [NEW] `src/models/UserMemory.js`
```
{ userId, topics: [String], insights: [String], lastUpdated: Date }
```
- One document per user (upsert pattern)
- Accumulates topics and insights across ALL sessions for that user
- Used by `contextBuilder.js` as the "long-term memory" layer

#### [NEW] `src/models/RetrievalFeedback.js`
```
{ userId, query, intent, retrievedBlockIds: [Number], rating: Number (1–5), createdAt: Date }
```
- Stores the quality rating of each chat answer (auto-scored by LLM)
- Foundation for future reinforcement learning and vector re-weighting

---

### Services

#### [NEW] `src/services/memoryService.js`
- `updateMemory(userId, intelligence)` — merges topics + insights from a session into `UserMemory`
- Uses `Set` deduplication to avoid growth explosion
- Called by `insightAggregatorWorker` after SESSION_INTELLIGENCE_READY

#### [NEW] `src/services/intentService.js`
- `detectIntent(query)` — calls LLM, classifies query into one of 6 intents:
  `summary | deep_explanation | decision | action_items | question_answer | trend`
- `rewriteQuery(query, intent, userMemory)` — rewrites the query using intent + user memory to make it more semantically specific for retrieval
- Returns plain text (uses `AIAnalysisService.groqChat`) 

#### [NEW] `src/services/retrievalOptimizer.js`
- `scoreBlock(block)` — scores a block by depth: `insights×2 + decisions×3 + action_items×2`
- `rankBlocks(blocks)` — sorts by score descending, slices top 5
- `buildFilter(intent)` — returns Qdrant payload filter hints based on intent (e.g., `decision` → boost blocks with `decisions` field)

---

## Files to Modify

### `src/services/contextBuilder.js`
**Change**: Accept `(mediaId, retrieved, userId, intent)` signature.  
**Add at top of context**: USER MEMORY block (topics + insights from `UserMemory.findOne({ userId })`).  
**Add after memory block**: `USER INTENT: <intent>` line.  
**Existing 3-layer context**: kept intact, just follows the new header.

### `src/services/retrieverService.js`
**Change**: Accept `intent` as a new optional parameter.  
**Add**: Call `rankBlocks()` from `retrievalOptimizer` on block results before returning.  
**Add**: Query rewriting is done _before_ calling `retrieve()` so no change needed inside `retrieve` itself for that.

### `workers/insightAggregatorWorker.js`
**Change**: After the `reportQueue.add()` call, call `updateMemory(userId, intelligence)` from `memoryService`.  
**Guard**: Only run if `userId` is defined (memory is optional for anonymous sessions).

### `workers/chatWorker.js`
This is the main orchestration file. Changes in order:

1. **Import** `detectIntent`, `rewriteQuery` from `intentService.js`
2. **Import** `rankBlocks` from `retrievalOptimizer.js`
3. **Step 0** (new): Detect intent from the `question`
4. **Step 0b** (new): Rewrite query using intent + user memory
5. **Step 1** (existing): Use the rewritten query instead of raw question for `retrieve()`
6. **Step 2** (existing): Pass `userId` + `intent` to `buildContext()`
7. **Step 3** (existing): Upgrade the prompt to include intent, deep-analysis instructions
8. **Step 4** (existing): Generate answer (unchanged)
9. **Step 5** (new): Auto-score answer quality via LLM (non-blocking, no await blocking response)
10. **Step 6** (new): Store `RetrievalFeedback` (non-blocking)

**Upgraded prompt design** — the LLM receives:
- `USER INTENT: <intent>` — tells the LLM what to optimize for
- Deep instructions: extract non-obvious insights, connect ideas, reference timestamps
- Exact answer format: direct answer + key insights bullets + decisions/actions if applicable

---

## Architecture Impact

```
[BEFORE]
User Query → retrieve(session) → buildContext → prompt → answer

[AFTER]
User Query
  ↓
Intent Detection          ← NEW (intentService)
  ↓
Query Rewriting           ← NEW (intentService — uses UserMemory + intent)
  ↓
Retrieve (rewritten query) + Ranking Layer   ← UPGRADED (retrievalOptimizer)
  ↓
Build Context (UserMemory + Intent + 3-layer blocks/segments)  ← UPGRADED (contextBuilder)
  ↓
Upgraded Prompt (intent-aware, deep-reasoning instructions)    ← UPGRADED (chatWorker)
  ↓
Answer
  ↓ (async, non-blocking)
Auto-score answer quality + store RetrievalFeedback            ← NEW (retrievalOptimizer + RetrievalFeedback)

[MEMORY UPDATE PATH — separate from chat]
SESSION_INTELLIGENCE_READY
  ↓
updateMemory(userId, intelligence)                             ← NEW (memoryService)
  ↓
UserMemory.topics/insights merged + saved                      ← NEW (UserMemory model)
```

---

## What You Will Notice After This

| Before | After |
|---|---|
| System knows only the current session | System remembers topics + insights across ALL your sessions |
| Retrieval = keyword similarity only | Retrieval = intent-aware + ranked by depth score |
| Context = raw dump of summaries | Context = USER MEMORY + INTENT + structured blocks |
| LLM prompt = generic "answer this" | LLM prompt = role + intent + depth instructions |
| No feedback loop | Every answer is auto-scored and stored for future learning |
| Answer quality: consistent but shallow | Answer quality: deeper, more connected, more specific |

---

## ⚠️ Important Design Decisions

> [!IMPORTANT]
> **Memory accumulation without decay**: Right now UserMemory will grow without limit. This is by design for Phase 1 — we accumulate first, rank/decay later. The plan mentions future ranking and summarization. Memory is capped implicitly by MongoDB document size (~16MB) which won't be hit for years of normal use.

> [!NOTE]
> **No breaking changes**: The `userId` field is already present in the chat query job data. All new features gracefully degrade when `userId` is null (memory = empty, feedback = skipped).

> [!NOTE]
> **LLM cost for intent**: Intent detection adds 1 extra LLM call per chat query. This uses `groqChat` at very low temperature (0.1) and the prompt is 5 lines, so it is the cheapest possible call. Query rewriting adds another small call.

---

## Verification Plan

### Automated Checks (no test framework currently)

Since there are no existing test files in the project, verification will be done by:

1. **Startup check**: Restart all workers — look for no crash on import (new models/services loaded cleanly).

2. **Memory update check** (manual):
   - Upload a short audio/video file through the existing UI
   - Wait for pipeline to complete (SESSION_INTELLIGENCE_READY in logs)
   - Run in MongoDB shell:
     ```
     db.usermemories.find({})
     ```
   - Expected: a document with topics + insights from the session

3. **Intent detection check** (manual):
   - Make a POST to `/api/chat` with `{ "mediaId": "...", "question": "What were the key decisions?", "userId": "..." }`
   - Check `chatWorker` logs for: `🎯 Intent detected: decision`
   - Check logs for: `🔄 Rewritten query: ...`

4. **Memory in context check** (manual):
   - After at least 1 session processed, make a chat query
   - Check logs: `🧠 UserMemory found: X topics, Y insights`
   - The LLM answer should reference cross-session topics if topics overlap

5. **RetrievalFeedback check** (manual):
   - After a chat query, run:
     ```
     db.retrievalfeedbacks.find({})
     ```
   - Expected: a document with `rating`, `intent`, `query`, `retrievedBlockIds`

6. **Context structure check** (logs):
   - The `contextBuilder` will log the first 200 chars of the context
   - Verify "USER MEMORY" and "USER INTENT" appear before "Session Overview"
