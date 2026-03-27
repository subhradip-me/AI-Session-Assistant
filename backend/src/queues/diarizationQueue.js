import { Queue } from "bullmq";
import redis from "../config/redis.js";

// This queue will handle speaker diarization tasks after transcription is complete
const diarizationQueue = new Queue("speaker-diarization", {
  connection: redis
});

export default diarizationQueue;