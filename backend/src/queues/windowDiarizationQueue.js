import { Queue } from "bullmq";
import redis from "../config/redis.js";

/**
 * Window-based diarization queue
 *
 * Handles speaker diarization for sliding window chunks.
 * Triggered when a window becomes ready in TranscriptBufferService.
 *
 * Allows early partial analysis without waiting for full transcript.
 */
const windowDiarizationQueue = new Queue("window-diarization", {
  connection: redis
});

export default windowDiarizationQueue;
