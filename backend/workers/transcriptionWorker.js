import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import path from "path";
import WhisperService from "../src/services/WhisperService.js";
import TranscriptService from "../src/services/TranscriptService.js";
import aggregationQueue from "../src/queues/aggregationQueue.js";
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

    // Get total chunks from job data
    const totalChunks = job.data.totalChunks || (chunkIndex + 1);

    // Emit per-chunk event
    await EventService.emit("CHUNK_TRANSCRIBED", {
      mediaId,
      chunkIndex,
      totalChunks
    });

    // Check if all chunks are complete
    const done = TranscriptService.isComplete(mediaId, totalChunks);

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