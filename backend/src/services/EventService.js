import { producer } from "../config/kafka.js";
import JobService from "./JobService.js";

class EventService {

  constructor() {
    this.isProducerConnected = false;
  }

  async ensureProducerConnected() {
    if (!this.isProducerConnected) {
      await producer.connect();
      this.isProducerConnected = true;
    }
  }

  async emitChunkCreated(chunkName, mediaId = "default-media", totalChunks = null, userId = null) {

    await this.ensureProducerConnected();

    await producer.send({
      topic: "chunk-created",
      messages: [
        { value: JSON.stringify({ chunk: chunkName, mediaId, userId }) }
      ],
      timeout: 30000
    });

    console.log("Kafka CHUNK_CREATED event emitted:", chunkName);

    // enqueue Redis job with userId so all downstream workers know the owner
    await JobService.enqueueChunk(chunkName, mediaId, totalChunks, userId);

  }

  async emit(event, payload) {

    console.log(`EVENT EMITTED → ${event}`);
    console.log(payload);

    try {
      await this.ensureProducerConnected();

      await producer.send({
        topic: event.toLowerCase().replace(/_/g, "-"),
        messages: [
          { value: JSON.stringify(payload) }
        ],
        timeout: 30000
      });

      console.log(`Kafka event sent: ${event}`);
    } catch (error) {
      console.error(`Failed to send Kafka event ${event}:`, error.message);
    }

  }

}

export default new EventService();