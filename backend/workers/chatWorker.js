import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import AIAnalysisService  from "../src/services/AIAnalysisService.js";
import { retrieve }       from "../src/services/retrieverService.js";
import { buildContext }   from "../src/services/contextBuilder.js";
import { detectIntent, rewriteQuery } from "../src/services/intentService.js";
import { captureFeedback }            from "../src/services/retrievalOptimizer.js";
import UserMemory         from "../src/models/UserMemory.js";
import connectDB from "../src/config/db.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

console.log("💬 Chat Worker Started");

const worker = new Worker(
  "chat-query",
  async (job) => {
    const { mediaId, question, userId } = job.data;

    console.log(`💬 [${mediaId}] Question: "${question}"`);

    // ── 0. Load user memory (needed for intent rewrite + context + vector nudge) ──
    let userMemory = null;
    if (userId) {
      userMemory = await UserMemory.findOne({ userId }).lean();
      if (userMemory) {
        console.log(`🧠 [${mediaId}] User memory loaded: ${userMemory.topics?.length ?? 0} topics, ${userMemory.insights?.length ?? 0} insights (${userMemory.sessionCount ?? 0} sessions)`);
      }
    }

    // ── 1. Intent detection ────────────────────────────────────────────────────
    let intent = "question_answer";
    try {
      intent = await detectIntent(question);
      console.log(`🎯 [${mediaId}] Intent detected: "${intent}"`);
    } catch (err) {
      console.warn(`   ⚠️  Intent detection failed (${err.message}) — defaulting`);
    }

    // ── 2. Query rewriting (semantic enrichment for ANN retrieval) ─────────────
    let retrievalQuery = question;
    try {
      retrievalQuery = await rewriteQuery(question, intent, userMemory);
    } catch (err) {
      console.warn(`   ⚠️  Query rewrite failed (${err.message}) — using original`);
    }

    // ── 3. Multi-layer retrieval with personalized vector nudging ──────────────
    let retrieved = { blocks: [], segments: [] };
    try {
      retrieved = await retrieve(mediaId, retrievalQuery, 3, 3, userId, userMemory);
      console.log(
        `   🔍 Retrieved ${retrieved.blocks.length} block(s), ` +
        `${retrieved.segments.length} segment(s) — depth-ranked`
      );
    } catch (err) {
      console.warn(`   ⚠️  Retrieval failed (${err.message}) — falling back to global-context only`);
    }

    // ── 4. Build structured context (UserMemory + Intent + 3 session layers) ───
    let context = "";
    try {
      context = await buildContext(mediaId, retrieved, userId, intent);
    } catch (err) {
      console.warn(`   ⚠️  Context build failed (${err.message})`);
    }

    if (!context) {
      context = "No relevant context could be retrieved for this query.";
    }

    // ── 5. AGENT 1 — Analyst: reason over context before answering ─────────────
    // Multi-agent reasoning: Agent 1 analyses the context without generating a
    // final answer. This pre-reasoning step forces the model to extract signals
    // and patterns first, so Agent 2 builds its answer on structured intelligence
    // rather than raw noisy context.
    let analystReport = "";
    try {
      const analystPrompt = `You are a session intelligence analyst. Your job is to STUDY the context below and extract structured intelligence — NOT to answer the user's question yet.

User Intent: ${intent}
User Question: "${question}"

Context:
${context}

Analyse the context and extract:
1. Core themes and patterns most relevant to the question
2. The strongest, most specific evidence that addresses the intent
3. Any contradictions, gaps, or tensions in the information
4. Key decisions, actions, or insights that are directly relevant

Be concise and structured. Use bullet points. Do not answer the question — only analyse.`;

      analystReport = await AIAnalysisService.groqChat(analystPrompt, 0.2);
      console.log(`   🤖 Agent 1 (Analyst) completed analysis`);
    } catch (err) {
      console.warn(`   ⚠️  Agent 1 analysis failed (${err.message}) — skipping analysis step`);
      // Fall back to passing context directly to Agent 2
      analystReport = "";
    }

    // ── 6. AGENT 2 — Answerer: uses analyst report to generate deep answer ──────
    // Agent 2 never sees raw noisy context — it sees pre-reasoned intelligence.
    // This produces answers that feel like they came from an expert who read
    // the session, understood it, and then answered your specific question.
    const intentInstructions = buildIntentInstructions(intent);

    const answererPrompt = analystReport
      ? `You are an expert AI session assistant. A senior analyst has already studied the session data and prepared the following intelligence report.

USER INTENT: ${intent}
USER QUESTION: "${question}"

ANALYST REPORT (pre-processed intelligence):
${analystReport}

ORIGINAL CONTEXT (for reference):
${context}

${intentInstructions}

Generate a deep, specific, and directly useful answer. Prioritise:
- Non-obvious insights over generic observations
- Specific evidence from the context over general statements
- Decisions and action items if intent is decision/action_items
- Cross-session patterns from User Profile if relevant
- Timestamp references when mentioning specific blocks

Answer:`
      : `You are an AI session assistant that answers questions about a recorded meeting or lecture.

You have been given structured context with multiple layers:
  - "User Profile": your long-term interests and patterns (if available)
  - "Session Overview": the full-session summary and main topics
  - "Relevant Discussion Blocks": high-level thematic chunks (~12 minutes each)
  - "Supporting Segment Details": fine-grained excerpts (~90 seconds each)

USER INTENT: ${intent}

Context (retrieved from the session):
${context}

User Question: "${question}"

${intentInstructions}

Answer:`;

    // ── 7. Generate final answer ───────────────────────────────────────────────
    const answer = await AIAnalysisService.groqChat(answererPrompt, 0.4);

    console.log(`✅ Chat answer generated for ${mediaId} (intent: ${intent}, multi-agent: ${!!analystReport})`);

    // ── 8. Capture feedback asynchronously (self-learning, non-blocking) ───────
    // Fire and forget — never awaited, never surfaces errors to the user.
    captureFeedback({
      userId,
      mediaId,
      query:            retrievalQuery,
      intent,
      retrievedBlocks:  retrieved.blocks,
      answer
    }).catch(err => console.warn(`⚠️  Feedback capture failed: ${err.message}`));

    return {
      answer,
      retrievedBlocks:   retrieved.blocks.length,
      retrievedSegments: retrieved.segments.length,
      intent,
      usedMultiAgent:    !!analystReport
    };
  },
  {
    connection: redis,
    removeOnComplete: { count: 20 },
    removeOnFail:     { count: 20 }
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Chat job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Chat job ${job?.id} failed:`, err.message);
});

// ─── Intent-specific answer instructions ──────────────────────────────────────

/**
 * Returns focused answering instructions based on the detected intent.
 * This guides Agent 2 to emphasise the right type of information.
 *
 * @param {string} intent
 * @returns {string}
 */
function buildIntentInstructions(intent) {
  const map = {
    summary:
      "Provide a clear, well-structured overview. Cover the main themes, key points, and overall arc. Avoid excessive detail.",

    deep_explanation:
      "Provide a thorough explanation. Go beyond surface-level — explain the 'why', the mechanisms, the implications. Use evidence from the context.",

    decision:
      "Focus specifically on decisions made, choices discussed, and conclusions reached. List them clearly. If none exist, say so explicitly.",

    action_items:
      "Focus specifically on tasks, action items, responsibilities, and next steps. List each item with its owner and deadline if mentioned. Prioritise concrete specifics.",

    question_answer:
      "Answer the question directly and specifically. Use the most granular evidence available from Segment Details. If the answer is not in the context, say so — do not hallucinate.",

    trend:
      "Identify patterns, recurring themes, and changes over time. Draw on both session data and the user's profile history if available."
  };

  const base = map[intent] ?? "Answer clearly and specifically using only the context above.";

  return `Instructions (${intent}):
- ${base}
- Do NOT invent information not present in the context
- Prefer specific evidence over generic statements
- Keep the answer concise but complete
- Where useful, reference timestamps from Discussion Blocks`;
}
