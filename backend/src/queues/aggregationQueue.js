import { Queue } from "bullmq";
import redis from "../config/redis.js";

const aggregationQueue = new Queue("transcript-aggregation", {
  connection: redis
});

export default aggregationQueue;
