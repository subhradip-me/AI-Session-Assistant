import { Queue } from "bullmq";
import redis from "../config/redis.js";

export const analysisQueue = new Queue("analysisQueue", {
  connection: redis
});