# Implementation Plan: Sequential Window Processing

Ensure `analysisWorker.js` processes one window at a time and waits for all its segments to be completed by `llmWorker.js` before starting the next window.

## Proposed Changes

### [Component: Workers]

#### [MODIFY] [segmentGrouperWorker.js](file:///d:/ai-meeting-assistant/backend/workers/segmentGrouperWorker.js)
- Replace parallel segment enqueuing to `analysisQueue` with a single batch job.
- The new job `analyze-batch` will contain an array of segments to be analyzed.
- Use `analysis-batch-${windowId}` or `analysis-batch-${mediaId}` as the `jobId` for idempotency.

#### [MODIFY] [analysisWorker.js](file:///d:/ai-meeting-assistant/backend/workers/analysisWorker.js)
- Update the worker to handle the `analyze-batch` job type.
- Set `concurrency: 1` to ensure only one window is processed at a time.
- In the worker:
    1. Iterate over segments in the batch and add them to `llmQueue`.
    2. Use `QueueEvents` to wait for all dispatched LLM jobs to complete using `Job.waitUntilFinished`.
    3. Emit `SEGMENT_DISPATCHED` events as before for each segment.

## Verification Plan

### Automated Tests
- Create a test script `scripts/verify_sequential_analysis.js` that:
    1. Enqueues two windows of segments to `analysisQueue`.
    2. Monitors `analysisWorker` and `llmWorker` logs.
    3. Asserts that Window 2 segments are only added to `llmQueue` after Window 1 segments are finished.

### Manual Verification
- Run the backend pipeline with a sample audio file.
- Observe terminal logs to verify the sequential processing of windows.
