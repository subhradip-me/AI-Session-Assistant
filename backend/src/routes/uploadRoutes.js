import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import UploadController from "../controllers/UploadController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Ensure upload directories exist before multer tries to write there
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const CHUNKS_DIR  = path.resolve(__dirname, "../../uploads/chunks");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(CHUNKS_DIR,  { recursive: true });

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },

  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// Use controller instead of inline function
router.post(
  "/upload",
  upload.single("file"),
  UploadController.uploadFile
);

export default router;