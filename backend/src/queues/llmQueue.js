import { Queue } from "bullmq";
import redis from "../config/redis.js";

/**
 * LLM calls queue — decouples segment analysis from direct LLM calls.
 * All segment-analysis jobs flow through here before reaching the LLM Router Worker.
 * Rate limiting (max 20 req/min) is enforced at the Worker level.
 */
export const llmQueue = new Queue("llm-calls", {
  connection: redis,
  defaultJobOptions: {
    attempts: 10,
    backoff: {
      // "custom" delegates delay calculation to Worker settings.backoffStrategy.
      // It reads the exact retryAfterMs / retryDelay from the provider error,
      // so jobs wait precisely as long as needed (Groq TPD ~7 min, Gemini PerDay 2 h).
      type: "custom"
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 }
  }
});

export default llmQueue;
