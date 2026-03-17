import { Queue } from "bullmq"; 

/**
 * Window-based diarization queue
 * 
 * Handles speaker diarization for sliding window chunks.
 * Triggered when a window becomes ready in TranscriptBufferService.
 * 
 * Allows early partial analysis without waiting for full transcript.
 */
const windowDiarizationQueue = new Queue("window-diarization", {
  connection: {
    host: "127.0.0.1",
    port: 6379
  }
});

export default windowDiarizationQueue;
