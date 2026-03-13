import mongoose from "mongoose";

const BlockAnalysisSchema = new mongoose.Schema({

  mediaId: {
    type: String,
    required: true
  },

  blockId: {
    type: Number,
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

// Compound index for efficient querying
BlockAnalysisSchema.index({ mediaId: 1, blockId: 1 }, { unique: true });
// Index for finding all blocks for a media session, sorted by time
BlockAnalysisSchema.index({ mediaId: 1, blockId: 1 });

export default mongoose.model("BlockAnalysis", BlockAnalysisSchema);
