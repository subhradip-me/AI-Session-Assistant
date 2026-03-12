import { Queue } from "bullmq";
import redis from "../config/redis.js";

const globalContextQueue = new Queue("global-context", {
  connection: redis
});

export default globalContextQueue;
