import { Queue } from "bullmq";
import redis from "../config/redis.js";

export const insightAggregationQueue = new Queue("insight-aggregation", {
  connection: redis
});
