import { producer } from "../config/kafka.js";

class KafkaService {

  async sendTestEvent() {

    await producer.connect();

    await producer.send({
      topic: "test-topic",
      messages: [
        { value: "Hello from AI Session Assistant" }
      ]
    });

    console.log("Kafka event sent");

  }

}

export default new KafkaService();