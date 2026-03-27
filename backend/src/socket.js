import { Server } from "socket.io";

let io = null;

/**
 * Initialise the Socket.IO server on top of an existing HTTP server.
 * Call this once from server.js after creating the HTTP server.
 */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: "*",       // allow any origin in development; tighten in production
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    console.log(`🔌 Socket.IO client connected: ${socket.id}`);

    socket.on("join:session", (mediaId) => {
      socket.join(mediaId);
      console.log(`   → ${socket.id} joined room: ${mediaId}`);
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Socket.IO client disconnected: ${socket.id}`);
    });
  });

  console.log("✅ Socket.IO server initialised");
  return io;
}

/**
 * Returns the active Socket.IO server instance.
 * Safe to call from any worker — returns null if not yet initialised (workers
 * initialise their own event loop, so getIO() returning null is handled gracefully).
 */
export function getIO() {
  return io;
}

/**
 * Convenience helper — emits a pipeline update event to all clients in the
 * mediaId room (and globally as fallback).
 * Workers call this after each state change.
 *
 * @param {string} mediaId
 * @param {string} step     — "transcription" | "diarization" | ... | "completed" | "failed"
 * @param {string} status   — "running" | "completed" | "failed"
 * @param {object} [extra]  — optional extra fields (progress, completedChunks, etc.)
 */
export function emitPipelineUpdate(mediaId, step, status, extra = {}) {
  if (!io) return; // not initialised in worker processes — ignore safely
  const payload = { mediaId, step, status, ...extra, updatedAt: new Date().toISOString() };
  // Emit to the mediaId room first (if frontend subscribed), then broadcast globally
  io.to(mediaId).emit("pipeline:update", payload);
  io.emit("pipeline:update", payload); // also global for clients not yet in room
}
