import mongoose from "mongoose";

const SessionContextSchema = new mongoose.Schema({

  mediaId: {
    type: String,
    required: true,
    index: true
  },

  summary: String,

  topics: [String],

  insights: [String]

}, { timestamps: true });

export default mongoose.model("SessionContext", SessionContextSchema);
