import mongoose from "mongoose";

const SessionSchema = new mongoose.Schema({
  title: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("Session", SessionSchema);