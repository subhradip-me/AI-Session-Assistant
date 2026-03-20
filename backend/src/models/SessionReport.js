import mongoose from "mongoose";

const SessionReportSchema = new mongoose.Schema(
  {
    mediaId: {
      type:     String,
      required: true,
      index:    true
    },

    userId: {
      type:  String,
      index: true
    },

    content: {
      type:     String,
      required: true
    }
  },
  { timestamps: true }
);

SessionReportSchema.index({ userId: 1, mediaId: 1 });

export default mongoose.model("SessionReport", SessionReportSchema);