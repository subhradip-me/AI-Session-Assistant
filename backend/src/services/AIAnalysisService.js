import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = "gemini-2.0-flash";

/** Returns true when an error is a rate-limit (429 / TPD / TPM) from any provider. */
function isRateLimit(err) {
  const msg = String(err?.message || "");
  return (
    err?.status === 429 ||
    err?.statusCode === 429 ||
    msg.includes("rate_limit_exceeded") ||
    msg.includes("Rate limit") ||
    msg.includes("Too Many Requests") ||
    msg.includes("exceeded your current quota")
  );
}

/**
 * Parse how long to wait (ms) from a rate-limit error.
 * Handles both Groq ("Please try again in 1m5.664s") and
 * Gemini (retryDelay field inside the JSON payload).
 */
function parseRetryDelay(err) {
  const msg = String(err?.message || "");

  // Gemini PerDay quota exhausted — the RetryInfo gives ~54 s which is only
  // the per-minute window. The daily quota needs hours to reset.
  // Detect the PerDay quotaId string in the JSON payload and back off 2 h.
  if (msg.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier")) {
    return 2 * 60 * 60 * 1000; // 2 hours
  }

  // Gemini embeds a RetryInfo JSON array in the error message
  try {
    const jsonStart = msg.indexOf("[{");
    if (jsonStart !== -1) {
      const jsonStr = msg.substring(jsonStart);
      const arr = JSON.parse(jsonStr);
      for (const item of arr) {
        if (item["@type"]?.includes("RetryInfo") && item.retryDelay) {
          const secs = parseFloat(item.retryDelay);   // "59s" or "3s"
          if (!isNaN(secs) && secs > 0) return secs * 1000;
        }
      }
    }
  } catch { /* ignore JSON parse errors */ }

  // Groq: "Please try again in 1m5.664s"
  const minSec = msg.match(/try again in (\d+)m([\d.]+)s/);
  if (minSec) return (parseInt(minSec[1]) * 60 + parseFloat(minSec[2])) * 1000;

  // Groq fallback: "Please try again in 65.5s"
  const sec = msg.match(/try again in ([\d.]+)s/);
  if (sec) return parseFloat(sec[1]) * 1000;

  // Default safety buffer
  return 65_000;
}

/**
 * Call Groq first; on 429 try Gemini; if both are rate-limited,
 * wait for the longer retry delay and try again — up to maxRetries times.
 */
