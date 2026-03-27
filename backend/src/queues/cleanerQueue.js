import { Queue } from "bullmq";
import redis from "../config/redis.js";

const cleanerQueue = new Queue("transcript-cleaner", {
  connection: redis
});

export default cleanerQueue;
