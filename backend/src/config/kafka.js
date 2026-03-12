import { Kafka } from "kafkajs";

const kafka = new Kafka({
  clientId: "ai-session-assistant",
  brokers: ["localhost:9092"]
});

export const producer = kafka.producer();
export const consumer = kafka.consumer({ groupId: "session-group" });

export default kafka;