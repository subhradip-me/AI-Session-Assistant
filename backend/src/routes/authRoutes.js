import express from "express";
import { register, login, getMe } from "../controllers/AuthController.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /api/auth/register
 * Public — create a new account
 */
router.post("/auth/register", register);

/**
 * POST /api/auth/login
 * Public — authenticate and receive a JWT
 */
router.post("/auth/login", login);

/**
 * GET /api/auth/me
 * Protected — requires: Authorization: Bearer <token>
 * Returns the current user's profile
 */
router.get("/auth/me", authenticate, getMe);

export default router;
