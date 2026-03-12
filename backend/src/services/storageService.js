import minioClient from "../config/minio.js";
import fs from "fs";
import path from "path";
import EventService from "./EventService.js";

class StorageService {

  async uploadChunks(chunkDir, mediaId= "default-session", totalChunks = null) {

    const bucket = "session-files";

    const files = fs.readdirSync(chunkDir);

    const uploaded = [];

    for (const file of files) {

      const filePath = path.join(chunkDir, file);

      await minioClient.fPutObject(
        bucket,
        `chunks/${file}`,
        filePath
      );

      console.log("Uploaded chunk:", file);

      await EventService.emitChunkCreated(file, mediaId, totalChunks);

      uploaded.push(file);

    }

    return uploaded;

  }

}

export default new StorageService();