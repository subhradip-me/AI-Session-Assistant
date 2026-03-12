import { Queue } from "bullmq";

const aggregationQueue = new Queue("transcript-aggregation", {
  connection: {
    host: "127.0.0.1",
    port: 6379
  }
});

export default aggregationQueue;
