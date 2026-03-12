# AI Session Assistant — Architecture Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Technology Stack](#technology-stack)
4. [Core Components](#core-components)
5. [Pipeline Flow](#pipeline-flow)
6. [Global Session Context](#global-session-context)
7. [API Reference](#api-reference)
8. [Worker Processes](#worker-processes)
9. [Services Documentation](#services-documentation)
10. [LLM Call Optimization](#llm-call-optimization)
11. [Configuration](#configuration)
12. [Future Enhancements](#future-enhancements)

---

## System Overview

The AI Session Assistant is an event-driven pipeline that processes video/audio recordings and produces structured session intelligence — including transcripts, speaker segments, topics, decisions, and action items. The system uses a microservices-like architecture with distributed BullMQ workers, Redis queues, Kafka event streaming, and MongoDB persistence.

### Key Features
- **Multi-format Media Processing**: Supports video and audio uploads
- **Automatic Audio Extraction**: Uses FFmpeg to extract audio from video
- **Chunked Processing**: Splits audio into 30-second chunks for parallel transcription
- **AI Transcription**: Whisper.cpp integration for local speech-to-text
- **Speaker Diarization**: Assigns and labels speaker segments with timestamps
- **Transcript Cleaning**: Strips noise markers and deduplicates segments
- **Segment Grouping**: Combines cleaned segments into analysis-ready windows
- **AI Segment Analysis**: Groq Llama 3.3 70B extracts topics, insights, decisions, and action items per segment
- **Session Intelligence**: Aggregates and deduplicates all segment analyses into a final report
- **Global Context Layer**: Full-transcript document-level analysis running in parallel with diarization
- **Event-Driven**: Kafka topics broadcast pipeline progress in real time
- **Scalable**: BullMQ queues with Redis allow parallel workers and auto-retry
- **Persistent Storage**: MongoDB stores transcripts, analyses, and intelligence

---

## Architecture Diagram

```
+------------------------------------------------------------------+
|                          CLIENT LAYER                             |
|                     (Upload Video/Audio)                          |
+-----------------------------+------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                     API SERVER (Express)                          |
|                     POST /api/upload                              |
+-----------------------------+------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                     UPLOAD CONTROLLER                             |
|   1. Generate mediaId (session_<timestamp>)                       |
|   2. Extract audio via FFmpeg                                     |
|   3. Split into 30s chunks via FFmpeg                             |
|   4. Upload chunks to MinIO (bucket: session-files)               |
|   5. Emit CHUNK_CREATED Kafka events                              |
|   6. Enqueue transcription jobs in Redis                          |
+----------+-----------------------------------+-------------------+
           |                                   |
           v                                   v
+------------------+                 +------------------+
|   MinIO Storage  |                 |   Kafka Broker   |
|  (chunk .wavs)   |                 | (event streaming)|
+------------------+                 +------------------+
                                               |
                                               v
                                     +------------------+
                                     |   Redis / BullMQ |
                                     |  (job queues)    |
                                     +--------+---------+
                                              |
           +----------------------------------+
           |                                  |
           v                                  v
  +-----------------+               +----------------------+
  |  TRANSCRIPTION  |               |     AGGREGATION      |
  |     WORKER      +-------------->+       WORKER         |
  |  (whisper.cpp)  |  all chunks   |  (merge chunk txts)  |
  +-----------------+   done        +----------+-----------+
                                               |
                              TRANSCRIPT_READY emitted
                                               |
                    +-------------------------++--------------------------+
                    |                                                     |
                    v                                                     v
       +----------------------+                         +-------------------------+
       |   DIARIZATION WORKER |                         |  GLOBAL CONTEXT WORKER  |
       |  (assign speakers +  |                         |  (chunk transcript ->   |
       |    timestamps)       |                         |   LLM -> SessionContext)|
       +----------+-----------+                         +-------------------------+
                  |                                          GLOBAL_CONTEXT_READY
                  v
       +----------------------+
       |   CLEANER WORKER     |
       |  (strip noise,       |
       |   deduplicate)       |
       +----------+-----------+
                  |
                  v
       +----------------------+
       |   GROUPER WORKER     |
       |  (3-5 sentence       |
       |   windows)           |
       +----------+-----------+
                  |  (one job per segment)
      +-----------+-----------+
      |           |           |
      v           v           v
+----------+ +----------+ +----------+
| ANALYSIS | | ANALYSIS | | ANALYSIS |
|DISPATCHER| |DISPATCHER| |DISPATCHER|
|(llmQueue)| |(llmQueue)| |(llmQueue)|
+----+-----+ +----+-----+ +----+-----+
      +-----------+-----------+
                  |
                  v
         +--------------------+
         |    llm-calls       |
         |   BullMQ Queue     |
         |  max 20 req / 60s  |
         +--------+-----------+
                  |  concurrency: 2
         +--------+-----------+
         |                    |
         v                    v
   +-----------+      +-----------+
   |    LLM    |      |    LLM    |
   |  ROUTER   |      |  ROUTER   |
   |  WORKER   |      |  WORKER   |
   | (70% Groq)|      | (30% Gem) |
   +-----+-----+      +-----+-----+
         +----------+----------+
                    |  all segments done
                    v
       +----------------------+
       |  INSIGHT AGGREGATOR  |
       |       WORKER         |
       |  (1) merge segments  |
       |  (2) seed from       |
       |      SessionContext  |
       |  (3) dedup (Set+LLM) |
       +----------+-----------+
                  |
                  v
       +----------------------+
       | SESSION_INTELLIGENCE |
       |    _READY (Kafka)    |
       +----------------------+
```

---

## Technology Stack

| Category | Technology | Version |
|---|---|---|
| Runtime | Node.js | v18+ |
| Web Framework | Express.js | v5.2.1 |
| Module System | ES Modules | — |
| Job Queues | BullMQ | v5.70.4 |
| Redis Client | ioredis | v5.10.0 |
| Event Streaming | kafkajs | v2.2.4 |
| Database | mongoose (MongoDB) | v9.2.4 |
| Object Storage | minio | v8.0.7 |
| AI Transcription | Whisper.cpp | local binary |
| AI Analysis (primary) | Groq SDK (Llama 3.3 70B) | v0.37.0 |
| AI Analysis (fallback) | Google Generative AI (Gemini 2.0 Flash) | v0.24.0 |
| Audio Processing | FFmpeg | system install |
| File Upload | multer | v2.1.1 |

---

## Core Components

### 1. Upload Controller
`src/controllers/UploadController.js`

Orchestrates the entire ingest phase:
- Accepts `multipart/form-data` file uploads via Multer
- Generates `mediaId` as `session_<Date.now()>`
- Calls `AudioService` → `ChunkService` → `StorageService`
- Emits one `CHUNK_CREATED` Kafka event and one `transcriptionQueue` BullMQ job per chunk

### 2. Services
`src/services/`

| Service | Method | Purpose |
|---|---|---|
| `AudioService` | `extractAudio(videoPath)` | FFmpeg: extracts `.wav` from video |
| `ChunkService` | `splitAudio(audioPath)` | FFmpeg: segments audio into 30s `.wav` chunks |
| `StorageService` | `uploadChunks(chunkDir, mediaId, totalChunks)` | Uploads chunks to MinIO (`session-files` bucket), triggers Kafka + Redis |
| `WhisperService` | `transcribe(audioPath)` | Runs `whisper-cli.exe`, returns transcript text |
| `TranscriptService` | `saveChunk / merge / isComplete` | File I/O for per-chunk txts and final merge |
| `SpeakerService` | `process(mediaId, transcript)` | Coordinates diarization, saves to MongoDB |
| `SpeakerSegmentationService` | `segment(transcript)` | Splits into sentences, alternates speaker IDs, estimates timestamps |
| `TranscriptCleaner` | `cleanSegments(segments)` | Strips `[noise]` markers, normalises whitespace, deduplicates |
| `SegmentGrouper` | `groupSegments(segments)` | Groups 3-5 cleaned segments into analysis windows |
| `AIAnalysisService` | `analyze(text, previousContext)` | Per-segment: Groq→Gemini fallback, returns structured JSON (deprecated path) |
| `AIAnalysisService` | `analyzeGroq(text, previousContext)` | Calls Groq directly — used by llmWorker for routed calls |
| `AIAnalysisService` | `analyzeGemini(text, previousContext)` | Calls Gemini directly — used by llmWorker for routed calls |
| `AIAnalysisService` | `analyzeGlobal(text)` | Per-chunk global analysis: topics, insights, summary |
| `AIAnalysisService` | `deduplicateAll(intelligence)` | Single-call semantic dedup for all 4 categories |
| `AIAnalysisService` | `deduplicateItems(label, items)` | Per-category dedup (deprecated — use deduplicateAll) |
| `providerRouter` | `getProvider()` | Returns `"groq"` (70%) or `"gemini"` (30%) via weighted random |
| `EventService` | `emit(event, payload)` | Sends Kafka events; topic = `event.toLowerCase().replace(/_/g,"-")` |
| `JobService` | `enqueueChunk(...)` | Adds jobs to `transcriptionQueue` |

### 3. Queues
`src/queues/`

| File | BullMQ Queue Name | Fed By |
|---|---|---|
| `transcriptionQueue.js` | `transcriptionQueue` | StorageService / JobService |
| `aggregationQueue.js` | `transcript-aggregation` | transcriptionWorker |
| `diarizationQueue.js` | `speaker-diarization` | transcriptAggregatorWorker |
| `cleanerQueue.js` | `transcript-cleaner` | speakerDiarizationWorker |
| `grouperQueue.js` | `segment-grouper` | transcriptCleanerWorker |
| `analysisQueue.js` | `analysisQueue` | segmentGrouperWorker |
| `insightAggregationQueue.js` | `insight-aggregation` | analysisWorker |
| `globalContextQueue.js` | `global-context` | transcriptAggregatorWorker |
| `llmQueue.js` | `llm-calls` | analysisWorker (dispatcher) |

### 4. Workers
`workers/`

| File | Queue | Key Dependencies |
|---|---|---|
| `transcriptionWorker.js` | `transcriptionQueue` | WhisperService, TranscriptService, aggregationQueue, **EventService** |
| `transcriptAggregatorWorker.js` | `transcript-aggregation` | TranscriptService, EventService, diarizationQueue, **globalContextQueue** |
| `speakerDiarizationWorker.js` | `speaker-diarization` | SpeakerService, EventService, cleanerQueue |
| `transcriptCleanerWorker.js` | `transcript-cleaner` | TranscriptCleaner, EventService, grouperQueue |
| `segmentGrouperWorker.js` | `segment-grouper` | SegmentGrouper, Transcript (MongoDB), EventService, analysisQueue |
| `analysisWorker.js` | `analysisQueue` | **llmQueue**, **EventService** — dispatcher: forwards to `llm-calls`, emits `SEGMENT_DISPATCHED` |
| `llmWorker.js` | `llm-calls` | AIAnalysisService (`analyzeGroq`/`analyzeGemini`), **providerRouter**, SegmentAnalysis (MongoDB), **SessionContext (MongoDB)**, EventService, insightAggregationQueue |
| `insightAggregatorWorker.js` | `insight-aggregation` | SegmentAnalysis (MongoDB), **SessionContext (MongoDB)**, AIAnalysisService, EventService |
| `globalContextWorker.js` | `global-context` | AIAnalysisService, **SessionContext (MongoDB)**, EventService |

### 5. Models
`src/models/`

#### Transcript
```javascript
{
  mediaId: String,
  segments: [{
    segmentId: Number,
    speakerId: String,   // "speaker_001", "speaker_002", ...
    start: Number,       // seconds
    end: Number,         // seconds
    text: String
  }],
  status: String,        // "raw" | "cleaned" | "grouped"
  createdAt: Date,
  updatedAt: Date
}
```

#### SegmentAnalysis
Compound unique index on `{ mediaId, segmentId }`.
```javascript
{
  mediaId: String,
  segmentId: Number,
  topics: [String],
  insights: [String],
  questions: [String],
  decisions: [String],
  action_items: [String],
  summary: String,
  createdAt: Date,
  updatedAt: Date
}
```

#### Analysis
Used by `analysisWorker` to fetch recent summaries as rolling context for the LLM.
```javascript
{
  mediaId: String,
  segmentId: Number,
  topics: [String],
  insights: [String],
  summary: String,
  questions: [String],
  decisions: [String],
  actionItems: [String],
  createdAt: Date
}
```

#### Session
```javascript
{
  title: String,
  createdAt: Date
}
```

#### SessionContext
Document-level AI summary generated by `globalContextWorker`. **Read by `insightAggregatorWorker`** to seed the final deduplication pass.
```javascript
{
  mediaId: String,  // indexed
  summary: String,  // 2-sentence session summary
  topics: [String], // up to 10 key topics across the full transcript
  insights: [String], // up to 10 core insights
  createdAt: Date,
  updatedAt: Date
}
```

---

## Pipeline Flow

```
1. UPLOAD
   ├─ POST /api/upload  (multipart file)
   ├─ Generate mediaId = session_<timestamp>
   ├─ FFmpeg: extract .wav
   ├─ FFmpeg: split into 30s chunks → uploads/chunks/
   ├─ Upload each chunk to MinIO (bucket: session-files)
   ├─ Per chunk: emit CHUNK_CREATED (Kafka) + add job to transcriptionQueue
   └─ Return { sessionId, totalChunks }

2. TRANSCRIPTION  [parallel per chunk]
   ├─ whisper-cli.exe processes chunk → text
   ├─ Save to transcripts/{mediaId}/chunk_{i}.txt
   └─ If all chunks done → add job to transcript-aggregation queue

3. AGGREGATION
   ├─ Read + sort all chunk_{i}.txt files
   ├─ Merge into single string
   ├─ Emit TRANSCRIPT_READY (Kafka)
   ├─ Add job to speaker-diarization queue
   └─ Add job to global-context queue  ← parallel branch

3a. GLOBAL CONTEXT  [runs in parallel with diarization]
   ├─ Split full transcript into <=330-word chunks
   ├─ Per chunk: call AIAnalysisService.analyzeGlobal() → { topics, insights, summary }
   ├─ Merge all chunk summaries via AIAnalysisService.analyze()
   ├─ Save SessionContext document to MongoDB
   └─ Emit GLOBAL_CONTEXT_READY (Kafka)

4. DIARIZATION
   ├─ Split into sentences → assign alternating speakerIds
   ├─ Merge consecutive same-speaker sentences
   ├─ Estimate timestamps (5s per segment)
   ├─ Save Transcript (status: "raw") to MongoDB
   ├─ Emit SPEAKERS_READY (Kafka)
   └─ Add job to transcript-cleaner queue

5. CLEANING
   ├─ Strip [noise]/[music] markers
   ├─ Normalise whitespace
   ├─ Remove duplicate segments
   ├─ Emit CLEAN_TRANSCRIPT_READY (Kafka)
   └─ Add job to segment-grouper queue

6. GROUPING
   ├─ Combine 3-5 consecutive segments into text windows
   ├─ Filter: skip segments where text < 120 chars (low-information / filler)
   ├─ Update Transcript (status: "grouped") in MongoDB  (saves ALL groups, including filtered)
   ├─ Emit GROUPED_SEGMENTS_READY (Kafka)
   └─ Per valid group: add job to analysisQueue  (totalSegments = filtered count)

7. AI ANALYSIS DISPATCH  [parallel per segment, concurrency: 5]
   ├─ Receive segment job from analysisQueue
   └─ Forward to llm-calls queue → { mediaId, segmentId, text, totalSegments }
       └─ jobId: llm-{mediaId}-{segmentId}  (deduplication guard)

7a. LLM ROUTING  [concurrency: 2, rate-limited: 20 req / 60 s]
   ├─ Fetch last 2 SegmentAnalysis summaries as rolling context
   ├─ Route via providerRouter: 70% Groq / 30% Gemini
   │    • Groq:   Llama 3.3 70B  (AIAnalysisService.analyzeGroq)
   │    • Gemini: 2.0 Flash       (AIAnalysisService.analyzeGemini)
   ├─ Per-segment limits:
   │    • max 2 topics  (specific, non-generic)
   │    • max 2 insights (non-obvious only)
   │    • max 1 question (most important only)
   │    • max 2 action_items (concrete + specific)
   │    • max 2 decisions (explicit only)
   ├─ Upsert into SegmentAnalysis (MongoDB)
   ├─ Emit SEGMENT_ANALYSIS_READY (Kafka)
   └─ If SegmentAnalysis.count >= totalSegments
       ├─ Poll for SessionContext (up to 60 s, every 2 s)
       └─ Add job to insight-aggregation queue

8. INSIGHT AGGREGATION
   ├─ Fetch all SegmentAnalysis docs for mediaId (sorted by segmentId)
   ├─ Merge all topic/insight/question/decision/action_item arrays
   ├─ Fetch SessionContext for mediaId  ← global context
   │    └─ Seed topics + insights with global context data
   │       (ensures full-transcript view informs the final dedup)
   ├─ Pass 1: exact-string dedup via Set + filter(Boolean)
   ├─ Pass 2: LLM semantic dedup via AIAnalysisService.deduplicateAll()  ← single call
   │    • topics      → max 10
   │    • insights    → max 10
   │    • questions   → max 6
   │    • action_items → max 8
   └─ Emit SESSION_INTELLIGENCE_READY (Kafka)
```

### Kafka Event Reference

| Event | Topic | Emitted By |
|---|---|---|
| `CHUNK_CREATED` | `chunk-created` | StorageService |
| `CHUNK_TRANSCRIBED` | `chunk-transcribed` | transcriptionWorker |
| `TRANSCRIPTION_COMPLETE` | `transcription-complete` | transcriptionWorker |
| `TRANSCRIPT_READY` | `transcript-ready` | transcriptAggregatorWorker |
| `GLOBAL_CONTEXT_READY` | `global-context-ready` | globalContextWorker |
| `SPEAKERS_READY` | `speakers-ready` | speakerDiarizationWorker |
| `CLEAN_TRANSCRIPT_READY` | `clean-transcript-ready` | transcriptCleanerWorker |
| `GROUPED_SEGMENTS_READY` | `grouped-segments-ready` | segmentGrouperWorker |
| `SEGMENT_DISPATCHED` | `segment-dispatched` | analysisWorker |
| `SEGMENT_ANALYSIS_READY` | `segment-analysis-ready` | **llmWorker** |
| `SESSION_INTELLIGENCE_READY` | `session-intelligence-ready` | insightAggregatorWorker |

---

## Global Session Context

### What It Is

`SessionContext` is a MongoDB document created once per session by the **Global Context Worker**. It holds a high-level AI summary of the **entire transcript** — not just a single segment.

```javascript
{
  mediaId: "session_1773052227650",
  summary: "Two-sentence summary of the whole session.",
  topics:   ["up to 10 key topics from the full transcript"],
  insights: ["up to 10 core insights from the full transcript"]
}
```

### Who Produces It

| Worker | Queue | Action |
|---|---|---|
| `transcriptAggregatorWorker` | `transcript-aggregation` | Enqueues a `global-context` job in parallel alongside the diarization job |
| `globalContextWorker` | `global-context` | Splits transcript into ≤1500-word chunks → calls `analyzeGlobal()` per chunk → if >1 chunk, merges summaries via `analyze()` → saves `SessionContext` to MongoDB → emits `GLOBAL_CONTEXT_READY` |

### Who Consumes It

| Worker | How It Is Used |
|---|---|
| `insightAggregatorWorker` | Reads `SessionContext` from MongoDB before the deduplication pass. Appends the global `topics` and `insights` arrays into the merged segment-level pool, so the LLM semantic dedup (Pass 2) has the full-transcript view alongside all per-segment extractions. This prevents the final output being biased only by whichever segments happened to repeat most. |

### Why It Matters

Segment-level analysis works in short windows (3-5 sentences each). A concept mentioned only once — but central to the whole session — may be lost in the noise of repeated near-duplicates from other segments. The Global Context Worker analyses the full transcript holistically and provides a ground-truth anchor that the Insight Aggregator uses during deduplication:

```
Per-segment topics  (N segments × max 2 each)  ──┐
                                                   ├──> Pass 1: Set dedup
SessionContext topics (max 10, full transcript) ───┘         |
                                                             v
                                                   Pass 2: LLM semantic dedup
                                                   (merge near-duplicates,
                                                    remove generics, cap at 10)
                                                             |
                                                             v
                                                   Final session topics (<=10)
```

---

## API Reference

### POST /api/upload

Upload a video or audio file to start the pipeline.

**Request** — `multipart/form-data`
```
field: file  (video or audio)
```

**Response**
```json
{
  "message": "Pipeline executed",
  "sessionId": "session_1773052227650",
  "video": "uploads/1773052227650-lecture.mp4",
  "audio": "uploads/session_1773052227650.wav",
  "chunks": "uploads/chunks",
  "totalChunks": 8
}
```

### GET /health
```json
{ "status": "ok" }
```

---

## Worker Processes

### Starting All Workers

Each worker runs as a standalone Node.js process. Open one terminal per worker:

```bash
# Terminal 1 — Transcription
cd backend ; node workers/transcriptionWorker.js

# Terminal 2 — Aggregation
cd backend ; node workers/transcriptAggregatorWorker.js

# Terminal 3 — Speaker Diarization
cd backend ; node workers/speakerDiarizationWorker.js

# Terminal 4 — Transcript Cleaner
cd backend ; node workers/transcriptCleanerWorker.js

# Terminal 5 — Segment Grouper
cd backend ; node workers/segmentGrouperWorker.js

# Terminal 6 — AI Analysis (dispatcher only)
cd backend ; node workers/analysisWorker.js

# Terminal 7 — LLM Router  (rate-limited AI calls: 20 req/min, 70% Groq + 30% Gemini)
cd backend ; node workers/llmWorker.js

# Terminal 8 — Insight Aggregator
cd backend ; node workers/insightAggregatorWorker.js

# Terminal 9 — Global Context  (runs in parallel with diarization)
cd backend ; node workers/globalContextWorker.js
```

### Worker Behaviour
- All workers connect to Redis at `127.0.0.1:6379`
- BullMQ handles auto-retry on failure
- Workers that need MongoDB call `connectDB()` on startup
- Workers that need dotenv load `.env` via `__dirname` resolution

---

## Services Documentation

### AIAnalysisService

```javascript
async analyzeGroq(text, previousContext = "")
// Calls Groq Llama 3.3 70B directly — no fallback, throws on any error
// Used by llmWorker when providerRouter selects "groq"
// BullMQ exponential backoff (5s / 25s / 125s) handles rate-limit recovery

async analyzeGemini(text, previousContext = "")
// Calls Gemini 2.0 Flash directly — no fallback, throws on any error
// Used by llmWorker when providerRouter selects "gemini"
// BullMQ exponential backoff (5s / 25s / 125s) handles rate-limit recovery

async analyze(text, previousContext = "")  ← @deprecated
// Groq→Gemini fallback with callWithRetry — kept for backward compat
// Use analyzeGroq() / analyzeGemini() via llmWorker for new code

async analyzeGlobal(text)
// Primary: Groq Llama 3.3 70B / Fallback: Gemini 2.0 Flash
// Chunk size: ≤1500 words (increased from 330 to reduce call count)
// Tightened prompt: requires named technologies/frameworks — rejects generic terms
// Good: "database design with MongoDB" | Bad: "AI", "coding", "technology"
// Returns: { topics (max 2, must be specific), insights (max 2), summary (1-2 sentences) }

async deduplicateAll(intelligence)    ← preferred
// Single LLM call for all 4 categories (topics, insights, questions, action_items)
// Short-circuits (0 calls) if all categories are already within their caps
// Caps: topics→10, insights→10, questions→6, action_items→8
// Returns: updated intelligence object with all four arrays cleaned

async deduplicateItems(label, items)  ← deprecated, kept for compatibility
// Single-category semantic dedup — use deduplicateAll() instead
// Still short-circuits if items.length <= cap
```

### providerRouter

```javascript
getProvider()
// Weighted random selection: 70% → "groq", 30% → "gemini"
// Distributes load across both providers' free-tier quotas
// Add new providers here (OpenRouter, Ollama, etc.) without touching workers

listProviders()
// Returns ["groq", "gemini"] — useful for health checks and monitoring
```

### Dual-Provider Retry Logic

`AIAnalysisService` uses a `callWithRetry(groqFn, geminiFn, maxRetries=5)` strategy for all LLM calls:

```
1. Try Groq
   ├─ Success → return result
   └─ 429 rate-limit → try Gemini
       ├─ Success → return result
       └─ 429 rate-limit → parse retryDelay from both errors
           ├─ Gemini PerDay: returns 2h (daily quota override)
           ├─ Gemini RetryInfo: reads exact seconds from embedded JSON
           ├─ Groq: parses "Please try again in 1m5s" text
           └─ Wait min(groqDelay, geminiDelay) — only need ONE provider
              to recover, so back off for the shortest window → retry
```

This means the pipeline self-heals through both per-minute (TPM) and per-day (TPD) quota windows without manual intervention. When Groq needs ~5 min and Gemini PerDay needs 2 h, the system waits only ~5 min then retries on Groq.

### SpeakerSegmentationService
```javascript
static segment(transcript)
// 1. Split transcript by sentence-ending punctuation
// 2. Assign alternating speakerIds (speaker_001, speaker_002, ...)
// 3. Merge consecutive sentences from the same speaker
// 4. Estimate timestamps at 5s per segment
// 5. Return: [{ segmentId, speakerId, start, end, text }]
```

### TranscriptCleaner
```javascript
cleanSegments(segments)
// Removes [bracketed noise/music markers]
// Normalises multiple spaces to single space
// Skips exact-duplicate segments (case-insensitive Set)
// Returns: cleaned segments array
```

### SegmentGrouper
```javascript
static groupSegments(segments)
// Groups every 3-5 consecutive segments
// Concatenates their text into a single window
// Returns: [{ text }]  — fed directly to analysisQueue
```

### EventService
```javascript
async emit(event, payload)
// Ensures Kafka producer is connected (lazy singleton)
// Topic = event.toLowerCase().replace(/_/g, "-")
// Sends payload as JSON string
// Logs failures without throwing (pipeline continues)
```

---

## LLM Call Optimization

Each LLM call consumes tokens against rate-limited free-tier quotas. The following optimisations reduce total calls per session without sacrificing output quality.

### Call Budget — Before vs After

| Stage | Before | After | Saving |
| --- | --- | --- | --- |
| Global context (12-min session, ~1500 words) | ceil(1500÷330) = 5 `analyzeGlobal` + 1 merge = **6** | 1 `analyzeGlobal` + 0 merge = **1** | −5 |
| Global context (30-min session, ~3750 words) | ceil(3750÷330) = 12 + 1 merge = **13** | ceil(3750÷1500) = 3 + 1 merge = **4** | −9 |
| Semantic deduplication | 4 × `deduplicateItems` = **0–4** | 1 × `deduplicateAll` = **0–1** | −3 |
| Per-segment analysis | N × `analyze` | N × `analyze` | 0 (core work) |

**Net saving: ~30–40% fewer LLM calls per session.**

### Optimization 1 — Larger Global Context Chunks

`globalContextWorker` previously split the transcript into 330-word chunks (≈2 min of speech). This was overly conservative — Groq and Gemini both support 128 K context windows.

**Change:** chunk size increased from **330 → 1500 words** (≈5 min of speech).

```
Before: 1500-word transcript → 5 analyzeGlobal calls
After:  1500-word transcript → 1 analyzeGlobal call
```

### Optimization 2 — Skip Merge Call for Single-Chunk Transcripts

Short sessions (≤1500 words) produce exactly one chunk. Previously, `buildGlobalContext()` was still called to "merge" a single result — making an unnecessary extra `analyze()` call.

**Change:** when `chunks.length === 1`, the result of `analyzeGlobal()` is used directly and `buildGlobalContext()` is skipped.

```javascript
if (chunks.length === 1) {
  finalContext = await AIAnalysisService.analyzeGlobal(chunks[0]); // 1 call total
} else {
  // analyse each chunk, then merge
  finalContext = await buildGlobalContext(chunkResults);           // N + 1 calls
}
```

### Optimization 3 — Single-Call Deduplication (`deduplicateAll`)

The insight aggregator previously called `deduplicateItems()` separately for each of the four categories (topics, insights, questions, action_items) — up to **4 sequential LLM calls**.

**Change:** new `AIAnalysisService.deduplicateAll(intelligence)` method sends all four categories in one structured prompt and receives a single JSON response with all four cleaned arrays.

```
Before: deduplicateItems(topics) → deduplicateItems(insights)
      → deduplicateItems(questions) → deduplicateItems(action_items)
        = up to 4 LLM calls

After:  deduplicateAll({ topics, insights, questions, action_items })
        = 1 LLM call  (or 0 if all categories are already within caps)
```

The method also short-circuits if no category exceeds its cap, making zero calls in that case.

---

## Configuration

### Environment Variables (`.env`)

```env
# MongoDB
MONGO_URI=mongodb://localhost:27017/ai-session-assistant

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKAJS_NO_PARTITIONER_WARNING=1

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=password123

# Whisper
WHISPER_MODEL_PATH=D:/ai-tools/whisper.cpp/models/ggml-base.bin
WHISPER_EXECUTABLE=D:/ai-tools/whisper.cpp/build/bin/Release/whisper-cli.exe

# Groq AI (primary)
GROQ_API_KEY=your_groq_api_key_here

# Google Gemini (fallback — used automatically on Groq 429)
GEMINI_API_KEY=your_gemini_api_key_here

# Server
PORT=3000
```

### Docker Services (`infrastructure/docker-compose.yml`)

```yaml
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    ports: ["2181:2181"]

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    ports: ["9092:9092"]

  minio:
    image: minio/minio
    ports: ["9000:9000", "9001:9001"]
```

Redis and MongoDB are expected to run locally (not in Docker).

### File Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── db.js                      # MongoDB connection
│   │   ├── redis.js                   # ioredis singleton
│   │   ├── kafka.js                   # Kafka producer/consumer
│   │   └── minio.js                   # MinIO client
│   ├── controllers/
│   │   └── UploadController.js
│   ├── models/
│   │   ├── Session.js
│   │   ├── Transcript.js
│   │   ├── Analysis.js
│   │   ├── SegmentAnalysis.js
│   │   └── SessionContext.js
│   ├── queues/
│   │   ├── transcriptionQueue.js
│   │   ├── aggregationQueue.js
│   │   ├── diarizationQueue.js
│   │   ├── cleanerQueue.js
│   │   ├── grouperQueue.js
│   │   ├── analysisQueue.js
│   │   ├── insightAggregationQueue.js
│   │   ├── globalContextQueue.js
│   │   └── llmQueue.js                # rate-limited LLM call queue
│   ├── routes/
│   │   └── uploadRoutes.js
│   └── services/
│       ├── AIAnalysisService.js
│       ├── providerRouter.js          # Groq/Gemini/future provider routing
│       ├── AudioService.js
│       ├── ChunkService.js
│       ├── EventService.js
│       ├── InsightAggregator.js
│       ├── JobService.js
│       ├── KafkaService.js
│       ├── QueueService.js
│       ├── SegmentGrouper.js
│       ├── SpeakerSegmentationService.js
│       ├── SpeakerService.js
│       ├── storageService.js
│       ├── TranscriptCleaner.js
│       ├── TranscriptService.js
│       └── WhisperService.js
├── workers/
│   ├── transcriptionWorker.js
│   ├── transcriptAggregatorWorker.js
│   ├── speakerDiarizationWorker.js
│   ├── transcriptCleanerWorker.js
│   ├── segmentGrouperWorker.js
│   ├── analysisWorker.js          # dispatcher → llm-calls queue
│   ├── llmWorker.js               # LLM router: Groq 70% / Gemini 30%
│   ├── insightAggregatorWorker.js
│   └── globalContextWorker.js
├── transcripts/                       # chunk_N.txt + final_transcript.txt
├── uploads/
│   └── chunks/
├── server.js
└── package.json
```

---

## Current Implementation Status

### Phase 1 — Core Infrastructure ✅
- Express API server with Multer upload handling
- FFmpeg audio extraction and chunk splitting
- MinIO chunk storage (`session-files` bucket)

### Phase 2 — Transcription Pipeline ✅
- Whisper.cpp local transcription per chunk (parallel)
- Chunk completion detection → transcript aggregation
- Redis / BullMQ queue management

### Phase 3 — Speaker Diarization ✅
- Sentence-level segmentation with alternating speaker assignment
- Consecutive same-speaker segment merging
- Timestamp estimation
- MongoDB persistence

### Phase 4 — Transcript Enhancement ✅
- Noise marker stripping and deduplication (TranscriptCleaner)
- 3-5 sentence grouping windows (SegmentGrouper)
- Transcript status lifecycle: `raw → cleaned → grouped`

### Phase 5 — AI Analysis & Session Intelligence ✅
- Per-segment analysis via Groq Llama 3.3 70B
- Tightened per-segment limits (max 2 topics/insights, 1 question, 2 action_items)
- Rolling previous-context window for continuity
- Parallel segment processing with count-based completion gate
- Pass 1: exact-string dedup via `unique()` (Set + filter)
- Pass 2: LLM semantic dedup via `deduplicateItems()` — merges near-duplicates, caps per category
- Final `SESSION_INTELLIGENCE_READY` event

### Phase 6 — Global Context Layer ✅
- Parallel pipeline triggered by `TRANSCRIPT_READY` alongside diarization
- Full transcript split into <=330-word chunks for LLM token safety
- Each chunk analysed independently via `AIAnalysisService.analyzeGlobal()`
- Tightened prompt enforces specific technologies/frameworks — rejects generic terms
- Chunk summaries merged into a single document-level context
- `SessionContext` stored via upsert (`findOneAndUpdate`) — idempotent, no duplicate key errors
- `globalContextWorker` runs with `concurrency: 1` and `attempts: 1` to prevent duplicate execution
- Global context job locked by `jobId: context-${mediaId}` in `transcriptAggregatorWorker`
- `GLOBAL_CONTEXT_READY` Kafka event emitted on completion
- **`insightAggregatorWorker` reads `SessionContext` and seeds the dedup pass** — full-transcript view anchors the final intelligence output
- Summaries capped at 10 (evenly-sampled) regardless of session length

### Phase 6.3 — LLM Queue + Rate Limiter + Provider Router ✅
- **`llm-calls` BullMQ queue** (`src/queues/llmQueue.js`): all segment AI calls flow through a single queue with `attempts: 10` + custom backoff (reads exact delay from error)
- **`analysisWorker` → pure dispatcher**: removed all direct AI calls, DB writes, and aggregation logic — now just bridges `analysisQueue → llm-calls` at `concurrency: 5`; emits `SEGMENT_DISPATCHED` Kafka event per segment
- **`llmWorker`** (`workers/llmWorker.js`): new dedicated LLM router worker — `concurrency: 2`, BullMQ `limiter: { max: 20, duration: 60000 }` — processes at most 20 LLM calls per minute globally across all instances
- **`providerRouter`** (`src/services/providerRouter.js`): centralised routing strategy — 70% Groq / 30% Gemini weighted split; add new providers (OpenRouter, Ollama) here without touching workers
- **`AIAnalysisService.analyzeGroq()` / `.analyzeGemini()`**: direct provider methods — throw on failure so BullMQ retry handles recovery; shared `_buildAnalyzePrompt()` keeps prompts in sync
- **Segment filter**: `segmentGrouperWorker` skips groups with < 120 chars — eliminates 20–40% of LLM calls on typical sessions
- **Net result**: zero rate-limit bursts; at most 2 concurrent LLM calls; full load distribution across both providers

### Phase 6.4 — Rate Limit Resilience + Full EDA Events ✅
- **Rate limit backoff fix**: when both providers are exhausted, backoff uses `min(groqDelay, geminiDelay)` instead of `max` — the system only needs ONE provider to recover. Example: Groq needs 5 min, Gemini PerDay needs 2 h → wait 5 min, not 2 h. Applies to both `llmWorker` (BullMQ `backoffStrategy`) and `AIAnalysisService.callWithRetry` (used by `globalContextWorker`)
- **Full EDA coverage**: every worker in the pipeline now emits Kafka events:
  - `transcriptionWorker` → `CHUNK_TRANSCRIBED` (per chunk) + `TRANSCRIPTION_COMPLETE` (all chunks done)
  - `analysisWorker` → `SEGMENT_DISPATCHED` (per segment forwarded to llm-calls)
  - All other workers were already emitting events ✅

### Phase 6.1 — Pipeline Stabilization ✅
- **Race condition fixed**: `analysisWorker` polls for `SessionContext` (up to 60 s, every 2 s) before enqueuing insight aggregation — ensures global context always participates in dedup
- **Aggregation dedup**: insight aggregation job locked by `jobId: aggregate-${mediaId}` — cannot be enqueued twice
- **Dual-provider AI**: Groq → Gemini 2.0 Flash fallback with `callWithRetry` — parses exact `retryDelay` from both providers' 429 errors and waits before retrying (up to 5 attempts)
- **`TimeoutNegativeWarning` fixed**: `SessionContext.create` replaced with `findOneAndUpdate` upsert — eliminates duplicate key errors that caused BullMQ stale-timestamp retries

### Phase 6.2 — LLM Call Optimization ✅
- **Global context chunk size**: 330 → 1500 words — reduces `analyzeGlobal` calls by ~80% for typical sessions
- **Single-chunk shortcut**: merge call skipped when transcript fits in one chunk — 0 instead of 1 extra call for sessions ≤1500 words
- **`deduplicateAll()`**: replaces 4 sequential `deduplicateItems` calls with 1 combined LLM call — saves up to 3 calls per session; short-circuits to 0 calls when all categories are within caps
- **Net result**: ~30–40% fewer LLM calls per session

### Phase 7 — Validation Layer 🔮 (Planned)
- `validationWorker`: cross-checks each `SegmentAnalysis` against `SessionContext`
- Filter out insights/topics that contradict or are absent from the global context
- Produces a validated, globally-consistent intelligence report

---

## Troubleshooting

| Problem | Check |
|---|---|
| Worker exits immediately | Verify Redis is running: `redis-cli ping` |
| Kafka connection error | `docker ps` — confirm kafka + zookeeper containers are up |
| MongoDB connection failed | Confirm `mongod` is running; check `MONGO_URI` |
| Whisper produces empty output | Test: `whisper-cli.exe -m <model> -f <wav> -nt` manually |
| AI analysis JSON parse error | Check Groq API key; inspect raw LLM output in worker logs |
| Segments not counted correctly | Ensure all `analysisWorker` instances share the same MongoDB |
| Global context not seeding aggregator | Ensure `globalContextWorker` is running; check `global-context` queue depth |

---

## Future Enhancements

### Real Speaker Diarization
- Replace alternating speaker heuristic with **pyannote.audio**
- Acoustic feature-based identification supporting 10+ speakers

### Whisper Timestamps
- Parse `[HH:MM.ss → HH:MM.ss]` from Whisper output for accurate video seeking

### Semantic Knowledge Engine
- Vector embeddings stored in a vector DB (pgvector / Qdrant)
- Natural language queries: *"What decisions were made about the database?"*
- Cross-session similarity search

### Real-time Processing
- WebSocket progress updates streamed to client during pipeline execution
- Streaming (partial) transcription results

### Export & Search
- Export to PDF, DOCX, Markdown
- Full-text search across all session transcripts

---

**Last Updated**: March 11, 2026
**Version**: 2.6.0
**Status**: Phase 6.4 Complete — Rate Limit Resilience + Full EDA Events ✅ | Phase 7 Planned

