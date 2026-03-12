import { Queue } from "bullmq";

const cleanerQueue = new Queue("transcript-cleaner", {
  connection: {
    host: "127.0.0.1",
    port: 6379
  }
});

export default cleanerQueue;
