# AI Session Assistant — Architecture Documentation

**Version**: 4.0.0 (Phase E — Product Layer: Report + Chat)  
**Last Updated**: March 18, 2026  
**Status**: ✅ Fully Operational — 13 workers, 13 queues, 3 API endpoints, 7 models

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Architecture Diagram](#3-architecture-diagram)
4. [Pipeline Flow — Step by Step](#4-pipeline-flow--step-by-step)
5. [API Reference](#5-api-reference)
6. [Workers — Complete Reference](#6-workers--complete-reference)
7. [Queues — Complete Reference](#7-queues--complete-reference)
8. [Models — MongoDB Schemas](#8-models--mongodb-schemas)
9. [Services — Complete Reference](#9-services--complete-reference)
10. [Configuration](#10-configuration)
11. [File Structure](#11-file-structure)
12. [Starting All Workers](#12-starting-all-workers)
13. [Implementation Phases](#13-implementation-phases)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. System Overview

The AI Session Assistant is an event-driven, microservices-style pipeline that processes video or audio recordings and produces:

1. **Structured session intelligence** — topics, insights, decisions, action items
2. **A human-readable session report** — formatted text for quick review
3. **An interactive AI chat interface** — ask questions about the session in natural language

### Key Design Principles

| Principle | Implementation |
|---|---|
| **Parallel processing** | Two independent pipelines (early window + full transcript) feed the same analysis queue |
| **Rate-limit resilience** | LLM calls routed through a rate-limited BullMQ queue; Groq → Gemini automatic fallback |
| **Idempotency** | All BullMQ jobs use deterministic `jobId` to prevent duplicate processing on retry |
| **Hierarchical dedup** | Every 8 segments → 1 Block → Final session intelligence (80–90% fewer LLM calls) |
| **Memory safety** | In-memory sliding window buffer released after session completes |
| **Product layer** | Session Report + Chat API on top of raw intelligence |

---

## 2. Technology Stack

| Category | Technology | Version |
|---|---|---|
| Runtime | Node.js | v18+ |
| Web Framework | Express.js | v5.2.1 |
| Module System | ES Modules (import/export) | — |
| Job Queues | BullMQ | v5.70.4 |
| Redis Client | ioredis | v5.10.0 |
| Event Streaming | kafkajs | v2.2.4 |
| Database | Mongoose (MongoDB) | v9.2.4 |
| Object Storage | minio | v8.0.7 |
| AI Transcription | Whisper.cpp | local binary |
| AI Analysis (primary) | Groq SDK — Llama 3.3 70B | v0.37.0 |
| AI Analysis (fallback) | Google Generative AI — Gemini 2.0 Flash | v0.24.0 |
| Audio Processing | FFmpeg | system install |
| File Upload | multer | v2.1.1 |

---

## 3. Architecture Diagram

### End-to-End System

```
┌──────────────────────────────────────────────────────────────┐
│                     CLIENT                                    │
│        POST /api/upload  (video or audio file)               │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  UPLOAD CONTROLLER                            │
│  1. FFmpeg → extract .wav audio                              │
│  2. FFmpeg → split into 30s chunks                           │
│  3. MinIO  → store each chunk                                │
│  4. BullMQ → one transcriptionQueue job per chunk            │
└──────────────────────────┬───────────────────────────────────┘
                           │ one job per chunk (parallel)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              transcriptionWorker (Whisper.cpp)                │
│  • Runs whisper-cli.exe on chunk → transcript text           │
│  • Saves chunk_N.txt to disk                                 │
│  • Adds chunk to TranscriptBufferService                     │
└───────────────────┬──────────────────────┬───────────────────┘
                    │                      │
           window ready?           all chunks done?
                    │                      │
          PATH A (Early)          PATH B (Complete)
                    │                      │
                    ▼                      ▼
         windowDiarizationQueue    aggregationQueue
```

### Path A — Early Partial Analysis (120s latency)

```
windowDiarizationWorker
  → speaker segments with string IDs (e.g. "session_X-window-0-3-0")
  → cleanerQueue (transcript-cleaner)
    → grouperQueue (segment-grouper)
      → analysisQueue → llm-calls queue
        → SegmentAnalysis stored (Mixed segmentId: String)
```

### Path B — Full Transcript Analysis (session-end)

```
transcriptAggregatorWorker
  ├─ diarizationQueue  → speakerDiarizationWorker
  │    → cleanerQueue → grouperQueue → analysisQueue → llm-calls
  │      → SegmentAnalysis stored (segmentId: Number)
  │      → every 8 segments → blockQueue
  │          → blockAggregatorWorker → BlockAnalysis stored
  │          → when all blocks done → insightAggregationQueue
  │
  └─ globalContextQueue → globalContextWorker
       → SessionContext stored (full-transcript AI summary)
```

### Convergence — Both Paths Feed Same Analysis

```
analysisQueue (from Path A or B)
    ↓
analysisWorker (dispatcher, concurrency 5)
    ↓ jobId: llm-{mediaId}-{segmentId}
llm-calls queue
    ↓
llmWorker (concurrency 2, rate-limited 20/60s)
    • 70% Groq (Llama 3.3 70B)
    • 30% Gemini (2.0 Flash)
    • Idempotency check → skip if already analyzed
    • Rolling context from previous 2 segments (numeric IDs only)
    ↓
SegmentAnalysis upserted → SEGMENT_ANALYSIS_READY (Kafka)
    ↓ every 8 segments
blockQueue → blockAggregatorWorker
    → deduplicateAll() → BlockAnalysis stored
    → when all blocks done → insightAggregationQueue
    ↓
insightAggregatorWorker
    • reads BlockAnalysis (primary) or SegmentAnalysis (fallback)
    • seeds with SessionContext (global full-transcript view)
    • Pass 1: exact-string dedup (Set)
    • Pass 2: LLM semantic dedup (deduplicateAll)
    → SESSION_INTELLIGENCE_READY (Kafka)
    → reportQueue job added
    → TranscriptBufferService.cleanup(mediaId)
```

### Phase E — Product Layer

```
reportGeneratorWorker (report-generator queue)
    • formats intelligence into human-readable text
    • upserts SessionReport to MongoDB
        ↓
Frontend: GET /api/report/:mediaId
    → shows report + suggestedQuestions
        ↓
User asks question → POST /api/chat
    → chatQueue job
    → chatWorker
        • fetches SessionReport as context
        • calls AIAnalysisService.groqChat()
        • returns { answer }
```

---

## 4. Pipeline Flow — Step by Step

### Step 1 — Upload

```
POST /api/upload  (multipart/form-data, field: file)

UploadController:
  sessionId = session_<Date.now()>
  AudioService.extractAudio(videoPath)   → uploads/session_X.wav
  ChunkService.splitAudio(audioPath)     → uploads/chunks/chunk_0.wav, chunk_1.wav, ...
  StorageService.uploadChunks(...)       → MinIO bucket: session-files
    └─ per chunk:
         emit CHUNK_CREATED (Kafka)
         transcriptionQueue.add({ mediaId, chunkIndex, chunkName, totalChunks })
```

### Step 2 — Transcription (parallel per chunk)

```
transcriptionWorker  [queue: transcriptionQueue]
  WhisperService.transcribe(chunkPath)
  TranscriptService.saveChunk(mediaId, chunkIndex, text)   → chunk_N.txt
  
  TranscriptBufferService.addChunk(mediaId, chunkIndex, text)
    └─ if window ready (4 consecutive chunks, stride 2, continuity validated):
         windowDiarizationQueue.add({ mediaId, windowId, chunkRange, combinedText })
         emit WINDOW_DIARIZATION_QUEUED (Kafka)
  
  emit CHUNK_TRANSCRIBED (Kafka)
  
  if TranscriptService.isComplete(mediaId, totalChunks):
    aggregationQueue.add({ mediaId })
    emit TRANSCRIPTION_COMPLETE (Kafka)
```

### Step 2a — Window Diarization [Path A]

```
windowDiarizationWorker  [queue: window-diarization]
  SpeakerSegmentationService.segment(combinedText)
  → assign window-based segmentIds: "${windowId}-${idx}"
    e.g. "session_X-window-0-3-0", "session_X-window-0-3-1"
  cleanerQueue.add({ mediaId, windowId, segments })
  emit WINDOW_DIARIZATION_READY (Kafka)
```

### Step 3 — Transcript Aggregation [Path B]

```
transcriptAggregatorWorker  [queue: transcript-aggregation]
  TranscriptService.merge(mediaId)    → reads + sorts all chunk_N.txt files
  emit TRANSCRIPT_READY (Kafka)
  diarizationQueue.add({ mediaId, transcript })
  globalContextQueue.add({ mediaId, transcript }, { jobId: context-${mediaId} })
```

### Step 3a — Global Context [parallel with diarization]

```
globalContextWorker  [queue: global-context, concurrency: 1]
  chunkByWords(transcript, 1500)     → ≤1500-word chunks
  
  if single chunk:
    AIAnalysisService.analyzeGlobal(text)     → 1 LLM call
  else:
    for each chunk: analyzeGlobal(chunk)      → N LLM calls
    buildGlobalContext(chunkResults)          → 1 merge call
  
  SessionContext.findOneAndUpdate({ mediaId }, { summary, topics, insights }, { upsert })
  emit GLOBAL_CONTEXT_READY (Kafka)
```

### Step 4 — Full Diarization [Path B]

```
speakerDiarizationWorker  [queue: speaker-diarization]
  SpeakerService.process(mediaId, transcript)
    → SpeakerSegmentationService.segment()  → sentences → alternating speakers
    → numeric segmentIds: 0, 1, 2, ...
    → Transcript.save({ segments, status: "raw" })
  emit SPEAKERS_READY (Kafka)
  cleanerQueue.add({ mediaId, segments })   [no windowId → full path]
```

### Step 5 — Transcript Cleaning [both paths]

```
transcriptCleanerWorker  [queue: transcript-cleaner]
  isWindowJob = !!windowId
  TranscriptCleaner.cleanSegments(segments)
    → strip [noise]/[music] markers
    → normalise whitespace
    → deduplicate exact-match segments
  
  if isWindowJob:  emit WINDOW_CLEAN_READY  →  grouperQueue (jobId: group-${windowId})
  else:            emit CLEAN_TRANSCRIPT_READY  →  grouperQueue (jobId: group-${mediaId})
```

### Step 6 — Segment Grouping [both paths]

```
segmentGrouperWorker  [queue: segment-grouper]
  isWindowJob = !!windowId
  SegmentGrouper.groupSegments(segments)   → 90-second time-based buckets
  filter: skip segments < 120 chars (noise/filler filter)
  
  if !isWindowJob:
    Transcript.findOneAndUpdate({ mediaId }, { segments: groups, status: "grouped" })
    emit GROUPED_SEGMENTS_READY (Kafka)
  else:
    emit WINDOW_GROUPED_READY (Kafka)
  
  for each validGroup:
    segmentId = group.segmentId ?? i   (string for window, number for full)
    analysisQueue.add({ mediaId, windowId, segmentId, text, totalSegments },
      { jobId: isWindowJob ? analysis-${segmentId} : analysis-${mediaId}-${i} })
```

### Step 7 — Analysis Dispatch

```
analysisWorker  [queue: analysisQueue, concurrency: 5]
  llmQueue.add("segment-analysis",
    { mediaId, segmentId, text, totalSegments },
    { jobId: llm-${mediaId}-${segmentId} })   ← deduplication guard
  emit SEGMENT_DISPATCHED (Kafka)
```

### Step 7a — LLM Processing

```
llmWorker  [queue: llm-calls, concurrency: 2, limit: 20/60s]

  1. Idempotency: if SegmentAnalysis exists for (mediaId, segmentId) → skip

  2. Rolling context (numeric IDs only):
     last 2 SegmentAnalysis summaries where segmentId < current (completed only)

  3. Provider routing:
     primary = getProvider()   → 70% Groq / 30% Gemini
     try primary → on 429: try secondary → on both 429:
       throw with retryAfterMs = min(groqDelay, geminiDelay)
       BullMQ backoffStrategy reads retryAfterMs and delays exactly that long

  4. SegmentAnalysis.findOneAndUpdate({ mediaId, segmentId }, result, { upsert })
     emit SEGMENT_ANALYSIS_READY (Kafka)

  5. Block trigger: every 8th segment:
     blockQueue.add({ mediaId, blockId, segmentIds[8], totalBlocks },
       { jobId: block-${mediaId}-${blockId} })

  6. Final aggregation: if SegmentAnalysis.count >= totalSegments:
     poll for all BlockAnalysis docs (up to 120s, check every 2s)
     insightAggregationQueue.add({ mediaId, totalSegments },
       { jobId: final-aggregate-${mediaId} })   ← same jobId as blockAggregatorWorker!
```

### Step 7b — Block Aggregation

```
blockAggregatorWorker  [queue: block-aggregation, concurrency: 3]
  SegmentAnalysis.find({ mediaId, segmentId: { $in: segmentIds } })
  merge topics/insights/questions/decisions/action_items from 8 segments
  AIAnalysisService.deduplicateAll(merged)   → 1 LLM call per block
  BlockAnalysis.findOneAndUpdate({ mediaId, blockId }, result, { upsert })
  emit BLOCK_ANALYSIS_READY (Kafka)
  
  if BlockAnalysis.count >= totalBlocks:
    insightAggregationQueue.add({ mediaId, totalBlocks },
      { jobId: final-aggregate-${mediaId} })   ← matches llmWorker jobId
```

### Step 8 — Insight Aggregation

```
insightAggregatorWorker  [queue: insight-aggregation]

  PRIMARY PATH (blocks exist):
    BlockAnalysis.find({ mediaId }).sort({ blockId: 1 })
    merge topics/insights/questions/decisions/action_items from all blocks
    cap summaries at 10 (evenly sampled)

  FALLBACK PATH (no blocks — e.g. pipeline still warming up):
    SegmentAnalysis.find({ mediaId }).sort({ segmentId: 1 })

  GLOBAL CONTEXT SEEDING:
    SessionContext.findOne({ mediaId })
    push globalCtx.topics + globalCtx.insights into pool
    (ensures full-transcript view anchors the final dedup pass)

  Pass 1: exact-string dedup via unique() — Set + filter(Boolean)
  Pass 2: AIAnalysisService.deduplicateAll()
    caps: topics→10, insights→10, questions→6, action_items→8
    short-circuits if all already within caps (0 LLM calls)

  emit SESSION_INTELLIGENCE_READY (Kafka)

  reportQueue.add("create-session-report", { mediaId, intelligence },
    { jobId: create-session-report-${mediaId}, removeOnComplete: true })

  TranscriptBufferService.cleanup(mediaId)   ← releases in-memory window buffer
```

### Step 9 — Report Generation [Phase E]

```
reportGeneratorWorker  [queue: report-generator]
  formats intelligence into structured text:
    📌 Session Overview
    🧠 Key Topics (numbered list)
    💡 Insights (bullet list)
    ✅ Decisions (bullet list)
    🚀 Action Items (bullet list)
  SessionReport.findOneAndUpdate({ mediaId }, { content, updatedAt }, { upsert })
```

### Step 10 — Chat [Phase E]

```
chatWorker  [queue: chat-query]
  SessionReport.findOne({ mediaId })
  builds grounded prompt: "You are an AI session assistant. Context: ${report.content}..."
  AIAnalysisService.groqChat(prompt, 0.3)
  returns { answer }
```

---

## 5. API Reference

### POST /api/upload

Start the pipeline with a video or audio recording.

**Request**: `multipart/form-data`, field: `file`

**Response**:
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

---

### GET /api/report/:mediaId

Retrieve the generated session report. Available after the pipeline fully completes.

**Response 200**:
```json
{
  "mediaId": "session_1773052227650",
  "content": "📌 Session Overview\nThis session covered...\n\n🧠 Key Topics\n1. MongoDB schema design\n...",
  "createdAt": "2026-03-18T00:20:00.000Z",
  "updatedAt": "2026-03-18T00:20:00.000Z",
  "suggestedQuestions": [
    "What were the key decisions made in this session?",
    "What should I do next based on this session?",
    "What topics were discussed?",
    "Give me a brief summary of the session.",
    "What action items were identified?"
  ]
}
```

**Response 404**: Report not found (session still processing or not started).

---

### POST /api/chat

Ask the AI assistant a question about a completed session.

**Request**: `application/json`
```json
{ "mediaId": "session_1773052227650", "question": "What were the key decisions?" }
```

**Response 200**:
```json
{ "answer": "The key decisions made in this session were..." }
```

**Notes**:
- Enqueues a `chat-query` BullMQ job, awaits result via `QueueEvents.waitUntilFinished()` (30s timeout)
- Context = `SessionReport.content` (the formatted text report)
- LLM is instructed not to hallucinate beyond the report content
- Future: RAG upgrade will include segments + blocks + vector DB

---

### GET /health

```json
{ "status": "ok" }
```

---

## 6. Workers — Complete Reference

| # | File | Queue | Startup Log | Concurrency | DB | Emits |
|---|---|---|---|---|---|---|
| 1 | `transcriptionWorker.js` | `transcriptionQueue` | `🎧 Transcription Worker Started` | default | ❌ | `CHUNK_TRANSCRIBED`, `TRANSCRIPTION_COMPLETE`, `WINDOW_DIARIZATION_QUEUED` |
| 2 | `windowDiarizationWorker.js` | `window-diarization` | `🎤 Window Diarization Worker Started` | default | ❌ | `WINDOW_DIARIZATION_READY` |
| 3 | `transcriptAggregatorWorker.js` | `transcript-aggregation` | `📦 Transcript Aggregator Started` | default | ❌ | `TRANSCRIPT_READY` |
| 4 | `speakerDiarizationWorker.js` | `speaker-diarization` | `🎙️ Speaker Diarization Worker Started` | default | ✅ | `SPEAKERS_READY` |
| 5 | `transcriptCleanerWorker.js` | `transcript-cleaner` | `🧹 Transcript Cleaner Worker Started` | default | ❌ | `WINDOW_CLEAN_READY` or `CLEAN_TRANSCRIPT_READY` |
| 6 | `segmentGrouperWorker.js` | `segment-grouper` | `📊 Segment Grouper Worker Started` | default | ✅ | `WINDOW_GROUPED_READY` or `GROUPED_SEGMENTS_READY` |
| 7 | `analysisWorker.js` | `analysisQueue` | `🤖 Analysis Dispatcher Worker started` | 5 | ❌ | `SEGMENT_DISPATCHED` |
| 8 | `llmWorker.js` | `llm-calls` | `🧠 LLM Router Worker started` | 2 (rate: 20/60s) | ✅ | `SEGMENT_ANALYSIS_READY` |
| 9 | `blockAggregatorWorker.js` | `block-aggregation` | `🧱 Block Aggregator Worker started` | 3 | ✅ | `BLOCK_ANALYSIS_READY` |
| 10 | `insightAggregatorWorker.js` | `insight-aggregation` | `📊 Insight Aggregator Worker Started` | default | ✅ | `SESSION_INTELLIGENCE_READY` |
| 11 | `globalContextWorker.js` | `global-context` | `🌍 Global Context Worker Started` | 1 | ✅ | `GLOBAL_CONTEXT_READY` |
| 12 | `reportGeneratorWorker.js` | `report-generator` | `📄 Report Generator Worker Started` | default | ✅ | — |
| 13 | `chatWorker.js` | `chat-query` | `💬 Chat Worker Started` | default | ✅ | — |

### Worker Details

#### `llmWorker.js` — Rate Limit & Dual-Provider Logic

```
Primary provider → getProvider() → 70% Groq / 30% Gemini

On 429 from primary:
  → try secondary provider immediately

On 429 from both:
  → throw error with retryAfterMs = min(groqDelay, geminiDelay)
  → BullMQ backoffStrategy reads retryAfterMs and waits exactly that long
  → Handles: Groq "Please try again in 1m5s", Gemini RetryInfo JSON,
             Gemini PerDay "GenerateRequestsPerDayPerProjectPerModel-FreeTier" → 2h

Rate limit: max 20 LLM calls per 60 seconds (BullMQ limiter)
Concurrency: 2 (at most 2 in-flight LLM calls at any time)
```

#### `blockAggregatorWorker.js` — Hierarchical Intelligence

```
Input: every 8 segments
Process:
  1. Fetch 8 SegmentAnalysis docs
  2. Merge topics/insights/questions/decisions/action_items
  3. AIAnalysisService.deduplicateAll() → 1 LLM call per block
  4. BlockAnalysis.findOneAndUpdate({ mediaId, blockId }, ..., { upsert })
  5. Check if all blocks done → trigger insightAggregationQueue
     jobId: final-aggregate-${mediaId}  ← MUST match llmWorker

Cost: 40 blocks (320 segments ÷ 8) → 40 LLM calls vs 320
```

#### `insightAggregatorWorker.js` — Final Intelligence Compilation

```
Data source (priority order):
  1. BlockAnalysis.find({ mediaId })   ← primary (8x smaller dataset)
  2. SegmentAnalysis.find({ mediaId }) ← fallback if no blocks

Session context seeding:
  SessionContext.findOne({ mediaId })
  → append globalCtx.topics + globalCtx.insights before dedup

Deduplication:
  Pass 1: Set-based exact dedup  → unique(arr) = [...new Set(arr.filter(Boolean))]
  Pass 2: AIAnalysisService.deduplicateAll() → 1 LLM call
    caps: topics 10, insights 10, questions 6, action_items 8
    skips if all categories already within caps

After completion:
  emit SESSION_INTELLIGENCE_READY
  reportQueue.add("create-session-report", { mediaId, intelligence },
    { jobId: create-session-report-${mediaId} })
  TranscriptBufferService.cleanup(mediaId)
```

---

## 7. Queues — Complete Reference

| File | BullMQ Queue Name | Producer | Consumer |
|---|---|---|---|
| `transcriptionQueue.js` | `transcriptionQueue` | StorageService (via JobService) | transcriptionWorker |
| `windowDiarizationQueue.js` | `window-diarization` | transcriptionWorker | windowDiarizationWorker |
| `aggregationQueue.js` | `transcript-aggregation` | transcriptionWorker (all chunks done) | transcriptAggregatorWorker |
| `diarizationQueue.js` | `speaker-diarization` | transcriptAggregatorWorker | speakerDiarizationWorker |
| `cleanerQueue.js` | `transcript-cleaner` | windowDiarizationWorker + speakerDiarizationWorker | transcriptCleanerWorker |
| `grouperQueue.js` | `segment-grouper` | transcriptCleanerWorker | segmentGrouperWorker |
| `analysisQueue.js` | `analysisQueue` | segmentGrouperWorker | analysisWorker |
| `llmQueue.js` | `llm-calls` | analysisWorker | llmWorker |
| `blockQueue.js` | `block-aggregation` | llmWorker (every 8 segments) | blockAggregatorWorker |
| `insightAggregationQueue.js` | `insight-aggregation` | llmWorker + blockAggregatorWorker | insightAggregatorWorker |
| `globalContextQueue.js` | `global-context` | transcriptAggregatorWorker | globalContextWorker |
| `reportQueue.js` | `report-generator` | insightAggregatorWorker | reportGeneratorWorker |
| `chatQueue.js` | `chat-query` | chatRoutes POST /api/chat | chatWorker |

### Job ID Conventions (Idempotency Guards)

| Job | jobId Pattern | Purpose |
|---|---|---|
| Window diarization | `diarize-${windowId}` | One diarization per window |
| Window cleaning | `clean-${windowId}` | One clean per window |
| Window grouping | `group-${windowId}` | One group per window |
| Full transcript grouping | `group-${mediaId}` | One group per session |
| Global context | `context-${mediaId}` | One global context per session |
| LLM segment | `llm-${mediaId}-${segmentId}` | One LLM call per segment |
| Analysis dispatch | `analysis-${mediaId}-${i}` or `analysis-${segmentId}` | No duplicate dispatches |
| Block aggregation | `block-${mediaId}-${blockId}` | One block job per blockId |
| Final aggregation | `final-aggregate-${mediaId}` | **Same in both llmWorker and blockAggregatorWorker** |
| Report generation | `create-session-report-${mediaId}` | One report per session |

---

## 8. Models — MongoDB Schemas

### Transcript
```javascript
{
  mediaId:   String,
  segments:  [{ segmentId, speakerId, start, end, text }],
  status:    String,   // "raw" | "cleaned" | "grouped"
  createdAt: Date,
  updatedAt: Date
}
```

### SegmentAnalysis
Compound unique index on `{ mediaId, segmentId }`.  
`segmentId` is `Mixed` type — supports both `Number` (Path B) and `String` (Path A window IDs).
```javascript
{
  mediaId:      String,  // indexed
  segmentId:    mongoose.Schema.Types.Mixed,  // Number | String
  topics:       [String],
  insights:     [String],
  questions:    [String],
  decisions:    [String],
  action_items: [String],
  summary:      String,
  createdAt:    Date,
  updatedAt:    Date
}
```

**Segment ID formats:**
| Path | Example | Type |
|---|---|---|
| A (window-based) | `"session_123-window-0-3-0"` | String |
| B (full transcript) | `0`, `1`, `2` | Number |

### BlockAnalysis
Unique compound index on `{ mediaId, blockId }`.
```javascript
{
  mediaId:      String,    // indexed
  blockId:      Number,    // 0-based block index (8 segments per block)
  segments:     [Number],  // segment IDs in this block: [0,1,2,3,4,5,6,7]
  start:        Number,    // seconds from first segment
  end:          Number,    // seconds from last segment
  duration:     Number,    // end - start
  topics:       [String],
  insights:     [String],
  questions:    [String],
  decisions:    [String],
  action_items: [String],
  summary:      String,    // merged segment summaries
  createdAt:    Date,
  updatedAt:    Date
}
```

### SessionContext
Document-level AI summary of the full transcript. Global view used to seed the final dedup pass.
```javascript
{
  mediaId:   String,    // indexed
  summary:   String,    // 2-sentence session summary
  topics:    [String],  // max 10 key topics (full transcript)
  insights:  [String],  // max 10 insights (full transcript)
  createdAt: Date,
  updatedAt: Date
}
```

### SessionReport
Human-readable formatted report. Generated by `reportGeneratorWorker` after intelligence is ready.
```javascript
{
  mediaId:   String,    // indexed
  content:   String,    // emoji-prefixed sections: topics, insights, decisions, action items
  createdAt: Date,
  updatedAt: Date
}
```

### Session
```javascript
{
  title:     String,
  createdAt: Date
}
```

### Analysis
Used by `analysisWorker` for rolling context. Legacy — new code reads from `SegmentAnalysis`.
```javascript
{
  mediaId:     String,
  segmentId:   Number,
  topics:      [String],
  insights:    [String],
  summary:     String,
  questions:   [String],
  decisions:   [String],
  actionItems: [String],
  createdAt:   Date
}
```

---

## 9. Services — Complete Reference

### AIAnalysisService (`src/services/AIAnalysisService.js`)

```javascript
// Primary method — Groq direct call (throws on error, BullMQ retries)
async analyzeGroq(text, previousContext = "")
  → { topics[], insights[], summary, questions[], decisions[], action_items[] }

// Fallback method — Gemini direct call (throws on error, BullMQ retries)
async analyzeGemini(text, previousContext = "")
  → same structure

// Plain text chat response — used by chatWorker
async groqChat(prompt, temperature = 0.2)
  → String (plain text answer, no JSON parsing)

// Full-transcript holistic analysis — used by globalContextWorker
async analyzeGlobal(text)
  → { topics[] (max 2, must be specific), insights[] (max 2), summary }

// Single-call semantic dedup for all 4 categories — preferred
async deduplicateAll(intelligence)
  → { ...intelligence, topics[], insights[], questions[], action_items[] }
  caps: topics 10, insights 10, questions 6, action_items 8
  short-circuits if all within caps (0 LLM calls)

// Legacy per-category dedup — deprecated, use deduplicateAll
async deduplicateItems(label, items)
```

**Prompt quality rules** (enforced in `_buildAnalyzePrompt`):
- topics: max 2, must be specific (reject "AI", "coding", "technology")
- insights: max 2, non-obvious observations only
- questions: max 1, unresolved open questions only
- decisions: max 2, explicitly stated only
- action_items: max 2, concrete with clear owner/next step

### TranscriptBufferService (`src/services/TranscriptBufferService.js`)

```javascript
addChunk(mediaId, chunkIndex, text)
  → returns window object if ready, or null

  Window emission logic:
    WINDOW_SIZE = 4 consecutive chunks
    WINDOW_STRIDE = 2 (emit every 2nd eligible chunk → halves queue load)
    isContinuous() guard — rejects windows with gaps in chunk sequence
    processedWindows Set — prevents duplicate window processing

cleanup(mediaId)
  → releases buffers Map entry and processedWindows entries for this session
  called by insightAggregatorWorker after SESSION_INTELLIGENCE_READY
```

**Window ID format**: `${mediaId}-window-${startChunk}-${endChunk}`  
**Segment ID format (within window)**: `${windowId}-${segmentIndex}`

### SegmentGrouper (`src/services/SegmentGrouper.js`)

```javascript
static groupSegments(segments)
  → 90-second time-based grouping
     bucket = Math.floor(segment.start / 90)
  → deterministic, stable across runs
  → return [{ segmentId, start, end, duration, text }]
```

### SpeakerSegmentationService (`src/services/SpeakerSegmentationService.js`)

```javascript
static segment(transcript)
  1. split by sentence-ending punctuation
  2. assign alternating speakerIds (speaker_001, speaker_002, ...)
  3. merge consecutive same-speaker sentences
  4. estimate timestamps (5s per segment)
  → [{ segmentId, speakerId, start, end, text }]
```

### providerRouter (`src/services/providerRouter.js`)

```javascript
getProvider()    → "groq" (70%) | "gemini" (30%)  — weighted random
listProviders()  → ["groq", "gemini"]
```

### EventService (`src/services/EventService.js`)

```javascript
async emit(event, payload)
  topic = event.toLowerCase().replace(/_/g, "-")
  sends JSON payload to Kafka
  fails silently (pipeline continues if Kafka is down)
```

### Other Services

| Service | Key Method | Purpose |
|---|---|---|
| `AudioService` | `extractAudio(videoPath)` | FFmpeg: extract .wav from video |
| `ChunkService` | `splitAudio(audioPath)` | FFmpeg: split into 30s .wav chunks |
| `StorageService` | `uploadChunks(dir, mediaId, count)` | Upload chunks to MinIO, trigger Kafka + Redis |
| `WhisperService` | `transcribe(audioPath)` | Run whisper-cli.exe, return transcript text |
| `TranscriptService` | `saveChunk / merge / isComplete` | File I/O: chunk_N.txt files + final merge |
| `TranscriptCleaner` | `cleanSegments(segments)` | Strip [noise] markers, normalise whitespace, dedup |
| `SpeakerService` | `process(mediaId, transcript)` | Coordinates full-transcript diarization |

---

## 10. Configuration

### Environment Variables (`.env`)

```env
# Server
PORT=5000

# MongoDB
MONGO_URI=mongodb://127.0.0.1:27017/ai_meeting_assistant

# AI Providers
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...

# Kafka
KAFKAJS_NO_PARTITIONER_WARNING=1

# Whisper (set these for transcription)
WHISPER_MODEL_PATH=D:/ai-tools/whisper.cpp/models/ggml-base.bin
WHISPER_EXECUTABLE=D:/ai-tools/whisper.cpp/build/bin/Release/whisper-cli.exe

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=password123

# Redis (default: 127.0.0.1:6379 — override if remote)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

### Infrastructure Services (`infrastructure/docker-compose.yml`)

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

**Redis and MongoDB run locally** (not in Docker).

---

## 11. File Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── db.js                        # MongoDB connection (mongoose)
│   │   ├── redis.js                     # ioredis singleton (host: 127.0.0.1:6379)
│   │   ├── kafka.js                     # Kafka producer/consumer
│   │   └── minio.js                     # MinIO client
│   ├── controllers/
│   │   └── UploadController.js          # orchestrates: extractAudio → splitAudio → uploadChunks
│   ├── models/
│   │   ├── Session.js
│   │   ├── Transcript.js                # status: raw → cleaned → grouped
│   │   ├── Analysis.js                  # legacy rolling-context store
│   │   ├── SegmentAnalysis.js           # segmentId: Mixed (Number | String)
│   │   ├── BlockAnalysis.js             # 8 segments per block; unique { mediaId, blockId }
│   │   ├── SessionContext.js            # full-transcript AI summary
│   │   └── SessionReport.js            # ★ Phase E: human-readable formatted report
│   ├── queues/
│   │   ├── transcriptionQueue.js        # "transcriptionQueue"
│   │   ├── windowDiarizationQueue.js    # "window-diarization"
│   │   ├── aggregationQueue.js          # "transcript-aggregation"
│   │   ├── diarizationQueue.js          # "speaker-diarization"
│   │   ├── cleanerQueue.js              # "transcript-cleaner"
│   │   ├── grouperQueue.js              # "segment-grouper"
│   │   ├── analysisQueue.js             # "analysisQueue"
│   │   ├── llmQueue.js                  # "llm-calls" (rate-limited)
│   │   ├── blockQueue.js                # "block-aggregation"
│   │   ├── insightAggregationQueue.js   # "insight-aggregation"
│   │   ├── globalContextQueue.js        # "global-context"
│   │   ├── reportQueue.js              # ★ Phase E: "report-generator"
│   │   └── chatQueue.js                # ★ Phase E: "chat-query"
│   ├── routes/
│   │   ├── uploadRoutes.js              # POST /api/upload (multer)
│   │   └── chatRoutes.js               # ★ Phase E: GET /report/:id, POST /chat
│   └── services/
│       ├── AIAnalysisService.js         # Groq + Gemini, retry, dedup, groqChat
│       ├── providerRouter.js            # 70% Groq / 30% Gemini weighted routing
│       ├── AudioService.js              # FFmpeg audio extraction
│       ├── ChunkService.js              # FFmpeg 30s chunk splitting
│       ├── EventService.js              # Kafka event emission
│       ├── InsightAggregator.js
│       ├── JobService.js                # transcriptionQueue job helper
│       ├── KafkaService.js
│       ├── QueueService.js
│       ├── SegmentGrouper.js            # 90s time-based grouping
│       ├── SpeakerSegmentationService.js # alternating-speaker heuristic
│       ├── SpeakerService.js
│       ├── storageService.js            # MinIO upload + trigger
│       ├── TranscriptBufferService.js   # Sliding window buffer (WINDOW_SIZE=4, STRIDE=2)
│       ├── TranscriptCleaner.js         # noise strip, dedup
│       ├── TranscriptService.js         # file I/O for chunks
│       └── WhisperService.js            # whisper-cli.exe runner
├── workers/
│   ├── transcriptionWorker.js           # Whisper, buffer, window trigger
│   ├── windowDiarizationWorker.js       # Path A: 4-chunk early diarization
│   ├── transcriptAggregatorWorker.js    # Path B: full merge → diarization + global context
│   ├── speakerDiarizationWorker.js      # Path B: full-transcript speaker assignment
│   ├── transcriptCleanerWorker.js       # Dual-path: cleans window or full segments
│   ├── segmentGrouperWorker.js          # Dual-path: 90s grouping + analysis dispatch
│   ├── analysisWorker.js                # Dispatcher: analysisQueue → llm-calls (×5)
│   ├── llmWorker.js                     # LLM router: Groq/Gemini, rate limit, blocks
│   ├── blockAggregatorWorker.js         # Hierarchical: 8 segments → 1 block
│   ├── insightAggregatorWorker.js       # Final: blocks → intelligence → report trigger
│   ├── globalContextWorker.js           # Parallel: full-transcript holistic analysis
│   ├── reportGeneratorWorker.js        # ★ Phase E: formats + saves session report
│   └── chatWorker.js                   # ★ Phase E: chat Q&A using report as context
├── transcripts/                         # chunk_N.txt + final_transcript.txt
├── uploads/
│   └── chunks/                          # 30s audio chunk files
├── server.js                            # Express app: /api/upload, /api/report, /api/chat
└── package.json                         # type: "module", dependencies
```

---

## 12. Starting All Workers

Each worker is a standalone Node.js process. Open one terminal per worker:

```bash
# ── TRANSCRIPTION PIPELINE ──────────────────────────────────────────────────
# Terminal 1 — Transcription (Whisper, buffer, window trigger)
cd backend && node workers/transcriptionWorker.js

# Terminal 2 — Window Diarization (Path A: 4-chunk early partial analysis)
cd backend && node workers/windowDiarizationWorker.js

# Terminal 3 — Transcript Aggregator (Path B: merge all chunks)
cd backend && node workers/transcriptAggregatorWorker.js

# Terminal 4 — Speaker Diarization (Path B: full-transcript speaker assignment)
cd backend && node workers/speakerDiarizationWorker.js

# Terminal 5 — Transcript Cleaner (dual-path: window + full)
cd backend && node workers/transcriptCleanerWorker.js

# Terminal 6 — Segment Grouper (dual-path + 120-char filter)
cd backend && node workers/segmentGrouperWorker.js

# ── AI ANALYSIS PIPELINE ────────────────────────────────────────────────────
# Terminal 7 — Analysis Dispatcher (analysisQueue → llm-calls, concurrency 5)
cd backend && node workers/analysisWorker.js

# Terminal 8 — LLM Router (Groq 70% / Gemini 30%, rate-limited 20/60s, concurrency 2)
cd backend && node workers/llmWorker.js

# Terminal 9 — Block Aggregator (8 segments/block, concurrency 3)
cd backend && node workers/blockAggregatorWorker.js

# Terminal 10 — Global Context (full-transcript holistic analysis, concurrency 1)
cd backend && node workers/globalContextWorker.js

# Terminal 11 — Insight Aggregator (final intelligence + triggers report)
cd backend && node workers/insightAggregatorWorker.js

# ── PRODUCT LAYER (Phase E) ─────────────────────────────────────────────────
# Terminal 12 — Report Generator (formats session report, saves to MongoDB)
cd backend && node workers/reportGeneratorWorker.js

# Terminal 13 — Chat Worker (answers questions using session report as context)
cd backend && node workers/chatWorker.js

# ── API SERVER ───────────────────────────────────────────────────────────────
# Terminal 14 — Express API Server
cd backend && node server.js
```

### Infrastructure Checklist

Before starting workers, ensure these are running:

| Service | Command | Port | Required By |
|---|---|---|---|
| Redis | `redis-server` | 6379 | All workers (BullMQ) |
| MongoDB | `mongod` | 27017 | 9 workers |
| Kafka + Zookeeper | `docker compose up -d` | 9092 | Event streaming |
| MinIO | `docker compose up -d` | 9000 | StorageService |

> **Redis** must be running first — all workers fail to start without it.  
> **Kafka failure** is non-fatal — EventService logs errors but pipeline continues.

---

## 13. Implementation Phases

### Phase 1 — Core Infrastructure ✅
Express upload API, FFmpeg audio extraction and chunk splitting, MinIO storage.

### Phase 2 — Transcription Pipeline ✅
Whisper.cpp per-chunk transcription (parallel), completion detection, transcript merging.

### Phase 3 — Speaker Diarization ✅
Sentence-level segmentation, alternating speaker IDs, timestamp estimation, MongoDB persistence.

### Phase 4 — Transcript Enhancement ✅
Noise marker stripping (TranscriptCleaner), 90s time-based grouping (SegmentGrouper), status lifecycle: `raw → cleaned → grouped`.

### Phase 5 — AI Analysis & Session Intelligence ✅
Per-segment Groq analysis, rolling previous-context window, parallel segment processing, exact-string + LLM semantic deduplication, `SESSION_INTELLIGENCE_READY`.

### Phase 6 — Global Context Layer ✅
Full-transcript parallel pipeline: split into ≤1500-word chunks, `analyzeGlobal()` per chunk, merge, `SessionContext` saved to MongoDB. Seeded into final dedup pass by `insightAggregatorWorker`.

### Phase 6.1 — Pipeline Stabilization ✅
Race condition fix (SessionContext polling), aggregation dedup via `jobId`, dual-provider AI with exact retry delay parsing.

### Phase 6.2 — LLM Call Optimization ✅
Global context chunk size 330 → 1500 words (−80% calls), single-chunk shortcut, `deduplicateAll()` replaces 4 × `deduplicateItems()` (−75% dedup calls). Net: **30–40% fewer LLM calls per session**.

### Phase 6.3 — LLM Queue + Rate Limiter + Provider Router ✅
`llm-calls` queue with BullMQ limiter (20/60s). `analysisWorker` pure dispatcher. `llmWorker` dedicated LLM router. `providerRouter` (70% Groq / 30% Gemini). Per-segment 120-char filter (−20–40% LLM calls).

### Phase 6.4 — Rate Limit Resilience + Full EDA Events ✅
Backoff uses `min(groqDelay, geminiDelay)` (not max). Full Kafka event coverage across all workers.

### Phase 6.5 — Idempotency & Restart Safety ✅
DB idempotency guard in `llmWorker` (skips already-analyzed segments). Rolling context race fix (`summary: { $exists: true }`). Dispatcher dedup (`jobId` on analysisQueue). Aggregation dedup logging.

### Phase B — Hierarchical Intelligence ✅
Time-based 90s grouping. Block aggregation (8 segments/block). `BlockAnalysis` collection. `insightAggregatorWorker` reads 40 blocks instead of 320 segments. **80–90% fewer LLM calls** for long sessions.

### Phase C — Sliding Window Buffer + Dual-Path Architecture ✅
`TranscriptBufferService` (WINDOW_SIZE=4, STRIDE=2, continuity guard). `windowDiarizationWorker`. Path A / Path B parallel pipelines. `SegmentAnalysis.segmentId` changed to `Mixed` type. 120s to first insights.

### Phase D — Pipeline Stabilization & Bug Fixes ✅
6 critical bugs fixed (March 2026):

| # | Bug | Fix |
|---|---|---|
| 1 | Duplicate `jobId` key in object literal | `analysisWorker.js` |
| 2 | Window explosion (100 chunks → 97 windows) | `WINDOW_STRIDE = 2` in `TranscriptBufferService` |
| 3 | Missing continuity check for gaps | `isContinuous()` guard in `TranscriptBufferService` |
| 4 | Rolling context broken for string segmentIds | `typeof segmentId === 'number'` guard in `llmWorker` |
| 5 | Double insight aggregation (mismatched jobIds) | Unified `final-aggregate-${mediaId}` in both workers |
| 6 | No Redis cleanup on completed insight jobs | `removeOnComplete: { count: 10 }` in `insightAggregatorWorker` |

### Phase E — Product Layer: Report + Chat ✅ (March 18, 2026)

4 bugs found and fixed during implementation:

| # | Bug | Fix |
|---|---|---|
| 1 | `reportQueue` name mismatch (`report-queue` vs `report-generator`) | Fixed queue name in `reportQueue.js` |
| 2 | Broken template literals in `reportGeneratorWorker` | Switched to array-join pattern |
| 3 | Missing `connectDB()` in `reportGeneratorWorker` | Added DB connection |
| 4 | `waitUntilFinished()` needs `QueueEvents` instance | Added `QueueEvents` in `chatRoutes.js` |
| 5 | Duplicate Mongoose index in `BlockAnalysis.js` | Removed redundant non-unique index |

New components:
- `SessionReport` model, `reportQueue`, `chatQueue`
- `reportGeneratorWorker`, `chatWorker`
- `chatRoutes` (`GET /api/report/:mediaId` + `POST /api/chat`)
- `chatRoutes` registered in `server.js`

---

## 14. Troubleshooting

| Problem | Likely Cause | Solution |
|---|---|---|
| Worker exits immediately | Redis not running | `redis-cli ping` — must return PONG |
| Kafka connection error | Docker containers down | `docker ps` — confirm kafka + zookeeper running |
| MongoDB connection failed | mongod not started | Check `MONGO_URI` in `.env`, confirm `mongod` running |
| Whisper produces empty output | Wrong binary/model path | Test: run `whisper-cli.exe -m <model> -f <wav>` manually |
| AI JSON parse error | Invalid API key | Check `GROQ_API_KEY` and `GEMINI_API_KEY` in `.env` |
| No window after 4 chunks | Old code without STRIDE | Verify `WINDOW_STRIDE = 2` in `TranscriptBufferService.js` |
| Window skipped despite 4 chunks | Non-consecutive chunks | Normal — `isContinuous()` rejects gaps. Wait for retry. |
| SESSION_INTELLIGENCE_READY fires twice | Mismatched `jobId` | Both `llmWorker` + `blockAggregatorWorker` must use `final-aggregate-${mediaId}` |
| Report not found (404) | Pipeline still running | Wait for `📄 Report generated for...` log in `reportGeneratorWorker` |
| Chat returns 500 | `chatWorker` not started | Ensure terminal 13 is running: `node workers/chatWorker.js` |
| Chat times out (30s) | Worker crashed or queue backed up | Check `chatWorker` logs; check Redis queue depth |
| Duplicate Mongoose index warning | `BlockAnalysis.js` had two identical indexes | Already fixed in Phase E — update code if seeing this |

---

## Statistics

| Metric | Value |
|---|---|
| Total workers | 13 |
| Total BullMQ queues | 13 |
| Total MongoDB models | 7 |
| Total API endpoints | 3 (upload, report, chat) |
| Kafka events | 16 |
| LLM calls saved vs naïve | 85–95% (blocks + dedup optimizations) |
| Time to first insight | ~120 seconds (Path A window) |
| Time to complete insight | Session length + ~2 min processing |
| Chat response time | < 5s typical |
| Workers requiring MongoDB | 9 of 13 |
| All workers startup tested | ✅ 14/14 (13 workers + server) |
