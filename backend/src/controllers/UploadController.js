import AudioService from "../services/AudioService.js";
import ChunkService from "../services/ChunkService.js";
import StorageService from "../services/storageService.js";

class UploadController {

  async uploadFile(req, res) {

    try {

      if (!req.file) {
        return res.status(400).json({
          message: "No file uploaded"
        });
      }

      console.log("Upload received:", req.file.path);

      // Generate unique session ID
      const sessionId = `session_${Date.now()}`;

      // Step 1: Extract audio from the uploaded video

      const audioPath = await AudioService.extractAudio(req.file.path);

      console.log("Audio extracted:", audioPath);


      // Step 2: Split the audio into chunks

      const { chunkDir, chunkFiles } = await ChunkService.splitAudio(audioPath);

      console.log(`Chunks stored in: ${chunkDir} (${chunkFiles.length} chunks)`);


      // Step 3: Upload chunks to MinIO

      const uploadedChunks = await StorageService.uploadChunks(chunkDir, sessionId, chunkFiles.length);

      console.log("Chunks uploaded:", uploadedChunks);

      return res.status(200).json({
        message: "Pipeline executed",
        sessionId,
        video: req.file.path,
        audio: audioPath,
        chunks: chunkDir,
        totalChunks: chunkFiles.length
      });

    } catch (error) {

      console.error(error);

      return res.status(500).json({
        error: error.message
      });

    }

  }

}

export default new UploadController();