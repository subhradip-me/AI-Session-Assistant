import mongoose from "mongoose";

const analysisSchema = new mongoose.Schema({
  mediaId: {
    type: String,
    required: true,
    index: true
  },
  segmentId: {
    type: Number,
    required: true
  },
  topics: [String],
  insights: [String],
  summary: String,
  questions: [String],
  decisions: [String],
  actionItems: [String],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for efficient querying
analysisSchema.index({ mediaId: 1, segmentId: 1 }, { unique: true });

export default mongoose.model("Analysis", analysisSchema);
