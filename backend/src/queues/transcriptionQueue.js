import { Queue } from "bullmq";
import connection from "../config/redis.js";

const transcriptionQueue = new Queue("transcriptionQueue", {
  connection
});

export default transcriptionQueue;
