import express from "express";
import multer from "multer";
import UploadController from "../controllers/UploadController.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
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