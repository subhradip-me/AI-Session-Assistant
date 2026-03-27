import SessionState from "../models/SessionState.js";
import SegmentAnalysis from "../models/SegmentAnalysis.js";
import BlockAnalysis from "../models/BlockAnalysis.js";
import SessionReport from "../models/SessionReport.js";
import SessionContext from "../models/SessionContext.js";
import Transcript from "../models/Transcript.js";
import RetrievalFeedback from "../models/RetrievalFeedback.js";
import { llmQueue } from "../queues/llmQueue.js";
import { blockQueue } from "../queues/blockQueue.js";
import { embeddingQueue } from "../queues/embeddingQueue.js";
import { insightAggregationQueue } from "../queues/insightAggregationQueue.js";
import cleanerQueue from "../queues/cleanerQueue.js";
import TranscriptService from "./TranscriptService.js";
import SpeakerSegmentationService from "./SpeakerSegmentationService.js";
import { drainSessionJobs } from "../utils/queueDrain.js";

// ─── Concurrency Guard ────────────────────────────────────────────────────────

/**
 * Throw if the session is currently mid-pipeline.
 * Prevents retry + reprocess running simultaneously — which causes race conditions
 * and corrupted counts in SessionState.
 */
async function assertNotProcessing(mediaId) {
  const state = await SessionState.findOne({ mediaId });

  if (!state) throw new Error(`Session ${mediaId} not found`);

  const activeStatuses = ["transcribing", "diarizing", "analyzing", "aggregating", "reporting"];
  if (activeStatuses.includes(state.status)) {
    // Allow reprocess/retry if the session has been stuck for >30 minutes.
    // This covers crashed workers that left a session in an "active" status forever.
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    const lastUpdate = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
    const isStale = (Date.now() - lastUpdate) > STALE_THRESHOLD_MS;

    if (!isStale) {
      throw new Error(
        `Session ${mediaId} is currently ${state.status} — wait for it to succeed or fail before retrying`
      );
    }

    console.warn(
      `⚠️  assertNotProcessing: session ${mediaId} has been stuck in "${state.status}" ` +
      `for ${Math.round((Date.now() - lastUpdate) / 60000)} min — treating as stale, allowing override`
    );
  }
}

// ─── Retry ────────────────────────────────────────────────────────────────────

/**
 * Re-queue only the broken/missing jobs for a failed or partial session.
 * Surgical — does NOT delete any existing data.
 *
 * @param {string} mediaId
 * @param {string|null} stage — "analysis" | "blocks" | "embedding" | "report" | null (→ all)
 */
