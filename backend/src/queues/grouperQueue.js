import { Queue } from "bullmq";

const grouperQueue = new Queue("segment-grouper", {
  connection: {
    host: "127.0.0.1",
    port: 6379
  }
});

export default grouperQueue;
