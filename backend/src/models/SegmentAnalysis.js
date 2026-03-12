import mongoose from "mongoose";

const SegmentAnalysisSchema = new mongoose.Schema({

  mediaId: {
    type: String,
    required: true
  },

  segmentId: {
    type: Number,
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