export async function retry(mediaId, stage) {
  // ── Guard: prevent concurrent ops ─────────────────────────────────────────
  await assertNotProcessing(mediaId);

  const state = await SessionState.findOne({ mediaId });
  if (!state) throw new Error(`Session ${mediaId} not found`);

  // ── Auto-detect stuck stage if no explicit stage given ─────────────────────
  // Walk the pipeline steps in order and find the first non-completed one.
  // This lets the UI call retry with no stage and always hit the right place.
  let stageToRetry = stage?.toLowerCase() ?? null;

  if (!stageToRetry) {
    const steps = state.steps;
    if (steps.grouping?.status !== "completed") {
      // Grouping hasn't finished — restart from cleaner
      stageToRetry = "grouping";
    } else if (steps.analysis?.status !== "completed") {
      stageToRetry = "analysis";
    } else if (steps.blocks?.status !== "completed") {
      stageToRetry = "blocks";
    } else if (steps.report?.status !== "completed") {
      stageToRetry = "report";
    } else {
      stageToRetry = "all"; // complete — just mark done
    }
    console.log(`🔁 Retry [${mediaId}]: auto-detected stuck stage → "${stageToRetry}"`);
  }

  // Mark session as analyzing so the guard blocks duplicate calls
  await SessionState.updateOne(
    { mediaId },
    { $set: { status: "analyzing", error: null } }
  );

  // ── Load transcript once — needed by analysis and block stages ─────────────
  const transcript = await Transcript.findOne({ mediaId });
  const allSegmentIds = transcript?.segments?.map((_, i) => i) ?? [];
  const totalSegments = allSegmentIds.length;

  // ── Retry grouping: restart from cleaner stage ─────────────────────────────
  // Handles: reprocess stalled at "Grouping", diarization done but grouper never ran
  if (stageToRetry === "grouping") {
    if (!transcript) {
      throw new Error(`Cannot retry grouping: no transcript found for ${mediaId}`);
    }

    // Drain stale jobs first to prevent BullMQ deduplication blocking restart
    await drainSessionJobs(mediaId);

    await SessionState.updateOne(
      { mediaId },
      {
        $set: {
          "steps.grouping": { status: "pending" },
          "steps.analysis": { status: "pending", processedSegments: 0, totalSegments: 0 },
          "steps.blocks":   { status: "pending", completedBlocks: 0, totalBlocks: 0 },
          "steps.report":   { status: "pending" }
        }
      }
    );

    await cleanerQueue.add(
      "clean",
      { mediaId, segments: transcript.segments },
      {
        jobId: `reprocess-clean-${mediaId}`,
        removeOnComplete: false,
        removeOnFail: false
      }
    );

    console.log(`🔁 Retry [grouping]: restarted pipeline from cleaner for ${mediaId}`);
    return;
  }

  // ── Retry analysis: re-queue segments with missing or empty summary ─────────
  if (stageToRetry === "analysis" || stageToRetry === "all") {
    const failedSegments = await SegmentAnalysis.find(
      {
        mediaId,
        segmentId: { $type: "number" },
        $or: [
          { summary: { $exists: false } },
          { summary: null },
          { summary: "" }
        ]
      },
      "segmentId"
    ).lean();

    const existingIdSet = new Set(
      (await SegmentAnalysis.find({ mediaId, segmentId: { $type: "number" } }, "segmentId").lean())
        .map(s => s.segmentId)
    );
    const missingSegmentIds = allSegmentIds.filter(id => !existingIdSet.has(id));

    const toRequeue = [
      ...failedSegments.map(s => s.segmentId),
      ...missingSegmentIds
    ];

    if (toRequeue.length > 0) {
      await Promise.all(
        toRequeue.map(segmentId => {
          const segText = transcript?.segments?.[segmentId]?.text ?? "";
          return llmQueue.add(
            "segment-analysis",
            { mediaId, segmentId, totalSegments, text: segText },
            { jobId: `llm-${mediaId}-${segmentId}`, removeOnComplete: true }
          );
        })
      );
      console.log(`🔁 Retry [analysis]: re-queued ${toRequeue.length} segment(s) for ${mediaId}`);
    } else {
      console.log(`✅ Retry [analysis]: all segments already complete for ${mediaId}`);
    }
  }

  // ── Retry blocks ────────────────────────────────────────────────────────────
  if (stageToRetry === "blocks" || stageToRetry === "all") {
    const SEGMENTS_PER_BLOCK = 8;
    const expectedTotalBlocks = totalSegments > 0
      ? Math.ceil(totalSegments / SEGMENTS_PER_BLOCK)
      : 0;

    if (expectedTotalBlocks > 0) {
      const existingBlockIds = new Set(
        (await BlockAnalysis.find({ mediaId }, "blockId").lean()).map(b => b.blockId)
      );
      const missingBlockIds = Array.from({ length: expectedTotalBlocks }, (_, i) => i)
        .filter(i => !existingBlockIds.has(i));

      if (missingBlockIds.length > 0) {
        await Promise.all(
          missingBlockIds.map(blockId => {
            const segmentIds = Array.from(
              { length: SEGMENTS_PER_BLOCK },
              (_, i) => blockId * SEGMENTS_PER_BLOCK + i
            ).filter(id => id < totalSegments);
            return blockQueue.add(
              "aggregate-block",
              { mediaId, blockId, segmentIds, totalBlocks: expectedTotalBlocks },
              { jobId: `block-${mediaId}-${blockId}`, removeOnComplete: true }
            );
          })
        );
        console.log(`🔁 Retry [blocks]: re-queued ${missingBlockIds.length} block(s) for ${mediaId}`);
      } else {
        console.log(`✅ Retry [blocks]: all blocks already complete for ${mediaId}`);
      }
    }
  }

  // ── Retry embedding ────────────────────────────────────────────────────────
  if (stageToRetry === "embedding" || stageToRetry === "all") {
    const blocks = await BlockAnalysis.find({ mediaId }, "blockId").lean();
    if (blocks.length > 0) {
      await Promise.all(
        blocks.map(b =>
          embeddingQueue.add(
            "embed-block",
            { mediaId, blockId: b.blockId, type: "block" },
            { jobId: `embed-${mediaId}-${b.blockId}`, removeOnComplete: true }
          )
        )
      );
      console.log(`🔁 Retry [embedding]: re-queued ${blocks.length} embedding(s) for ${mediaId}`);
    }
  }

  // ── Retry aggregation & report if no report exists ─────────────────────────
  if (stageToRetry === "report" || stageToRetry === "all") {
    const report = await SessionReport.findOne({ mediaId });
    if (!report) {
      await insightAggregationQueue.add(
        "aggregate-insights",
        { mediaId, totalSegments },
        { jobId: `final-aggregate-${mediaId}`, removeOnComplete: true }
      );
      console.log(`🔁 Retry [report]: re-queued insight aggregation for ${mediaId}`);
    } else {
      console.log(`✅ Retry [report]: report already exists for ${mediaId}`);
    }
  }
}

// ─── Reprocess ────────────────────────────────────────────────────────────────

