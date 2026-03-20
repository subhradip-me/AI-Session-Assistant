/**
 * Window-based Partial Diarization Worker
 * 
 * Processes sliding window chunks for early speaker diarization.
 * Creates raw speaker segments from window text without waiting for full transcript.
 * 
 * Pipeline:
 *   window-diarization queue
 *   → segment window text into sentences
 *   → assign alternating speakers
 *   → merge consecutive same-speaker segments
 *   → add to cleaner queue
 *   → emit WINDOW_DIARIZATION_READY
 */

import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import SpeakerSegmentationService from "../src/services/SpeakerSegmentationService.js";
import cleanerQueue from "../src/queues/cleanerQueue.js";
import EventService from "../src/services/EventService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

const worker = new Worker(
  "window-diarization",
  async job => {
    try {
      const { mediaId, windowId, chunkRange, combinedText, userId } = job.data;

      console.log(`\n🎤 [Window Diarization] Processing: ${windowId}`);
      console.log(`   Chunks: ${chunkRange.start} → ${chunkRange.end}`);
      console.log(`   Text length: ${combinedText.length} characters`);

      // Segment the combined window text into speaker segments
      const rawSegments = SpeakerSegmentationService.segment(combinedText);

      console.log(`   Segmented into ${rawSegments.length} speaker segments`);

      if (rawSegments.length === 0) {
        console.warn(`⚠️  No segments generated for ${windowId}`);
        return { windowId, segmentCount: 0 };
      }

      // Adjust segment IDs to be window-based (string format)
      // e.g., "session-window-0-3-0", "session-window-0-3-1", etc.
      const windowSegments = rawSegments.map((segment, idx) => ({
        ...segment,
        segmentId: `${windowId}-${idx}`, // window-based string ID
        windowId,
        mediaId
      }));

      console.log(`   Created window segments with IDs:`);
      windowSegments.forEach(seg => {
        console.log(`     - ${seg.segmentId}: "${seg.text.substring(0, 50)}..."`);
      });

      // Queue for cleaning
      await cleanerQueue.add(
        "clean-window-segments",
        {
          mediaId,
          userId,
          windowId,
          segments: windowSegments
        },
        {
          jobId: `clean-${windowId}`
        }
      );

      // Emit window diarization ready event
      await EventService.emit("WINDOW_DIARIZATION_READY", {
        mediaId,
        windowId,
        chunkRange,
        segmentCount: windowSegments.length
      });

      console.log(`✅ Window segments queued for cleaning: ${windowId}`);

      return {
        windowId,
        segmentCount: windowSegments.length,
        segmentIds: windowSegments.map(s => s.segmentId)
      };

    } catch (err) {
      console.error("❌ Error in window diarization:", err);
      throw err;
    }
  },
  {
    connection: {
      host: "127.0.0.1",
      port: 6379
    }
  }
);

worker.on("completed", job => {
  console.log(`✅ Job ${job.id} completed (window diarization)`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job.id} failed (window diarization):`, err.message);
});

console.log("🎤 Window Diarization Worker Started");
