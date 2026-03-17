import { Queue } from "bullmq";
import redis from "../config/redis.js";

// Queue name must match the Worker name in reportGeneratorWorker.js
const reportQueue = new Queue("report-generator", {
  connection: redis
});

export default reportQueue;