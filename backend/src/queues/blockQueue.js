import { Queue } from "bullmq";
import redis from "../config/redis.js";

export const blockQueue = new Queue("block-aggregation", {
  connection: redis
});
