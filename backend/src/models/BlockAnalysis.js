import mongoose from "mongoose";

const BlockAnalysisSchema = new mongoose.Schema({

  mediaId: {
    type:     String,
    required: true
  },

  userId: {
    type:  String,
    index: true
  },

  blockId: {
    type:     Number,
    required: true
  },

  // Array of segment IDs that comprise this block
  segments: [Number],

  // Time window in seconds
  start: {
    type: Number,
    required: true
  },

  end: {
    type: Number,
    required: true
  },

  // Duration of the block in seconds
  duration: Number,

  // AI-extracted intelligence from the block
  topics: [String],
  insights: [String],
  questions: [String],
  decisions: [String],
  action_items: [String],

  summary: String

}, { timestamps: true });

// Compound unique index: one block per (session, blockId)
BlockAnalysisSchema.index({ mediaId: 1, blockId: 1 }, { unique: true });
// Index for user-scoped queries
BlockAnalysisSchema.index({ userId: 1, mediaId: 1 });

export default mongoose.model("BlockAnalysis", BlockAnalysisSchema);
