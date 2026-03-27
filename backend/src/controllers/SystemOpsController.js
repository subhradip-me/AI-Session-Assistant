import * as SystemMonitorService from "../services/SystemMonitorService.js";

// ─── GET /api/system/queues ───────────────────────────────────────────────────

export const getQueueStats = async (req, res, next) => {
  try {
    const stats = await SystemMonitorService.getQueueStats();
    return res.json(stats);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/system/retry-dead ─────────────────────────────────────────────

export const retryDeadJobs = async (req, res, next) => {
  try {
    const result = await SystemMonitorService.retryDeadJobs();
    return res.json({ message: "Dead jobs retried successfully", ...result });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/system/health ───────────────────────────────────────────────────

export const getHealth = async (req, res, next) => {
  try {
    const health = await SystemMonitorService.getHealth();
    const allOk = Object.values(health).every(s => s.ok);
    return res.status(allOk ? 200 : 207).json({ overall: allOk ? "healthy" : "degraded", services: health });
  } catch (err) {
    next(err);
  }
};
