# Multi-User Session Isolation

## Planning
- [x] Read all 14 workers, 5 models, UploadController, JobService, EventService, storageService
- [x] Write implementation plan

## Models (add userId field + index)
- [x] `Session.js` — add mediaId, userId, title, timestamps
- [x] `SegmentAnalysis.js` — add userId field + compound index update
- [x] `BlockAnalysis.js` — add userId field + compound index update
- [x] `SessionContext.js` — add userId field
- [x] `SessionReport.js` — add userId field

## Upload entry point (inject userId)
- [x] `uploadRoutes.js` — add `authenticate` middleware before existing upload handler
- [x] `UploadController.js` — read `req.user.userId`, pass it to `StorageService.uploadChunks()`
- [x] `StorageService.js` — accept and forward userId to `EventService.emitChunkCreated()`
- [x] `EventService.js` — accept userId in `emitChunkCreated()`, forward to `JobService.enqueueChunk()`
- [x] `JobService.js` — include userId in transcriptionQueue job data

## Worker pipeline (thread userId through every hop)
- [x] `transcriptionWorker.js` — destructure userId, pass to aggregationQueue and windowDiarizationQueue
- [x] `transcriptAggregatorWorker.js` — destructure userId, pass to diarizationQueue + globalContextQueue
- [x] `speakerDiarizationWorker.js` — destructure userId, pass to cleanerQueue
- [x] `transcriptCleanerWorker.js` — destructure userId, pass to grouperQueue
- [x] `segmentGrouperWorker.js` — destructure userId, pass to analysisQueue per segment
- [x] `analysisWorker.js` — destructure userId, pass to llmQueue
- [x] `llmWorker.js` — destructure userId, write to SegmentAnalysis with userId, pass to blockQueue and insightAggregationQueue
- [x] `blockAggregatorWorker.js` — destructure userId, write to BlockAnalysis with userId, pass to embeddingQueue
- [x] `insightAggregatorWorker.js` — destructure userId, filter reads by userId
- [x] `globalContextWorker.js` — destructure userId, write to SessionContext with userId
- [x] `embeddingWorker.js` — destructure userId, include in Qdrant payload
- [x] `reportGeneratorWorker.js` — destructure userId, write SessionReport with userId
- [x] `windowDiarizationWorker.js` — read and pass userId
- [x] `chatWorker.js` — receive userId, pass to retrieve()

## Vector DB (userId in payload + filter)
- [x] `vectorService.js` — add userId param to `searchVectorInCollection()` filter
- [x] `retrieverService.js` — accept userId, pass to `searchVectorInCollection()`

## Secure API layer
- [x] `uploadRoutes.js` — authenticate middleware
- [x] `chatRoutes.js` — authenticate existing /chat and /report/:mediaId
- [x] Queries: `findOne({ mediaId, userId })` everywhere

## Verification
- [ ] Manual: register, upload, verify session scoped in MongoDB
- [ ] Manual: confirm cross-user data isolation works
