import User from "../models/User.js";
import { signToken } from "../middleware/auth.js";

/**
 * POST /api/auth/register
 *
 * Body: { name, email, password }
 *
 * Creates a new user, hashes the password (via User model pre-save hook),
 * and returns a signed JWT so the user is immediately logged in.
 */
export async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, and password are required" });
    }

    // Check for duplicate email before attempting to save
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const user  = await User.create({ name, email, password });
    const token = signToken(user._id.toString());

    return res.status(201).json({
      message: "Account created successfully",
      token,
      user: {
        id:    user._id,
        name:  user.name,
        email: user.email
      }
    });
  } catch (err) {
    // Mongoose validation errors (e.g. invalid email format, short password)
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join(". ") });
    }

    console.error("❌ Register error:", err);
    return res.status(500).json({ error: "Registration failed. Please try again.", details: err.message });
  }
}

/**
 * POST /api/auth/login
 *
 * Body: { email, password }
 *
 * Verifies credentials and returns a signed JWT on success.
 * Generic error messages prevent user enumeration attacks.
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    // .select("+password") is needed because the field has select:false on the schema
    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

    // Use the same error message whether the email doesn't exist or the password
    // is wrong — this prevents user enumeration
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user._id.toString());

    return res.json({
      message: "Logged in successfully",
      token,
      user: {
        id:    user._id,
        name:  user.name,
        email: user.email
      }
    });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    return res.status(500).json({ error: "Login failed. Please try again." });
  }
}

/**
 * GET /api/auth/me
 *
 * Protected route — requires valid JWT (authenticate middleware).
 * Returns the currently authenticated user's profile.
 */
export async function getMe(req, res) {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      user: {
        id:        user._id,
        name:      user.name,
        email:     user.email,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    console.error("❌ GetMe error:", err.message);
    return res.status(500).json({ error: "Failed to fetch user profile." });
  }
}
