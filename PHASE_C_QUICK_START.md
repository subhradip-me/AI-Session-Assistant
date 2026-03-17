# Quick Start: Phase C Sliding Window Buffer

## What Changed?

The pipeline now processes transcripts in **two parallel paths**:

| Path | Trigger | Start Time | Use Case |
|------|---------|-----------|----------|
| **A: Window** | After 4 chunks (120s) | Early (~2 min in) | Live feedback, reduced latency |
| **B: Full** | All chunks done | At end | Complete context, session summary |

---

## How It Works

### Step 1: Transcription Worker (unchanged behavior, new buffer integration)

```javascript
// After each chunk is transcribed:
import TranscriptBufferService from "../src/services/TranscriptBufferService.js";

const transcript = await WhisperService.transcribe(chunkPath);
const window = TranscriptBufferService.addChunk(mediaId, chunkIndex, transcript);

if (window) {
  // When 4 consecutive chunks are collected:
  await windowDiarizationQueue.add("diarize-window", {
    mediaId: window.mediaId,
    windowId: window.windowId,
    combinedText: window.chunks.map(c => c.text).join(" ")
  });
}
```

### Step 2: Window Diarization Worker (NEW)

```
windowDiarizationQueue
  → Receives window of 4 chunks
  → Segments into sentences + assign speakers
  → Creates segments with windowId (string ID)
  → Queues for cleaning
```

### Step 3: Dual Cleaning

```javascript
// transcriptCleanerWorker now handles:
if (job.data.windowId) {
  // WINDOW PATH: clean window segments, emit WINDOW_CLEAN_READY
} else {
  // FULL PATH: clean full transcript segments, emit CLEAN_TRANSCRIPT_READY
}
```

### Step 4: Dual Grouping

```javascript
// segmentGrouperWorker now handles both:
if (job.data.windowId) {
  // WINDOW PATH: group window segments → early analysis queued
} else {
  // FULL PATH: group full segments → standard analysis queued
}
```

### Step 5: Single Analysis + Aggregation

Both paths feed the same `analysisQueue` and `llmWorker`:
- Window segments: `segmentId = "window-0-3-0"` (string)
- Full segments: `segmentId = 0, 1, 2, ...` (number)

MongoDB stores both in same table with Mixed type.

### Step 6: Final Intelligence

`insightAggregatorWorker` aggregates from both paths, then:
```javascript
// Cleanup memory
TranscriptBufferService.cleanup(mediaId);
```

---

## Segment ID Format

### Window Path
```
segmentId: "session_123-window-0-3-0"
           └─ window with chunks 0-3, segment 0 in that window
```

### Full Path
```
segmentId: 0, 1, 2, ...
           └─ numeric, sequential across entire transcript
```

Both stored in `SegmentAnalysis.segmentId` as Mixed type.

---

## Key Classes/Methods

### TranscriptBufferService

```javascript
import TranscriptBufferService from "../src/services/TranscriptBufferService.js";

// Add chunk to buffer, returns { windowId, mediaId, chunks, chunkRange } if ready
const window = TranscriptBufferService.addChunk(mediaId, chunkIndex, text);

// Get buffer size
const size = TranscriptBufferService.getBufferSize(mediaId);

// Clean up after session
TranscriptBufferService.cleanup(mediaId);
```

### Window Diarization Worker

Queue: `window-diarization`

Input:
```javascript
{
  mediaId: "session_...",
  windowId: "session_...-window-0-3",
  combinedText: "full text of 4 chunks joined..."
}
```

Output: Segments with string IDs queued to `cleanerQueue`

---

## New Kafka Events

| Event | When |
|-------|------|
| `WINDOW_DIARIZATION_QUEUED` | Buffer window becomes ready (4 chunks) |
| `WINDOW_DIARIZATION_READY` | Window diarization complete |
| `WINDOW_CLEAN_READY` | Window segments cleaned |
| `WINDOW_GROUPED_READY` | Window segments grouped |

---

## MongoDB: SegmentAnalysis

Schema update:
```javascript
segmentId: {
  type: mongoose.Schema.Types.Mixed,  // ← NOW SUPPORTS BOTH
  required: true
}
```

