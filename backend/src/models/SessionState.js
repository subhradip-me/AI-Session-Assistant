import mongoose from "mongoose";

const stepSchema = new mongoose.Schema(
  {
    status:             { type: String, default: "pending" }, // "pending" | "running" | "completed" | "failed"
    completedChunks:    { type: Number, default: 0 },
    totalChunks:        { type: Number, default: 0 },
    processedSegments:  { type: Number, default: 0 },
    totalSegments:      { type: Number, default: 0 },
    completedBlocks:    { type: Number, default: 0 },
    totalBlocks:        { type: Number, default: 0 }
  },
  { _id: false }
);

const sessionStateSchema = new mongoose.Schema(
  {
    mediaId: { type: String, required: true, unique: true, index: true },
    userId:  { type: String, index: true },

    // Overall pipeline status
    status: {
      type: String,
      enum: ["uploading", "transcribing", "diarizing", "analyzing", "aggregating", "reporting", "completed", "failed"],
      default: "uploading"
    },

    // Per-step progress tracking
    steps: {
      transcription: { type: stepSchema, default: () => ({}) },
      diarization:   { type: stepSchema, default: () => ({}) },
      grouping:      { type: stepSchema, default: () => ({}) },
      analysis:      { type: stepSchema, default: () => ({}) },
      blocks:        { type: stepSchema, default: () => ({}) },
      report:        { type: stepSchema, default: () => ({}) },
      embedding:     { type: stepSchema, default: () => ({}) }
    },

    error: { type: String, default: null }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("SessionState", sessionStateSchema);
