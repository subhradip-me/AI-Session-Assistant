import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import path from "path";
import WhisperService from "../src/services/WhisperService.js";
import TranscriptService from "../src/services/TranscriptService.js";
import TranscriptBufferService from "../src/services/TranscriptBufferService.js";
import aggregationQueue from "../src/queues/aggregationQueue.js";
import windowDiarizationQueue from "../src/queues/windowDiarizationQueue.js";
import EventService from "../src/services/EventService.js";

// Load environment variables (required for Kafka broker address)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

const worker = new Worker(
  "transcriptionQueue",
  async job => {
    try {
    console.log("Incoming job data:", job.data);

    const { mediaId, chunkIndex, chunkName, chunkPath } = job.data;

    // fallback if path not provided
    const finalPath =
      path.resolve("uploads/chunks", chunkName);

    if (!finalPath) {
      throw new Error("Chunk path missing in job data");
    }

    console.log("Processing audio:", finalPath);

    const transcript = await WhisperService.transcribe(finalPath);

    console.log("Transcript result:", transcript);

    // Save transcript chunk
    await TranscriptService.saveChunk(mediaId, chunkIndex, transcript);

    console.log(`Saved transcript for chunk ${chunkIndex}`);

    // === EARLY WINDOW PROCESSING ===
    // Add chunk to buffer and check if a window is ready
    const window = TranscriptBufferService.addChunk(mediaId, chunkIndex, transcript);

    if (window) {
      console.log(`🪟 Window ready: ${window.windowId} (chunks ${window.chunkRange.start}-${window.chunkRange.end})`);

      // Combine all chunk texts in the window
      const combinedText = window.chunks.map(c => c.text).join(" ");

      // Queue partial diarization for this window
      await windowDiarizationQueue.add(
        "diarize-window",
        {
          mediaId: window.mediaId,
          windowId: window.windowId,
          chunkRange: window.chunkRange,
          combinedText
        },
        {
          jobId: `diarize-${window.windowId}`
        }
      );

      // Emit window-ready event for monitoring
      await EventService.emit("WINDOW_DIARIZATION_QUEUED", {
        mediaId: window.mediaId,
        windowId: window.windowId,
        chunkRange: window.chunkRange
      });
    }

    // Get total chunks from job data
    const totalChunks = job.data.totalChunks || (chunkIndex + 1);

    // Emit per-chunk event
    await EventService.emit("CHUNK_TRANSCRIBED", {
      mediaId,
      chunkIndex,
      totalChunks
    });

    // Check if all chunks are complete
    const done = await TranscriptService.isComplete(mediaId, totalChunks);

    console.log(`Completion check: ${done} (${chunkIndex + 1}/${totalChunks} chunks)`);

    // Notify aggregator if all chunks are complete
    if (done) {
      console.log("✅ All chunks complete! Notifying aggregator...");
      await aggregationQueue.add("aggregate", {
        mediaId
      });
      // Emit session-level completion event
      await EventService.emit("TRANSCRIPTION_COMPLETE", {
        mediaId,
        totalChunks
      });
    }

    return { transcript, chunkName }; 
    } catch (err) {
      console.error("Error processing job:", err);
      throw err; // rethrow to mark job as failed
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
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed`, err);
});

console.log("🎧 Transcription Worker Started");