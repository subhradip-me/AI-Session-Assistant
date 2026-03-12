import { Queue } from "bullmq"; 

// This queue will handle speaker diarization tasks after transcription is complete
const diarizationQueue = new Queue("speaker-diarization", {
  connection: {
    host: "127.0.0.1",
    port: 6379
  }
});

export default diarizationQueue;