async function callWithRetry(groqFn, geminiFn, maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // ── Try Groq ──────────────────────────────────────────────────────────────
    let groqErr;
    try {
      return await groqFn();
    } catch (err) {
      if (!isRateLimit(err)) throw err;
      groqErr = err;
      console.warn("⚠️  Groq rate limit — falling back to Gemini");
    }

    // ── Try Gemini ────────────────────────────────────────────────────────────
    let geminiErr;
    try {
      return await geminiFn();
    } catch (err) {
      if (!isRateLimit(err)) throw err;
      geminiErr = err;
    }

    // ── Both exhausted — wait for the SHORTEST recovery time, then retry ──────
    // We only need ONE provider to become available again, so we wait for
    // min(groqDelay, geminiDelay). Example: Groq needs 300s, Gemini PerDay
    // needs 7200s → wait 300s, Groq recovers, retry succeeds.
    if (attempt < maxRetries) {
      const groqDelay   = groqErr   ? parseRetryDelay(groqErr)   : 0;
      const geminiDelay = geminiErr ? parseRetryDelay(geminiErr) : 0;
      const waitMs      = Math.min(groqDelay, geminiDelay);
      const waitSec     = Math.ceil(waitMs / 1000);
      const fastProv    = groqDelay <= geminiDelay ? "Groq" : "Gemini";
      console.warn(`⏳ Both providers rate-limited. Waiting ${waitSec}s for ${fastProv} to recover (retry ${attempt + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw new Error("All AI providers rate-limited after maximum retries");
}

/** Call Gemini and return the plain-text response. */
async function geminiGenerate(prompt) {
  const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

class AIAnalysisService {

  // ─── Text-based parsers (work for both Groq and Gemini output) ───────────────

  parseJsonText(raw) {
    let content = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const first = content.indexOf("{");
    const last  = content.lastIndexOf("}");
    if (first !== -1 && last !== -1) content = content.substring(first, last + 1);

    return JSON.parse(content);
  }

  parseArrayText(raw) {
    let content = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const first = content.indexOf("[");
    const last  = content.lastIndexOf("]");
    if (first !== -1 && last !== -1) content = content.substring(first, last + 1);

    return JSON.parse(content);
  }

  // ─── Groq helpers ─────────────────────────────────────────────────────────────

  async groqChat(prompt, temperature = 0.2) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature
    });
    return res.choices[0].message.content;
  }

  // ─── Public methods ───────────────────────────────────────────────────────────

  /**
   * Shared prompt builder for per-segment analysis.
   * Used by analyze(), analyzeGroq(), and analyzeGemini() — keeps prompts in sync.
   */
  _buildAnalyzePrompt(text, previousContext = "") {
    return `
You are an AI session analyst. Your job is to extract ONLY the highest-value information from this segment.

Strict quality rules:
- topics: only genuinely distinct, specific concepts — NOT generic terms like "AI", "coding", "technology"
- insights: only non-obvious observations a reader could act on — skip anything self-evident
- questions: only open, unresolved questions raised in this segment — NOT rhetorical questions
- decisions: only if a decision was EXPLICITLY stated — NOT implied
- action_items: only concrete, specific tasks with a clear owner or next step — NOT vague intentions
- If a category has nothing high-value, return []
- Do NOT repeat themes already covered in the previous context
- Merge similar ideas into one phrase instead of listing them separately

Previous context:
${previousContext}

Segment:
${text}

Extract strictly (hard limits — do not exceed):

topics: max 2 (specific, non-generic)
insights: max 2 (non-obvious only)
summary: 1-2 sentences
questions: max 1 (most important unanswered question only)
decisions: max 2 (explicit only)
action_items: max 2 (concrete and specific only)

Return JSON in this exact format:

{
  "topics": [],
  "insights": [],
  "summary": "",
  "questions": [],
  "decisions": [],
  "action_items": []
}
`;
  }

  /**
   * Analyze a segment using Groq directly.
   * Called by llmWorker when the router selects Groq.
   * Throws on any error — BullMQ retry handles recovery (exponential backoff).
   */
  async analyzeGroq(text, previousContext = "") {
    const prompt = this._buildAnalyzePrompt(text, previousContext);
    const raw = await this.groqChat(prompt, 0.2);
    try {
      return this.parseJsonText(raw);
    } catch (error) {
      console.error("Failed to parse Groq response:", raw);
      throw new Error(`Groq JSON parse failed: ${error.message}`);
    }
  }

  /**
   * Analyze a segment using Gemini directly.
   * Called by llmWorker when the router selects Gemini.
   * Throws on any error — BullMQ retry handles recovery (exponential backoff).
   */
  async analyzeGemini(text, previousContext = "") {
    const prompt = this._buildAnalyzePrompt(text, previousContext);
    const raw = await geminiGenerate(prompt);
    try {
      return this.parseJsonText(raw);
    } catch (error) {
      console.error("Failed to parse Gemini response:", raw);
      throw new Error(`Gemini JSON parse failed: ${error.message}`);
    }
  }

  /**
   * Analyze a segment with automatic Groq→Gemini fallback and retry logic.
   * @deprecated For new code use analyzeGroq()/analyzeGemini() via llmWorker.
   * Kept for backward compatibility (globalContextWorker merge calls).
   */
  async analyze(text, previousContext = "") {
    const prompt = this._buildAnalyzePrompt(text, previousContext);

    const raw = await callWithRetry(
      () => this.groqChat(prompt, 0.2),
      () => geminiGenerate(prompt)
    );

    try {
      return this.parseJsonText(raw);
    } catch (error) {
      console.error("Failed to parse AI response:", raw);
      throw new Error(`JSON parsing failed: ${error.message}`);
    }
  }

  /**
   * Lightweight analysis of a single transcript chunk for global context.
   * Returns: { topics, insights, summary }
   */
  async analyzeGlobal(text) {
    const prompt = `
You are an AI session analyst tasked with identifying the central themes of a transcript section.

Transcript section:
${text}

Strict quality rules:
- topics: extract the 2 most specific technical or conceptual themes discussed
  • GOOD: "database design with MongoDB", "building developer reputation on GitHub"
  • BAD: "AI", "coding", "technology", "learning", "software" (too generic — reject these)
  • Prefer named technologies, frameworks, or concrete methodologies
  • If two ideas are closely related (e.g. MongoDB + Mongoose), merge them into one phrase
- insights: only non-obvious, actionable observations — skip anything self-evident or motivational
- If a category has nothing high-value, return []

Extract (hard limits):

topics: max 2 (must be specific — if you cannot find 2 specific topics, return 1 or 0)
insights: max 2 (non-obvious only)
summary: 1-2 sentences describing the concrete subject matter

Return JSON in this exact format:

{
  "topics": [],
  "insights": [],
  "summary": ""
}
`;

    const raw = await callWithRetry(
      () => this.groqChat(prompt, 0.2),
      () => geminiGenerate(prompt)
    );

    return this.parseJsonText(raw);
  }

  /**
   * Semantic deduplication pass — merges near-duplicates and removes generic items.
   * Caps: topics→10, insights→10, questions→6, action_items→8
   * @deprecated Use deduplicateAll() to handle all categories in one LLM call.
   */
  async deduplicateItems(label, items) {
    const caps = { topics: 10, insights: 10, questions: 6, action_items: 8 };
    const max  = caps[label] ?? 10;

    if (items.length <= max) return items;

    const numbered = items.map((item, i) => `${i + 1}. ${item}`).join("\n");

    const prompt = `
You are cleaning up a "${label}" list extracted from a session transcript.

Raw list (contains duplicates, near-duplicates, and generic entries):
${numbered}

Rules:
- Merge items that mean the same thing into one concise phrase
- Remove generic or vague entries that add no specific value (e.g. "AI", "coding", "technology" alone are too vague)
- Keep only the most important and distinct items
- Hard limit: return at most ${max} items
- Shorter is better — each item should be a tight phrase

Return a JSON array only (no explanation, no markdown):
["item1", "item2", ...]
`;

    try {
      const raw = await callWithRetry(
        () => this.groqChat(prompt, 0.1),
        () => geminiGenerate(prompt)
      );
      return this.parseArrayText(raw);
    } catch {
      console.warn(`⚠️  deduplicateItems parse failed for "${label}", keeping Set-deduped version`);
      return items.slice(0, max);
    }
  }

  /**
   * Single-call semantic deduplication for all four intelligence categories.
   * Replaces four sequential deduplicateItems() calls with one LLM request.
   * Caps: topics→10, insights→10, questions→6, action_items→8
   * Only makes an LLM call if at least one category exceeds its cap.
   */
  async deduplicateAll(intelligence) {
    const caps = { topics: 10, insights: 10, questions: 6, action_items: 8 };

    const needsDedup = Object.keys(caps).some(
      k => (intelligence[k]?.length ?? 0) > caps[k]
    );

    if (!needsDedup) {
      console.log("   All categories within caps — skipping LLM dedup");
      return intelligence;
    }

    const fmt = items => items.map((item, i) => `${i + 1}. ${item}`).join("\n") || "(none)";

    const prompt = `
You are cleaning up session intelligence extracted from a meeting transcript.
Each category below may contain duplicates, near-duplicates, and generic entries.

For EVERY category apply these rules:
- Merge items that mean the same thing into one concise phrase
- Remove generic or vague entries that add no specific value (e.g. "AI", "coding", "technology" alone are too vague)
- Keep only the most important and distinct items
- Shorter is better — each item should be a tight phrase

Hard limits:
- topics: max ${caps.topics}
- insights: max ${caps.insights}
- questions: max ${caps.questions}
- action_items: max ${caps.action_items}

TOPICS (${intelligence.topics.length}):
${fmt(intelligence.topics)}

INSIGHTS (${intelligence.insights.length}):
${fmt(intelligence.insights)}

QUESTIONS (${intelligence.questions.length}):
${fmt(intelligence.questions)}

ACTION_ITEMS (${intelligence.action_items.length}):
${fmt(intelligence.action_items)}

Return JSON in this exact format (no markdown, no explanation):
{
  "topics": [],
  "insights": [],
  "questions": [],
  "action_items": []
}
`;

    try {
      const raw = await callWithRetry(
        () => this.groqChat(prompt, 0.1),
        () => geminiGenerate(prompt)
      );
      const result = this.parseJsonText(raw);
      return {
        ...intelligence,
        topics:       Array.isArray(result.topics)       ? result.topics       : intelligence.topics.slice(0, caps.topics),
        insights:     Array.isArray(result.insights)     ? result.insights     : intelligence.insights.slice(0, caps.insights),
        questions:    Array.isArray(result.questions)    ? result.questions    : intelligence.questions.slice(0, caps.questions),
        action_items: Array.isArray(result.action_items) ? result.action_items : intelligence.action_items.slice(0, caps.action_items),
      };
    } catch {
      console.warn("⚠️  deduplicateAll parse failed — falling back to per-category slice");
      return {
        ...intelligence,
        topics:       intelligence.topics.slice(0, caps.topics),
        insights:     intelligence.insights.slice(0, caps.insights),
        questions:    intelligence.questions.slice(0, caps.questions),
        action_items: intelligence.action_items.slice(0, caps.action_items),
      };
    }
  }


  /**
   * Generate a rich, structured markdown session report from session intelligence.
   *
   * The LLM groups raw topics / insights / decisions / action_items into
   * coherent thematic sections, writes short descriptive bullets under each
   * heading, and wraps everything in standard markdown so the frontend can
   * render it directly.
   *
   * @param {object} intelligence - { topics, insights, decisions, action_items, summaries, questions }
   * @returns {Promise<string|null>} Markdown string, or null on parse failure.
   */
  async generateReport(intelligence) {
    const {
      topics        = [],
      insights      = [],
      decisions     = [],
      action_items  = [],
      summaries     = [],
      questions     = []
    } = intelligence;

    const fmt = arr => arr.length
      ? arr.map((x, i) => `${i + 1}. ${x}`).join("\n")
      : "(none)";

    const prompt = `
You are an expert technical writer creating a session summary report from AI-extracted meeting intelligence.

Your job is to produce a polished, structured markdown report that is **deep and informative — never shallow**.

────────────────────────────────────────────────────────────────────
RAW SESSION INTELLIGENCE
────────────────────────────────────────────────────────────────────

SESSION SUMMARIES (ordered, one per content block):
${summaries.length ? summaries.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(none)"}

TOPICS COVERED:
${fmt(topics)}

INSIGHTS:
${fmt(insights)}

DECISIONS MADE:
${fmt(decisions)}

ACTION ITEMS:
${fmt(action_items)}

OPEN QUESTIONS:
${fmt(questions)}

────────────────────────────────────────────────────────────────────
REPORT FORMATTING INSTRUCTIONS
────────────────────────────────────────────────────────────────────

1. Start with a **Session Overview** paragraph (2–4 sentences) derived from the summaries that briefly describes what this session was about. Write it in third person ("The session covered…").

2. If there are ACTION ITEMS, add a note about them at the top right after the overview: "**Finding action items**: <one sentence explaining what action items exist or don't exist>."

3. Group the TOPICS into 3–8 logical themed sections. For each section:
   - Use a ### heading (e.g., "### File System Navigation Commands")
   - List each relevant item as a markdown bullet "- **term**: description"
   - Pull supporting detail from INSIGHTS and SUMMARIES where appropriate
   - Be specific and informative — never just repeat the topic name as the description

4. After the topic sections, add these sections only if they have content:
   - **### Key Insights** — bullet list of non-obvious insights (skip generic ones)
   - **### Decisions Made** — bullet list
   - **### Action Items** — bullet list with clear owner / next step if available
   - **### Open Questions** — bullet list

5. Formatting rules:
   - Use **bold** for key terms within bullets
   - Use \`backticks\` for command names, code, or technical identifiers
   - Do NOT use emoji in the output
   - Do NOT include a title (H1/H2 heading) at the top — start directly with the Session Overview paragraph
   - No filler phrases like "In conclusion" or "Overall"

Return ONLY the markdown — no preamble, no explanation, no code fences.
`;

    try {
      const raw = await callWithRetry(
        () => this.groqChat(prompt, 0.3),
        () => geminiGenerate(prompt)
      );
      return raw.trim();
    } catch (err) {
      console.warn("⚠️  generateReport LLM call failed:", err.message);
      return null;
    }
  }

}

export default new AIAnalysisService();