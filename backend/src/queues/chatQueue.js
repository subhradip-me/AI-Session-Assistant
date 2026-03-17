import { Queue } from "bullmq";
import redis from "../config/redis.js";

export const chatQueue = new Queue("chat-query", {
  connection: redis
});
