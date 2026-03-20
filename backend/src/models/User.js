import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const UserSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, "Name is required"],
      trim:     true
    },

    email: {
      type:      String,
      required:  [true, "Email is required"],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, "Please provide a valid email"]
    },

    password: {
      type:     String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      // Never return the password field in query results by default
      select:   false
    }
  },
  { timestamps: true }
);

// ── Pre-save hook: hash password before storing ────────────────────────────────
// NOTE: Do NOT use next() with async hooks in Mongoose 7+.
// Mongoose awaits the returned Promise; calling next() causes "next is not a function".
UserSchema.pre("save", async function () {
  // Only re-hash if the password field was actually modified
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// ── Instance method: compare a plain-text password to the stored hash ──────────
UserSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password);
};

export default mongoose.model("User", UserSchema);
