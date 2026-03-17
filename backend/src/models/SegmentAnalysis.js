import mongoose from "mongoose";

const SegmentAnalysisSchema = new mongoose.Schema({

  mediaId: {
    type: String,
    required: true
  },

  segmentId: {
    type: mongoose.Schema.Types.Mixed, // supports both Number (legacy) and String (window-based)
    required: true
  },

  topics: [String],
  insights: [String],
  questions: [String],
  decisions: [String],
  action_items: [String],

  summary: String

}, { timestamps: true });

// Compound index for efficient querying
SegmentAnalysisSchema.index({ mediaId: 1, segmentId: 1 }, { unique: true });

export default mongoose.model("SegmentAnalysis", SegmentAnalysisSchema);
