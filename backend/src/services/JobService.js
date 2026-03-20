import transcriptionQueue from "../queues/transcriptionQueue.js";

class JobService {

  async enqueueChunk(chunkName, mediaId = "default-media", totalChunks = null, userId = null) {

    // Extract chunk index from filename (e.g., "chunk_003.wav" -> 3)
    const chunkIndex = parseInt(chunkName.split("_")[1].split(".")[0]);

    const jobData = {
      mediaId,
      userId,         // 🔑 propagated from upload so all workers know the owner
      chunkName,
      chunkPath: `uploads/chunks/${chunkName}`,
      chunkIndex
    };

    if (totalChunks !== null) {
      jobData.totalChunks = totalChunks;
    }

    await transcriptionQueue.add("transcribe", jobData);

    console.log(`Job added for chunk: ${chunkName} (index: ${chunkIndex}, total: ${totalChunks}, user: ${userId})`);

  }

}

export default new JobService();