/**
 * Deletes all AI-derived data (analysis, blocks, report, context, feedback)
 * and restarts the pipeline from the CLEANER stage.
 *
 * Handles two cases:
 *  A) Transcript doc EXISTS (normal Path B) → use it directly, restart from cleaner.
 *  B) Transcript doc MISSING (Path A-only, or diarization crashed before Transcript.create)
 *     → rebuild Transcript from MinIO raw chunks → run SpeakerSegmentationService
 *     → save Transcript to DB, then restart from cleaner.
 *
 * WHY restart from CLEANER not DIARIZATION:
 *   SpeakerService.process() calls Transcript.create() which would throw a
 *   duplicate-key error if the doc already exists from a previous run.
 *   The Transcript is the preserved ground truth — we never re-transcribe audio.
 */
export async function reprocess(mediaId) {
  // ── Guard: prevent concurrent ops ─────────────────────────────────────────
  await assertNotProcessing(mediaId);

  // ── Resolve Transcript — rebuild from MinIO if missing ─────────────────────
  let transcript = await Transcript.findOne({ mediaId });

  if (!transcript) {
    console.log(`⚠️  Reprocess [${mediaId}]: No Transcript doc found — rebuilding from MinIO chunks`);

    // Merge raw chunk text from MinIO (always available after transcription)
    let mergedText;
    try {
      mergedText = await TranscriptService.merge(mediaId);
    } catch (mergeErr) {
      throw new Error(
        `Reprocess failed: could not load transcript chunks from MinIO for ${mediaId}. ` +
        `Original audio may have been deleted. Error: ${mergeErr.message}`
      );
    }

    // Run speaker segmentation on the merged text (same logic as speakerDiarizationWorker)
    const segments = SpeakerSegmentationService.segment(mergedText);

    // Persist the rebuilt Transcript so future reprocess calls find it
    transcript = await Transcript.findOneAndUpdate(
      { mediaId },
      { mediaId, segments, status: "raw", updatedAt: new Date() },
      { upsert: true, new: true }
    );

    console.log(`✅ Reprocess [${mediaId}]: Transcript rebuilt with ${segments.length} segments from MinIO`);
  }

  // ── Delete all derived intelligence ────────────────────────────────────────
  await Promise.all([
    SegmentAnalysis.deleteMany({ mediaId }),
    BlockAnalysis.deleteMany({ mediaId }),
    SessionReport.deleteOne({ mediaId }),
    SessionContext.deleteMany({ mediaId }),
    RetrievalFeedback.deleteMany({ mediaId })
  ]);

  console.log(`🔄 Reprocess: deleted all derived data for ${mediaId}`);

  // ── Reset SessionState steps ────────────────────────────────────────────────
  await SessionState.findOneAndUpdate(
    { mediaId },
    {
      $set: {
        status: "analyzing",
        error: null,
        // Preserve transcription step — it already completed
        "steps.diarization": { status: "completed" }, // re-using reconstructed transcript
        "steps.grouping":    { status: "pending" },
        "steps.analysis":    { status: "pending", processedSegments: 0, totalSegments: 0 },
        "steps.blocks":      { status: "pending", completedBlocks: 0, totalBlocks: 0 },
        "steps.report":      { status: "pending" },
        "steps.embedding":   { status: "pending" }
      }
    },
    { upsert: true }
  );

  // ── Drain stale pipeline jobs to prevent BullMQ jobId deduplication ────────
  // Without this, stale clean/group/analysis jobs block restart silently.
  await drainSessionJobs(mediaId);

  // ── Restart from transcript cleaner → grouper → LLM analysis → blocks → report
  await cleanerQueue.add(
    "clean",
    {
      mediaId,
      segments: transcript.segments
    },
    {
      jobId: `reprocess-clean-${mediaId}`,
      // Keep the job in BullMQ after completion so future reprocess
      // calls can find and remove it (drainSessionJobs checks completed state).
      removeOnComplete: false,
      removeOnFail: false
    }
  );

  console.log(`🔄 Reprocess: pipeline restarted from cleaner stage for ${mediaId}`);
}

// ─── Delete ────────────────────────────────────────────────────────────────────

/**
 * Completely removes a session from the database and Qdrant vectors.
 * This is irreversible.
 */
export async function deleteSession(mediaId) {
  await Promise.all([
    Transcript.deleteMany({ mediaId }),
    SegmentAnalysis.deleteMany({ mediaId }),
    BlockAnalysis.deleteMany({ mediaId }),
    SessionContext.deleteMany({ mediaId }),
    SessionReport.deleteOne({ mediaId }),
    RetrievalFeedback.deleteMany({ mediaId }),
    SessionState.deleteOne({ mediaId })
  ]);

  // Delete Qdrant vectors — imported lazily to avoid circular deps
  try {
    const { deleteByMediaId } = await import("./vectorService.js");
    await deleteByMediaId(mediaId);
  } catch (err) {
    // Not critical — log and continue
    console.warn(`⚠️  Vector delete failed for ${mediaId}:`, err?.message);
  }

  console.log(`🗑️  Session ${mediaId} fully deleted`);
}
