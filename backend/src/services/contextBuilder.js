import BlockAnalysis from "../models/BlockAnalysis.js";
import SessionContext from "../models/SessionContext.js";

/**
 * Build a structured LLM context string from retrieved blocks.
 *
 * Structure:
 *   Session Summary (if available)
 *   ──────────────────────────────
 *   Relevant Discussions:
 *     [Block N] <time range>
 *     Summary: ...
 *     Key Insights: ...
 *     Topics: ...
 *
 * @param {string} mediaId          - Session identifier
 * @param {Array}  retrievedBlocks  - Output of retrieve() — array of { blockId, score, ... }
 * @returns {Promise<string>}       - Formatted context string ready for LLM prompt
 */
export async function buildContext(mediaId, retrievedBlocks) {
  // 1. Global session summary (from globalContextWorker output)
  const session = await SessionContext.findOne({ mediaId }).lean();

  // 2. Fetch full BlockAnalysis docs for each retrieved block in parallel
  const blocks = await Promise.all(
    retrievedBlocks.map(r =>
      BlockAnalysis.findOne({ mediaId, blockId: r.blockId }).lean()
    )
  );

  // 3. Assemble context string
  let context = "";

  if (session?.summary) {
    context += `Session Overview:\n${session.summary}\n`;
    if (session.topics?.length) {
      context += `Main Topics: ${session.topics.join(", ")}\n`;
    }
    context += "\n";
  }

  const validBlocks = blocks.filter(Boolean);

  if (validBlocks.length === 0) {
    return context || "No relevant context available for this query.";
  }

  context += "Relevant Discussions:\n";

  validBlocks.forEach((b, i) => {
    const timeRange = (b.start != null && b.end != null)
      ? ` [${formatTime(b.start)} – ${formatTime(b.end)}]`
      : "";

    context += `\n[Block ${i + 1}]${timeRange}\n`;

    if (b.summary) {
      context += `Summary: ${b.summary}\n`;
    }

    if (b.insights?.length) {
      context += `Key Insights: ${b.insights.join(" | ")}\n`;
    }

    if (b.topics?.length) {
      context += `Topics: ${b.topics.join(", ")}\n`;
    }

    if (b.decisions?.length) {
      context += `Decisions: ${b.decisions.join(" | ")}\n`;
    }

    if (b.action_items?.length) {
      context += `Action Items: ${b.action_items.join(" | ")}\n`;
    }
  });

  return context;
}

/**
 * Format seconds to mm:ss for readability in the context string.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
