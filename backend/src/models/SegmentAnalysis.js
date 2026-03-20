import mongoose from "mongoose";

const SegmentAnalysisSchema = new mongoose.Schema({

  mediaId: {
    type:     String,
    required: true
  },

  userId: {
    type:  String,
    index: true
  },

  segmentId: {
    type:     mongoose.Schema.Types.Mixed, // Number (Path B) or String (Path A window IDs)
    required: true
  },

  topics: [String],
  insights: [String],
  questions: [String],
  decisions: [String],
  action_items: [String],

  summary: String

}, { timestamps: true });

// Compound unique index: one analysis per (session, segment)
SegmentAnalysisSchema.index({ mediaId: 1, segmentId: 1 }, { unique: true });
// Index for user-scoped queries: find all analyses for a user
SegmentAnalysisSchema.index({ userId: 1, mediaId: 1 });

export default mongoose.model("SegmentAnalysis", SegmentAnalysisSchema);
