import { Queue } from "bullmq";
import redis from "../config/redis.js";

const grouperQueue = new Queue("segment-grouper", {
  connection: redis
});

export default grouperQueue;
