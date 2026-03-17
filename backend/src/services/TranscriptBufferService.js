/**
 * TranscriptBufferService
 *
 * Implements sliding window buffering for early partial diarization.
 * Instead of waiting for all chunks, process windows of 4 consecutive chunks.
 *
 * Window lifecycle (with STRIDE=2):
 *   chunk 0-3 → window-0-3   (chunk 3 is 1st even-indexed last chunk)
 *   chunk 2-5 → window-2-5   (stride skips 1-4)
 *   chunk 4-7 → window-4-7   (stride skips 3-6)
 *   ...
 *
 * STRIDE reduces window count from (N-3) to ~(N-3)/2, preventing queue explosion.
 *
 * Continuity check ensures windows with missing/out-of-order chunks are skipped.
 *
 * Memory is cleaned up when SESSION_INTELLIGENCE_READY is emitted.
 */

const buffers = new Map();         // key: mediaId → value: array of { chunkIndex, text }
const processedWindows = new Set(); // global set to prevent duplicate window processing

const WINDOW_SIZE   = 4;
const WINDOW_STRIDE = 2; // only emit a window every 2nd chunk — prevents queue explosion

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validates that chunks form a contiguous sequence with no gaps.
 * Out-of-order or missing chunks (e.g. [0,1,3,4]) produce malformed windows
 * whose combined text silently skips audio content — so we reject them.
 *
 * @param {Array<{chunkIndex: number, text: string}>} chunks
 * @returns {boolean} true if all chunks are consecutive (no gaps)
 */
function isContinuous(chunks) {
  return chunks.every((c, i, arr) => {
    if (i === 0) return true;
    return c.chunkIndex === arr[i - 1].chunkIndex + 1;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export default class TranscriptBufferService {

  /**
   * Add a transcribed chunk to the buffer.
   *
   * @param {string} mediaId    - session ID
   * @param {number} chunkIndex - 0-based chunk index
   * @param {string} text       - transcribed chunk text
   * @returns {Object|null} window object if a new valid window is ready, null otherwise
   */
  static addChunk(mediaId, chunkIndex, text) {
    if (!buffers.has(mediaId)) {
      buffers.set(mediaId, []);
    }

    const buffer = buffers.get(mediaId);

    buffer.push({ chunkIndex, text });

    // Keep buffer sorted by chunkIndex at all times
    buffer.sort((a, b) => a.chunkIndex - b.chunkIndex);

    return this.checkWindow(mediaId);
  }

  /**
   * Check if a new valid window is ready after the latest chunk was added.
   *
   * Rules applied (in order):
   *   1. Buffer must have at least WINDOW_SIZE chunks
   *   2. The last chunk's index must be divisible by WINDOW_STRIDE (stride gate)
   *   3. The window chunks must be strictly consecutive (continuity check)
   *   4. This exact window must not have been emitted before (duplicate guard)
   *
   * @param {string} mediaId
   * @returns {Object|null} window descriptor or null
   */
  static checkWindow(mediaId) {
    const buffer = buffers.get(mediaId);

    if (!buffer || buffer.length < WINDOW_SIZE) return null;

    // Take the last WINDOW_SIZE chunks (sliding window)
    const windowChunks = buffer.slice(-WINDOW_SIZE);
    const firstChunkIdx = windowChunks[0].chunkIndex;
    const lastChunkIdx  = windowChunks[windowChunks.length - 1].chunkIndex;

    // ── Stride gate ──────────────────────────────────────────────────────────
    // Only emit a window when the newest chunk index is an even multiple of STRIDE.
    // Example (STRIDE=2): emit when lastChunkIdx = 1,3,5,7,... (0-based, so chunk
    // indices 3,5,7 trigger windows [0-3],[2-5],[4-7] etc.)
    if (lastChunkIdx % WINDOW_STRIDE !== (WINDOW_STRIDE - 1)) return null;

    // ── Continuity check ─────────────────────────────────────────────────────
    // Reject windows where chunks are non-consecutive (network gaps/reorder).
    if (!isContinuous(windowChunks)) {
      console.warn(
        `⚠️  TranscriptBuffer: Non-continuous window skipped for ${mediaId}` +
        ` (chunks: ${windowChunks.map(c => c.chunkIndex).join(',')})`
      );
      return null;
    }

    const windowId = `${mediaId}-window-${firstChunkIdx}-${lastChunkIdx}`;

    // ── Duplicate guard ───────────────────────────────────────────────────────
    if (processedWindows.has(windowId)) return null;
    processedWindows.add(windowId);

    return {
      windowId,
      mediaId,
      chunks: windowChunks,
      chunkRange: { start: firstChunkIdx, end: lastChunkIdx }
    };
  }

  /**
   * Get current buffer state (for debugging / testing).
   *
   * @param {string} mediaId
   * @returns {Array} current buffer chunks
   */
  static getBuffer(mediaId) {
    return buffers.get(mediaId) || [];
  }

  /**
   * Get number of chunks currently in the buffer.
   *
   * @param {string} mediaId
   * @returns {number}
   */
  static getBufferSize(mediaId) {
    return buffers.has(mediaId) ? buffers.get(mediaId).length : 0;
  }

  /**
   * Clean up memory for a session (call when SESSION_INTELLIGENCE_READY is emitted).
   *
   * @param {string} mediaId
   */
  static cleanup(mediaId) {
    if (buffers.has(mediaId)) {
      buffers.delete(mediaId);
      console.log(`🧹 Buffer cleanup: ${mediaId}`);
    }
    // Also clean processed window tracking to avoid unbounded Set growth
    for (const key of processedWindows) {
      if (key.startsWith(mediaId)) processedWindows.delete(key);
    }
  }

  /**
   * Clear all buffers (use with caution, e.g., testing / debugging only).
   */
  static clearAll() {
    buffers.clear();
    processedWindows.clear();
    console.log(`🧹 All buffers cleared`);
  }
}