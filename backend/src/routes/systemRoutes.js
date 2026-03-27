import express from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getQueueStats,
  retryDeadJobs,
  getHealth
} from "../controllers/SystemOpsController.js";

const router = express.Router();

// System/admin routes — protected by authentication
router.get("/queues",      authenticate, getQueueStats);
router.post("/retry-dead", authenticate, retryDeadJobs);
router.get("/health",      getHealth);

export default router;
