/**
 * queueDrain.js
 *
 * Removes any lingering jobs for a given mediaId from the pipeline queues
 * before a reprocess. Without this, BullMQ's jobId deduplication silently
 * ignores re-added jobs if a stale one exists in any non-completed state.
 */

import cleanerQueue  from "../queues/cleanerQueue.js";
import grouperQueue  from "../queues/grouperQueue.js";
import { analysisQueue } from "../queues/analysisQueue.js";

/**
 * Remove stale pipeline jobs for a session from cleaner → grouper → analysis.
 * Runs in parallel. Errors are swallowed — a missing job is not a problem.
 *
 * @param {string} mediaId
 */
export async function drainSessionJobs(mediaId) {
  const jobsToRemove = [
    { queue: cleanerQueue,  id: `reprocess-clean-${mediaId}` },
    { queue: grouperQueue,  id: `group-${mediaId}` },
    { queue: analysisQueue, id: `analysis-batch-${mediaId}` },
  ];

  await Promise.allSettled(
    jobsToRemove.map(async ({ queue, id }) => {
      try {
        const job = await queue.getJob(id);
        if (job) {
          const state = await job.getState();
          // Only remove non-active jobs — active jobs need a graceful stop
          if (state !== "active") {
            await job.remove();
            console.log(`🗑️  Removed stale job [${id}] (was: ${state})`);
          } else {
            console.warn(`⚠️  Job [${id}] is active — cannot remove, will be superseded`);
          }
        }
      } catch (err) {
        console.warn(`⚠️  Could not remove job [${id}]: ${err.message}`);
      }
    })
  );
}
