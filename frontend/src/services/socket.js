import { io as ioClient } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

let socket = null;

/**
 * Returns the singleton Socket.IO client instance.
 * Creates it on first call, reconnects automatically if disconnected.
 */
export function getSocket() {
  if (!socket) {
    socket = ioClient(SOCKET_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true
    });

    socket.on("connect", () => {
      console.log("🔌 Socket.IO connected:", socket.id);
    });

    socket.on("disconnect", () => {
      console.warn("🔌 Socket.IO disconnected");
    });

    socket.on("connect_error", (err) => {
      console.warn("🔌 Socket.IO connection error:", err.message);
    });
  }
  return socket;
}

/**
 * Join a session room so this client receives events only for that session.
 * Call this when navigating to a session view page.
 */
export function joinSessionRoom(mediaId) {
  const s = getSocket();
  s.emit("join:session", mediaId);
}

/**
 * Disconnect the socket (call on logout or app teardown).
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
