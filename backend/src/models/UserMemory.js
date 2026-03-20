import mongoose from "mongoose";

/**
 * UserMemory — Cross-Session Long-Term Memory
 *
 * One document per user. Accumulates topics and insights across ALL
 * sessions processed for that user. Used by contextBuilder to inject
 * a "long-term memory" layer at the top of every chat context, making
 * the AI aware of the user's recurring interests and patterns.
 *
 * Updated by memoryService.updateMemory() after SESSION_INTELLIGENCE_READY.
 */
const UserMemorySchema = new mongoose.Schema(
  {
    userId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true
    },

    // Accumulated distinct topics across all sessions (Set-deduped)
    topics: {
      type:    [String],
      default: []
    },

    // Accumulated non-obvious insights across all sessions (Set-deduped)
    insights: {
      type:    [String],
      default: []
    },

    // Running count of sessions processed — used for decay/summarization later
    sessionCount: {
      type:    Number,
      default: 0
    },

    lastUpdated: {
      type:    Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("UserMemory", UserMemorySchema);
