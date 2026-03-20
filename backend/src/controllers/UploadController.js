import AudioService   from "../services/AudioService.js";
import ChunkService   from "../services/ChunkService.js";
import StorageService from "../services/storageService.js";
import Session        from "../models/Session.js";

class UploadController {

  async uploadFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // userId is set by the authenticate middleware
      const userId   = req.user.userId;
      const sessionId = `session_${Date.now()}`;

      console.log(`Upload received for user ${userId}:`, req.file.path);

      // Step 1: Extract audio from the uploaded video
      const audioPath = await AudioService.extractAudio(req.file.path);
      console.log("Audio extracted:", audioPath);

      // Step 2: Split the audio into chunks
      const { chunkDir, chunkFiles } = await ChunkService.splitAudio(audioPath);
      console.log(`Chunks stored in: ${chunkDir} (${chunkFiles.length} chunks)`);

      // Step 3: Record the session in MongoDB (ties mediaId → userId)
      await Session.create({
        mediaId: sessionId,
        userId,
        title:   req.file.originalname || ""
      });

      // Step 4: Upload chunks to MinIO + enqueue transcription jobs
      //         userId is forwarded through the queue so every worker knows the owner
      const uploadedChunks = await StorageService.uploadChunks(
        chunkDir,
        sessionId,
        chunkFiles.length,
        userId          // 🔑 propagated through entire pipeline
      );

      console.log("Chunks uploaded:", uploadedChunks);

      return res.status(200).json({
        message: "Pipeline executed",
        sessionId,
        video:       req.file.path,
        audio:       audioPath,
        chunks:      chunkDir,
        totalChunks: chunkFiles.length
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }

}

export default new UploadController();