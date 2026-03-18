import { Queue } from "bullmq";
import redis from "../config/redis.js";

export const embeddingQueue = new Queue("embedding", {
  connection: redis
});