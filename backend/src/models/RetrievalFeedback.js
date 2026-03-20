import mongoose from "mongoose";

/**
 * RetrievalFeedback — Self-Learning Retrieval Signal
 *
 * Stores the quality rating of every chat answer (auto-scored by LLM, 1–5).
 * This is the foundation for reinforcement learning:
 *   - High-rated (intent, blockId) combos get boosted in future retrievals
 *   - Patterns accumulate into BlockReputation scores (Phase 2)
 *
 * Captured asynchronously in chatWorker after each answer — never blocks response.
 */
const RetrievalFeedbackSchema = new mongoose.Schema(
  {
    userId: {
      type:  String,
      index: true
    },

    mediaId: {
      type:  String,
      index: true
    },

    // The original (possibly rewritten) query sent to retrieval
    query: {
      type: String
    },

    // Intent classified by intentService before retrieval
    intent: {
      type: String,
      enum: ["summary", "deep_explanation", "decision", "action_items", "question_answer", "trend", "unknown"]
    },

    // blockIds that were retrieved and used to answer this question
    retrievedBlockIds: {
      type:    [Number],
      default: []
    },

    // Auto-rated by LLM: 1 (poor) → 5 (excellent)
    rating: {
      type: Number,
      min:  1,
      max:  5
    },

    // The answer that was rated — stored to enable future human review / fine-tuning
    answer: {
      type: String
    },

    createdAt: {
      type:    Date,
      default: Date.now,
      index:   true
    }
  }
);

export default mongoose.model("RetrievalFeedback", RetrievalFeedbackSchema);
