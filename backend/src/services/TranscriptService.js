import minioClient from "../config/minio.js";
import { Readable } from "stream";

const BUCKET = "transcripts";

/**
 * Ensure the transcripts bucket exists in MinIO.
 * Called once at startup from workers that use TranscriptService.
 */
async function ensureBucket() {
  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET, "us-east-1");
    console.log(`✅ MinIO bucket "${BUCKET}" created`);
  }
}

// Auto-initialise on first import (fire-and-forget; errors are non-fatal)
ensureBucket().catch(err =>
  console.warn(`⚠️  Could not ensure MinIO bucket "${BUCKET}":`, err.message)
);

// ─── key helpers ────────────────────────────────────────────────────────────

const chunkKey   = (mediaId, chunkIndex) => `${mediaId}/chunk_${chunkIndex}.txt`;
const finalKey   = (mediaId)             => `${mediaId}/final_transcript.txt`;

// ─── MinIO helpers ───────────────────────────────────────────────────────────

/**
 * Upload a plain text string to MinIO.
 */
async function putText(objectKey, text) {
  const buf = Buffer.from(text, "utf8");
  await minioClient.putObject(BUCKET, objectKey, buf, buf.length, {
    "Content-Type": "text/plain; charset=utf-8"
  });
}

/**
 * Download an object from MinIO and return its content as a UTF-8 string.
 */
async function getText(objectKey) {
  const stream = await minioClient.getObject(BUCKET, objectKey);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", d => chunks.push(d));
    stream.on("end",  () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

/**
 * List all objects whose key starts with a given prefix.
 * Returns an array of object info records.
 */
async function listObjects(prefix) {
  return new Promise((resolve, reject) => {
    const objects = [];
    const stream  = minioClient.listObjects(BUCKET, prefix, true);
    stream.on("data", obj => objects.push(obj));
    stream.on("end",  () => resolve(objects));
    stream.on("error", reject);
  });
}

// ─── TranscriptService ───────────────────────────────────────────────────────

class TranscriptService {

  /**
   * Save a transcript chunk to MinIO.
   * Object key: transcripts/{mediaId}/chunk_{chunkIndex}.txt
   */
  static async saveChunk(mediaId, chunkIndex, text) {
    const key = chunkKey(mediaId, chunkIndex);
    await putText(key, text);
    console.log(`📝 Saved transcript chunk → minio://${BUCKET}/${key}`);
  }

  /**
   * Check whether all expected chunks have been uploaded.
   * Uses MinIO object listing — no local filesystem dependency.
   */
  static async isComplete(mediaId, expectedChunks) {
    const prefix  = `${mediaId}/chunk_`;
    const objects = await listObjects(prefix);
    const count   = objects.length;
    console.log(`isComplete check: ${count} chunks found, ${expectedChunks} expected`);
    return count === expectedChunks;
  }

  /**
   * Fetch all chunk objects from MinIO, merge them in order,
   * upload the merged result as final_transcript.txt, and return the text.
   */
  static async merge(mediaId) {
    const prefix  = `${mediaId}/chunk_`;
    const objects = await listObjects(prefix);

    // Sort by chunk index ascending
    const sorted = objects
      .map(obj => {
        const match = obj.name.match(/chunk_(\d+)\.txt$/);
        return { name: obj.name, index: match ? parseInt(match[1], 10) : -1 };
      })
      .filter(o => o.index >= 0)
      .sort((a, b) => a.index - b.index);

    if (sorted.length === 0) {
      throw new Error(`No transcript chunks found in MinIO for mediaId "${mediaId}"`);
    }

    // Download all chunks in parallel, then join in sorted order
    const texts = await Promise.all(sorted.map(o => getText(o.name)));
    const finalTranscript = texts.join("\n");

    // Persist merged transcript
    await putText(finalKey(mediaId), finalTranscript);
    console.log(`✅ Merged ${sorted.length} chunks → minio://${BUCKET}/${finalKey(mediaId)}`);

    return finalTranscript;
  }
}

export default TranscriptService;