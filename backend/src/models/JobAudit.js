import mongoose from "mongoose";

const jobAuditSchema = new mongoose.Schema(
  {
    mediaId:   { type: String, required: true, index: true },
    worker:    { type: String, required: true },
    jobId:     { type: String },
    status:    {
      type: String,
      enum: ["started", "completed", "failed"],
      required: true
    },
    timestamp: { type: Date, default: Date.now },
    error:     { type: String, default: null },
    meta:      { type: mongoose.Schema.Types.Mixed } // extra info (segment/blockId, etc.)
  },
  {
    timestamps: false
  }
);

// Index for fast retrieval by session + time
jobAuditSchema.index({ mediaId: 1, timestamp: -1 });

export default mongoose.model("JobAudit", jobAuditSchema);
