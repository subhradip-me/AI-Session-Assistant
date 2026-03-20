import mongoose from "mongoose";

const SessionSchema = new mongoose.Schema(
  {
    mediaId: {
      type:     String,
      required: true,
      unique:   true
    },

    userId: {
      type:     String,
      required: true,
      index:    true
    },

    title: {
      type:    String,
      default: ""
    }
  },
  { timestamps: true }
);

// Compound index for efficient user → sessions lookup
SessionSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model("Session", SessionSchema);