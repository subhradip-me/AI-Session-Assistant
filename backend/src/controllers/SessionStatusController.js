import SessionState from "../models/SessionState.js";
import SegmentAnalysis from "../models/SegmentAnalysis.js";
import BlockAnalysis from "../models/BlockAnalysis.js";
import JobAudit from "../models/JobAudit.js";
import Session from "../models/Session.js";
import SessionReport from "../models/SessionReport.js";
import SessionContext from "../models/SessionContext.js";
import * as SessionControlService from "../services/SessionControlService.js";

// ─── Progress Calculator ──────────────────────────────────────────────────────

/**
 * Computes 0–100 progress from a SessionState document.
 * Weights reflect importance / typical duration.
 *   transcription 25 | diarization 10 | grouping 5 | analysis 30 | blocks 20 | report 10
 */
function calculateProgress(state) {
  const s = state.steps;
  let p = 0;

  // Transcription: chunk-level granularity
  if (s.transcription.status === "completed") {
    p += 25;
  } else if (s.transcription.totalChunks > 0) {
    p += 25 * (s.transcription.completedChunks / s.transcription.totalChunks);
  }

  if (s.diarization.status === "completed") p += 10;
  else if (s.diarization.status === "running") p += 5;

  if (s.grouping.status === "completed") p += 5;

  // Analysis: segment-level granularity
  if (s.analysis.status === "completed") {
    p += 30;
  } else if (s.analysis.totalSegments > 0) {
    p += 30 * (s.analysis.processedSegments / s.analysis.totalSegments);
  } else if (s.analysis.status === "running") {
    p += 5;
  }

  // Blocks: block-level granularity
  if (s.blocks.status === "completed") {
    p += 20;
  } else if (s.blocks.totalBlocks > 0) {
    p += 20 * (s.blocks.completedBlocks / s.blocks.totalBlocks);
  }

  if (s.report.status === "completed") p += 10;

  return Math.min(100, Math.round(p));
}

// ─── GET /api/session/:mediaId/status ────────────────────────────────────────


export const getSessionStatus = async (req, res, next) => {
  try {
    const { mediaId } = req.params;
    let state = await SessionState.findOne({ mediaId });

    if (!state) {
      // ── Fallback: session exists in Session model but has no SessionState ──
      // This happens for sessions uploaded before SessionState was introduced,
      // or if the upload worker crashed before creating the first state doc.
      const [session, report] = await Promise.all([
        Session.findOne({ mediaId }).lean(),
        SessionReport.findOne({ mediaId }).lean()
      ]);

      if (!session) {
        // Truly unknown session — not in any collection
        return res.status(404).json({ error: "Session not found" });
      }

      if (report) {
        // Report exists — pipeline finished. Auto-create a minimal SessionState
        // so future calls are instant and reprocess works.
        state = await SessionState.findOneAndUpdate(
          { mediaId },
          {
            $setOnInsert: {
              mediaId,
              userId: session.userId,
              status: "completed",
              steps: {
                transcription: { status: "completed" },
                diarization:   { status: "completed" },
                grouping:      { status: "completed" },
                analysis:      { status: "completed" },
                blocks:        { status: "completed" },
                report:        { status: "completed" }
              }
            }
          },
          { upsert: true, new: true }
        );
        console.log(`✨ Auto-created completed SessionState for legacy session ${mediaId}`);
      } else {
        // Session exists but no report and no state — likely an orphaned/stalled upload.
        // Return a synthetic queued status so the frontend stops 404-looping.
        return res.json({
          status:    "queued",
          progress:  0,
          steps:     {},
          error:     null,
          updatedAt: session.updatedAt,
          _synthetic: true   // hint for debugging
        });
      }
    }

    const progress = calculateProgress(state);

    return res.json({
      status:   state.status,
      progress,
      steps:    state.steps,
      error:    state.error || null,
      updatedAt: state.updatedAt
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/session/:mediaId/retry ────────────────────────────────────────

export const retrySession = async (req, res, next) => {
  try {
    const { mediaId } = req.params;
    const { stage } = req.body;

    await SessionControlService.retry(mediaId, stage || null);
    return res.json({ message: "Retry initiated", stage: stage || "all" });
  } catch (err) {
    if (err.message?.includes("currently")) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
};

// ─── DELETE /api/session/:mediaId ─────────────────────────────────────────────────────────


export const deleteSession = async (req, res, next) => {
  try {
    const { mediaId } = req.params;
    const userId = req.user?.userId;

    // Security: verify session belongs to this user before deleting
    const session = await Session.findOne({ mediaId });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (userId && session.userId && session.userId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Full delete: removes Session, SessionState, Transcript, all analyses,
    // report, context, feedback, and Qdrant vectors.
    await SessionControlService.deleteSession(mediaId);

    console.log(`🗑️  Full delete completed for [${mediaId}]`);

    return res.json({
      message: "Session deleted successfully",
      mediaId
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/session/:mediaId/reprocess ─────────────────────────────────────

export const reprocessSession = async (req, res, next) => {
  try {
    const { mediaId } = req.params;
    // userId from JWT — passed through the worker queue chain so that
    // SessionReport is saved with the correct userId (fixes report-not-found
    // after reprocess when GET /report/:mediaId queries by { mediaId, userId }).
    const userId = req.user?.userId;

    await SessionControlService.reprocess(mediaId, userId);
    return res.json({ message: "Reprocessing started — pipeline restarting from cleaner stage" });
  } catch (err) {
    // 409: session is actively processing — cannot start a second run
    if (err.message?.includes("currently")) {
      return res.status(409).json({ error: err.message });
    }
    // 422: transcript chunks missing from MinIO (audio was deleted, can't recover)
    if (err.message?.includes("could not load transcript chunks")) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  }
};

// ─── GET /api/sessions ───────────────────────────────────────────────────────

export const listSessions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = status ? { status } : {};

    const [sessions, total] = await Promise.all([
      SessionState.find(filter)
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .sort({ updatedAt: -1 })
        .lean(),
      SessionState.countDocuments(filter)
    ]);

    return res.json({ sessions, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/session/:mediaId/details ───────────────────────────────────────

export const getSessionDetails = async (req, res, next) => {
  try {
    const { mediaId } = req.params;

    const [state, segmentCount, blockCount] = await Promise.all([
      SessionState.findOne({ mediaId }),
      SegmentAnalysis.countDocuments({ mediaId }),
      BlockAnalysis.countDocuments({ mediaId })
    ]);

    if (!state) return res.status(404).json({ error: "Session not found" });

    return res.json({
      state,
      counts: { segments: segmentCount, blocks: blockCount },
      progress: calculateProgress(state)
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/session/:mediaId/logs ──────────────────────────────────────────

export const getSessionLogs = async (req, res, next) => {
  try {
    const { mediaId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const [logs, total] = await Promise.all([
      JobAudit.find({ mediaId })
        .sort({ timestamp: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      JobAudit.countDocuments({ mediaId })
    ]);

    return res.json({ logs, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
};
