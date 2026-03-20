import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env relative to this file's location so the module is self-contained.
// This makes auth.js work correctly whether it is loaded by server.js (which
// also calls dotenv.config()) or by workers directly.
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: join(__dirname, "../../.env") });

// Defer the secret read until after dotenv has run
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

function getExpiresIn() {
  return process.env.JWT_EXPIRES_IN || "7d";
}

/**
 * Sign a JWT for the given user document.
 * Payload contains only userId — nothing sensitive.
 */
export function signToken(userId) {
  return jwt.sign({ userId }, getSecret(), { expiresIn: getExpiresIn() });
}

/**
 * Middleware: verify the JWT from the Authorization header.
 *
 * Expects:  Authorization: Bearer <token>
 * On success: attaches { userId } to req.user and calls next()
 * On failure: returns 401 Unauthorized
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided. Please log in." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const secret  = getSecret();
    const decoded = jwt.verify(token, secret);
    req.user = { userId: decoded.userId };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired. Please log in again." });
    }
    return res.status(401).json({ error: "Invalid token. Please log in." });
  }
}
