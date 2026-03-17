/**
 * TranscriptBufferService
 * 
 * Implements sliding window buffering for early partial diarization.
 * Instead of waiting for all chunks, process windows of 4 consecutive chunks.
 * 
 * Window lifecycle:
 *   chunk 1-4 → window-0-3
 *   chunk 2-5 → window-1-4  (sliding)
 *   chunk 3-6 → window-2-5  (sliding)
 *   ...
 * 
 * Memory is cleaned up when SESSION_INTELLIGENCE_READY is emitted.
 */

const buffers = new Map(); // key: mediaId → value: array of { chunkIndex, text }
const processedWindows = new Set(); // global set to prevent duplicate window processing

const WINDOW_SIZE = 4;

export default class TranscriptBufferService {

  /**
   * Add a transcribed chunk to the buffer
   * 
   * @param {string} mediaId - session ID
   * @param {number} chunkIndex - 0-based chunk index
   * @param {string} text - transcribed chunk text
   * @returns {Object|null} { windowId, mediaId, chunks, chunkRange } if window is ready, null otherwise
   */
  static addChunk(mediaId, chunkIndex, text) {
    if (!buffers.has(mediaId)) {
      buffers.set(mediaId, []);
    }

    const buffer = buffers.get(mediaId);

    buffer.push({ chunkIndex, text });

    // sort to ensure order
    buffer.sort((a, b) => a.chunkIndex - b.chunkIndex);

    return this.checkWindow(mediaId);
  }

  /**
   * Check if a new window is ready
   * 
   * Uses sliding window approach:
   * - Always takes the last WINDOW_SIZE chunks
   * - Only emits if this is a new window (duplicate detection)
   * 
   * @param {string} mediaId
   * @returns {Object|null} window object or null
   */
  static checkWindow(mediaId) {
    const buffer = buffers.get(mediaId);

    if (buffer.length < WINDOW_SIZE) return null;

    // take last WINDOW_SIZE chunks (sliding window)
    const windowChunks = buffer.slice(-WINDOW_SIZE);
    const firstChunkIdx = windowChunks[0].chunkIndex;
    const lastChunkIdx = windowChunks.at(-1).chunkIndex;

    const windowId = `${mediaId}-window-${firstChunkIdx}-${lastChunkIdx}`;

    // Prevent duplicate window processing
    if (processedWindows.has(windowId)) {
      return null;
    }

    // Mark as processed
    processedWindows.add(windowId);

    return {
      windowId,
      mediaId,
      chunks: windowChunks,
      chunkRange: { start: firstChunkIdx, end: lastChunkIdx }
    };
  }

  /**
   * Get current buffer state (for debugging)
   * 
   * @param {string} mediaId
   * @returns {Array} current buffer chunks
   */
  static getBuffer(mediaId) {
    return buffers.get(mediaId) || [];
  }

  /**
   * Get number of chunks in buffer
   * 
   * @param {string} mediaId
   * @returns {number}
   */
  static getBufferSize(mediaId) {
    return buffers.has(mediaId) ? buffers.get(mediaId).length : 0;
  }

  /**
   * Clean up memory for a session (call when SESSION_INTELLIGENCE_READY)
   * 
   * @param {string} mediaId
   */
  static cleanup(mediaId) {
    if (buffers.has(mediaId)) {
      buffers.delete(mediaId);
      console.log(`🧹 Buffer cleanup: ${mediaId}`);
    }
  }

  /**
   * Clear all buffers (use with caution, e.g., testing/debugging)
   */
  static clearAll() {
    buffers.clear();
    processedWindows.clear();
    console.log(`🧹 All buffers cleared`);
  }
}