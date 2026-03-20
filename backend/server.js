import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./src/config/db.js";
import QueueService from "./src/services/QueueService.js";
import KafkaService from "./src/services/KafkaService.js";

// Import routes
import uploadRoutes from "./src/routes/uploadRoutes.js";
import chatRoutes   from "./src/routes/chatRoutes.js";
import authRoutes   from "./src/routes/authRoutes.js";

dotenv.config(); // Load environment variables from .env file

const app = express(); // Create an Express application

app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Middleware to parse JSON request bodies

await connectDB(); // Connect to MongoDB before starting the server

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});




// Test endpoint to add a job to the queue
app.get("/test-queue", async (req, res) => {

  await QueueService.addTranscriptionJob({
    file: "lecture.wav"
  });

  res.json({ message: "Job added to queue" });

});


// Test endpoint to send an event to Kafka


app.get("/test-kafka", async (req, res) => {

  await KafkaService.sendTestEvent();

  res.json({ message: "Kafka event sent" });

});




// Use the upload routes for handling file uploads
app.use("/api", uploadRoutes);

// Use the chat and report routes
app.use("/api", chatRoutes);

// Use the auth routes (register, login, me)
app.use("/api", authRoutes);

const PORT = process.env.PORT || 5000; // Use environment variable for port or default to 5000

// Start the server and listen on the specified port
app.listen(PORT, () => {                          
  console.log(`Server running on port ${PORT}`);
});