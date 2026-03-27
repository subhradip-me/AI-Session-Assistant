import express from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getSessionStatus,
  retrySession,
  deleteSession,
  reprocessSession,
  listSessions,
  getSessionDetails,
  getSessionLogs
} from "../controllers/SessionStatusController.js";

const router = express.Router();

// All session routes are protected by authentication
router.get("/sessions",                       authenticate, listSessions);
router.get("/session/:mediaId/status",        authenticate, getSessionStatus);
router.get("/session/:mediaId/details",       authenticate, getSessionDetails);
router.get("/session/:mediaId/logs",          authenticate, getSessionLogs);
router.post("/session/:mediaId/retry",        authenticate, retrySession);
router.put("/session/:mediaId/reprocess",     authenticate, reprocessSession);
router.delete("/session/:mediaId",            authenticate, deleteSession);

export default router;
