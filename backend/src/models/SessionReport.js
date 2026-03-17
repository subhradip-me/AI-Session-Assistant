import mongoose from "mongoose";

const SessionReportSchema = new mongoose.Schema({
    mediaId: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
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

const SessionReport = mongoose.model("SessionReport", SessionReportSchema);

export default SessionReport;