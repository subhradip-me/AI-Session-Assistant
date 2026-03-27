import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import IORedis from "ioredis";
import connectDB from "./src/config/db.js";
import QueueService from "./src/services/QueueService.js";
import KafkaService from "./src/services/KafkaService.js";
import { initSocket } from "./src/socket.js";

// Bull Board — BullMQ visual dashboard
import { createBullBoard }              from "@bull-board/api";
import { BullMQAdapter }                from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter }               from "@bull-board/express";
import transcriptionQueue               from "./src/queues/transcriptionQueue.js";    // default
import aggregationQueue                 from "./src/queues/aggregationQueue.js";       // default
import diarizationQueue                 from "./src/queues/diarizationQueue.js";       // default
import windowDiarizationQueue           from "./src/queues/windowDiarizationQueue.js"; // default
import globalContextQueue               from "./src/queues/globalContextQueue.js";     // default
import reportQueue                      from "./src/queues/reportQueue.js";            // default
import cleanerQueue                     from "./src/queues/cleanerQueue.js";           // default
import grouperQueue                     from "./src/queues/grouperQueue.js";           // default
import { analysisQueue }                from "./src/queues/analysisQueue.js";          // named
import { llmQueue }                     from "./src/queues/llmQueue.js";               // named
import { blockQueue }                   from "./src/queues/blockQueue.js";             // named
import { insightAggregationQueue }      from "./src/queues/insightAggregationQueue.js"; // named
import { embeddingQueue }               from "./src/queues/embeddingQueue.js";         // named

// Import routes
import uploadRoutes  from "./src/routes/uploadRoutes.js";
import chatRoutes    from "./src/routes/chatRoutes.js";
import authRoutes    from "./src/routes/authRoutes.js";
import sessionRoutes from "./src/routes/sessionRoutes.js";
import systemRoutes  from "./src/routes/systemRoutes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

await connectDB();

// ── Bull Board setup ────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [
    new BullMQAdapter(transcriptionQueue),
    new BullMQAdapter(windowDiarizationQueue),
    new BullMQAdapter(aggregationQueue),
    new BullMQAdapter(diarizationQueue),
    new BullMQAdapter(cleanerQueue),
    new BullMQAdapter(grouperQueue),
    new BullMQAdapter(analysisQueue),
    new BullMQAdapter(llmQueue),
    new BullMQAdapter(blockQueue),
    new BullMQAdapter(insightAggregationQueue),
    new BullMQAdapter(globalContextQueue),
    new BullMQAdapter(reportQueue),
    new BullMQAdapter(embeddingQueue)
  ],
  serverAdapter
});

app.use("/admin/queues", serverAdapter.getRouter());
console.log("📊 Bull Board available at: http://localhost:5000/admin/queues");

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ── Test endpoints ─────────────────────────────────────────────────────────
app.get("/test-queue", async (req, res) => {
  await QueueService.addTranscriptionJob({ file: "lecture.wav" });
  res.json({ message: "Job added to queue" });
});

app.get("/test-kafka", async (req, res) => {
  await KafkaService.sendTestEvent();
  res.json({ message: "Kafka event sent" });
});

// ── API routes ─────────────────────────────────────────────────────────────
app.use("/api",        uploadRoutes);
app.use("/api",        chatRoutes);
app.use("/api",        authRoutes);
app.use("/api",        sessionRoutes);   // GET/POST/PUT/DELETE /api/session/*
app.use("/api/system", systemRoutes);    // GET /api/system/health  etc.

// ── Global error handler ──────────────────────────────────────────────────
// Must be last middleware — catches errors forwarded by next(err)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("🔥 Unhandled error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error"
  });
});

// ── HTTP server + Socket.IO ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const httpServer = http.createServer(app);

const io = initSocket(httpServer);        // attach Socket.IO to the same HTTP server

// ── Redis pub/sub: forward worker pipeline events → Socket.IO ─────────────
// Workers are separate processes; they publish to "pipeline:update" via Redis.
// This subscriber receives those events and broadcasts them to connected clients.
const subscriber = new IORedis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null
});
await subscriber.subscribe("pipeline:update");
subscriber.on("message", (_channel, message) => {
  try {
    const payload = JSON.parse(message);
    const { mediaId } = payload;
    if (mediaId) {
      io.to(mediaId).emit("pipeline:update", payload);
      io.emit("pipeline:update", payload); // global fallback for clients not in room
    }
  } catch { /* ignore malformed messages */ }
});
console.log("📡 Redis subscriber listening on channel: pipeline:update");

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});