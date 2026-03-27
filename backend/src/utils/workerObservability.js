/**
 * Worker Observability Utility
 *
 * Workers are separate Node.js processes — they don't share the Socket.IO instance.
 * This utility:
 *   1. Updates SessionState in MongoDB (source of truth for /status API)
 *   2. Publishes a pipeline:update event to a Redis pub/sub channel
 *      → The main server subscribes and forwards it to Socket.IO clients
 *
 * Import this in each worker and call updatePipelineState() + publishPipelineEvent().
 */

import IORedis from "ioredis";
import SessionState from "../models/SessionState.js";
import JobAudit from "../models/JobAudit.js";

// Separate Redis publisher connection (workers must not reuse the BullMQ connection)
let publisher = null;

function getPublisher() {
  if (!publisher) {
    publisher = new IORedis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null
    });
  }
  return publisher;
}

/**
 * Update the per-step progress in SessionState.
 *
 * @param {string} mediaId
 * @param {object} update   — MongoDB $set update object, e.g. { "steps.transcription.status": "completed" }
 * @param {string} [status] — optional overall pipeline status override
 */
export async function updatePipelineState(mediaId, update, status = null) {
  try {
    const setDoc = { ...update };
    if (status) setDoc.status = status;

    await SessionState.findOneAndUpdate(
      { mediaId },
      { $set: setDoc },
      { upsert: true }
    );
  } catch (err) {
    // Never crash a worker because of observability
    console.warn(`[observability] SessionState update failed for ${mediaId}:`, err.message);
  }
}

/**
 * Publish a pipeline:update event to Redis pub/sub.
 * The main server receives this and forwards it to Socket.IO clients.
 *
 * @param {string} mediaId
 * @param {string} step     — name of the pipeline step
 * @param {string} status   — "running" | "completed" | "failed"
 * @param {object} [extra]  — extra fields to include in the payload
 */
export async function publishPipelineEvent(mediaId, step, status, extra = {}) {
  try {
    const pub = getPublisher();
    const payload = JSON.stringify({
      mediaId,
      step,
      status,
      ...extra,
      updatedAt: new Date().toISOString()
    });
    await pub.publish("pipeline:update", payload);
  } catch (err) {
    console.warn(`[observability] Redis publish failed for ${mediaId}:`, err.message);
  }
}

/**
 * Log a worker execution event to JobAudit.
 *
 * @param {string} mediaId
 * @param {string} worker   — worker name (e.g. "transcriptionWorker")
 * @param {string} jobId
 * @param {"started"|"completed"|"failed"} status
 * @param {string|null} [error]
 * @param {object} [meta]   — extra context (segmentId, blockId, etc.)
 */
export async function logJobAudit(mediaId, worker, jobId, status, error = null, meta = {}) {
  try {
    await JobAudit.create({ mediaId, worker, jobId, status, error, meta });
  } catch (err) {
    console.warn(`[observability] JobAudit write failed for ${mediaId}:`, err.message);
  }
}

/**
 * Mark a session as failed — updates SessionState and publishes event.
 * Call from worker.on("failed") handlers.
 *
 * @param {string} mediaId
 * @param {string} worker
 * @param {string} jobId
 * @param {Error}  err
 */
export async function markSessionFailed(mediaId, worker, jobId, err) {
  await Promise.allSettled([
    updatePipelineState(mediaId, { error: err.message }, "failed"),
    publishPipelineEvent(mediaId, worker, "failed", { error: err.message }),
    logJobAudit(mediaId, worker, jobId, "failed", err.message)
  ]);
}
