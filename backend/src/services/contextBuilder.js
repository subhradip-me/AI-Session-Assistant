import BlockAnalysis   from "../models/BlockAnalysis.js";
import SegmentAnalysis from "../models/SegmentAnalysis.js";
import SessionContext  from "../models/SessionContext.js";
import UserMemory      from "../models/UserMemory.js";

/**
 * Build a structured LLM context string from multi-layer retrieval results.
 *
 * Context layers (ordered broad → specific):
 *   0. User Intent    — what the user is actually trying to achieve (NEW)
 *   1. User Memory    — long-term cross-session user profile (NEW)
 *   2. Global Overview — SessionContext (full-session AI summary)
 *   3. Discussion Blocks — BlockAnalysis docs (~12-min chunks)
 *   4. Segment Details — SegmentAnalysis docs (~90-sec fine-grained excerpts)
 *
 * The LLM receives the broadest context first, ending with the most specific.
 * Intent and memory are at the very top so the LLM prioritises them.
 *
 * @param {string}  mediaId    - Session ID
 * @param {{ blocks: Array, segments: Array }} retrieved - Output of retrieverService.retrieve()
 * @param {string}  [userId]   - User ID for memory lookup (optional)
 * @param {string}  [intent]   - Detected intent from intentService (optional)
 * @returns {Promise<string>}  Formatted context string for the LLM prompt
 */
export async function buildContext(mediaId, retrieved = {}, userId = null, intent = null) {
  const { blocks: retrievedBlocks = [], segments: retrievedSegments = [] } = retrieved;

  let context = "";

  // ── 0. User Intent (top of context — steers the LLM immediately) ──────────
  if (intent) {
    context += `=== User Intent ===\n`;
    context += `${intentLabel(intent)}\n\n`;
  }

  // ── 1. Long-Term User Memory (cross-session knowledge) ────────────────────
  if (userId) {
    const memory = await UserMemory.findOne({ userId }).lean();

    if (memory?.topics?.length || memory?.insights?.length) {
      console.log(`🧠 contextBuilder: UserMemory found for ${userId} — ${memory.topics?.length ?? 0} topics, ${memory.insights?.length ?? 0} insights`);

      context += `=== Your Profile (from ${memory.sessionCount ?? "previous"} sessions) ===\n`;

      if (memory.topics?.length) {
        context += `Your recurring topics: ${memory.topics.slice(0, 10).join(", ")}\n`;
      }

      if (memory.insights?.length) {
        context += `Insights from your past sessions: ${memory.insights.slice(0, 5).join(" | ")}\n`;
      }

      context += "\n";
    } else {
      console.log(`🧠 contextBuilder: no UserMemory for ${userId} (first session?)`);
    }
  }

  // ── 2. Global session context (full-session overview) ─────────────────────
  const session = await SessionContext.findOne({ mediaId }).lean();

  if (session?.summary) {
    context += "=== Session Overview ===\n";
    context += `${session.summary}\n`;

    if (session.topics?.length) {
      context += `Key Topics: ${session.topics.join(", ")}\n`;
    }

    if (session.insights?.length) {
      context += `Session Insights: ${session.insights.join(" | ")}\n`;
    }

    context += "\n";
  }

  // ── 3. Relevant discussion blocks (parallel fetch) ─────────────────────────
  if (retrievedBlocks.length > 0) {
    const blockDocs = await Promise.all(
      retrievedBlocks.map(r =>
        BlockAnalysis.findOne({ mediaId, blockId: r.blockId }).lean()
      )
    );

    const validBlocks = blockDocs.filter(Boolean);

    if (validBlocks.length > 0) {
      context += "=== Relevant Discussion Blocks ===\n";

      validBlocks.forEach((b, i) => {
        const timeRange = (b.start != null && b.end != null)
          ? ` [${formatTime(b.start)} – ${formatTime(b.end)}]`
          : "";

        context += `\n[Block ${i + 1}]${timeRange}\n`;

        if (b.summary)              context += `Summary: ${b.summary}\n`;
        if (b.insights?.length)     context += `Insights: ${b.insights.join(" | ")}\n`;
        if (b.topics?.length)       context += `Topics: ${b.topics.join(", ")}\n`;
        if (b.decisions?.length)    context += `Decisions: ${b.decisions.join(" | ")}\n`;
        if (b.action_items?.length) context += `Action Items: ${b.action_items.join(" | ")}\n`;
      });

      context += "\n";
    }
  }

  // ── 4. Supporting segment details (parallel fetch) ─────────────────────────
  if (retrievedSegments.length > 0) {
    const segDocs = await Promise.all(
      retrievedSegments.map(r =>
        SegmentAnalysis.findOne({ mediaId, segmentId: r.segmentId }).lean()
      )
    );

    const validSegs = segDocs.filter(Boolean);

    if (validSegs.length > 0) {
      context += "=== Supporting Segment Details ===\n";

      validSegs.forEach((s, i) => {
        context += `\n[Segment ${i + 1}]\n`;

        if (s.summary)              context += `Summary: ${s.summary}\n`;
        if (s.topics?.length)       context += `Topics: ${s.topics.join(", ")}\n`;
        if (s.insights?.length)     context += `Insights: ${s.insights.join(" | ")}\n`;
        if (s.action_items?.length) context += `Action Items: ${s.action_items.join(" | ")}\n`;
      });

      context += "\n";
    }
  }

  return context || "No relevant context could be retrieved for this query.";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return a human-readable intent description for the context header.
 */
function intentLabel(intent) {
  const labels = {
    summary:          "The user wants a high-level overview or recap.",
    deep_explanation: "The user wants a detailed explanation of a concept.",
    decision:         "The user is asking about decisions, choices, or conclusions made.",
    action_items:     "The user is asking about tasks, next steps, or responsibilities.",
    question_answer:  "The user is asking a specific factual question.",
    trend:            "The user is asking about patterns, recurring themes, or changes over time."
  };
  return labels[intent] ?? `User intent: ${intent}`;
}

/**
 * Format seconds to mm:ss for readability.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
