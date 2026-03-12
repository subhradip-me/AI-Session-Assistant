import mongoose from "mongoose";

const SegmentSchema = new mongoose.Schema({
  segmentId: Number,
  speakerId: String,
  start: Number,
  end: Number,
  text: String
});

const TranscriptSchema = new mongoose.Schema({
  mediaId: String,
  segments: [SegmentSchema],
  status: {
    type: String,
    enum: ['raw', 'cleaned', 'grouped'],
    default: 'raw'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("Transcript", TranscriptSchema);