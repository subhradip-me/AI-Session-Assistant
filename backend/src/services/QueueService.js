import transcriptionQueue from "../queues/transcriptionQueue.js";

class QueueService {

  async addTranscriptionJob(data) {

    await transcriptionQueue.add("transcribe", data);

  }

}

export default new QueueService();