Query examples:
```javascript
// Find all segments from a window
SegmentAnalysis.find({ 
  mediaId, 
  segmentId: /^session_.*-window-0-3-/ 
});

// Find all numeric-id segments (full path)
SegmentAnalysis.find({ 
  mediaId, 
  segmentId: { $type: "int" } 
});
```

---

## Worker Startup (Updated Order)

```bash
# 1. Transcription (triggers buffer + window pipeline)
node workers/transcriptionWorker.js

# 2. Window Diarization (processes windows in real-time)
node workers/windowDiarizationWorker.js

# 3-10. (other workers unchanged)
node workers/transcriptAggregatorWorker.js    # Full pipeline
node workers/speakerDiarizationWorker.js      # Full pipeline
node workers/transcriptCleanerWorker.js       # Dual-path
node workers/segmentGrouperWorker.js          # Dual-path
node workers/analysisWorker.js                # Dispatcher
node workers/llmWorker.js                     # AI analysis
node workers/blockAggregatorWorker.js         # Phase B
node workers/insightAggregatorWorker.js       # Cleanup here
node workers/globalContextWorker.js           # Full context
```

---

## Testing: 8-Chunk Session

Expected behavior:
```
Chunk 0-2: No window (buffer < 4)
Chunk 3: Window 0-3 created & queued ✓
Chunk 4: Window 1-4 created & queued ✓
Chunk 5: Window 2-5 created & queued ✓
Chunk 6: Window 3-6 created & queued ✓
Chunk 7: Window 4-7 created & queued ✓

All chunks done → Full aggregation pipeline starts
```

Logs on transcriptionWorker:
```
🪟 Window ready: session_1773052227650-window-0-3 (chunks 0-3)
🪟 Window ready: session_1773052227650-window-1-4 (chunks 1-4)
...
```

---

## Common Tasks

### Add Window Support to Custom Worker

```javascript
const { mediaId, windowId, segments } = job.data;
const isWindowJob = !!windowId;

if (isWindowJob) {
  // Handle window path
  console.log(`Processing window: ${windowId}`);
} else {
  // Handle full transcript path
  console.log(`Processing full transcript: ${mediaId}`);
}
```

### Query Segments by Path

```javascript
// Window segments only
const windowSegs = await SegmentAnalysis.find({
  mediaId,
  segmentId: { $type: "string" }
});

// Full transcript segments only
const fullSegs = await SegmentAnalysis.find({
  mediaId,
  segmentId: { $type: "int" }
});

// Both
const allSegs = await SegmentAnalysis.find({ mediaId });
```

### Check Buffer State

```javascript
import TranscriptBufferService from "../src/services/TranscriptBufferService.js";

const size = TranscriptBufferService.getBufferSize(mediaId);
console.log(`Buffer has ${size} chunks`);

const buffer = TranscriptBufferService.getBuffer(mediaId);
console.log(buffer);  // [ { chunkIndex: 0, text: "..." }, ... ]
```

---

## Performance Impact

| Metric | Before | After | Impact |
|--------|--------|-------|--------|
| Time to first analysis | After full transcript | 120-150s | ~5x faster |
| Memory peak | Full buffer then cleanup | Continuous 4-chunk buffer | Lower peak |
| LLM calls | Same | Same | None |
| Latency for insights | Session end | 2 min in | Dramatic improvement |

---

## Troubleshooting

### Windows not being created

- Check `transcriptionWorker` logs for buffer size
- Verify chunks are being saved correctly
- Window requires exactly 4 consecutive chunks

### Segments not analyzed

- Check `windowDiarizationQueue` jobs in Redis
- Verify `windowDiarizationWorker` is running
- Check for segmentId filtering issues

### Memory not cleaning up

- Ensure `SESSION_INTELLIGENCE_READY` is emitted
- Check `insightAggregatorWorker` logs for cleanup call
- Manually call `TranscriptBufferService.clearAll()` if needed

### Mixed segmentId queries failing

- Use `$type: "string"` or `$type: "int"` in MongoDB queries
- Regex works for string IDs: `/^session_.*-window-/`

---

## Future: Streaming Mode

To enable live streaming:
1. Don't wait for `totalChunks` in transcriptionWorker
2. Keep buffer running indefinitely
3. Process windows as they become ready
4. Send partial summaries to frontend in real-time

Current implementation is **ready** for this — just needs client-side UI.
