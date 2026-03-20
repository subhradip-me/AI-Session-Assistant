import UserMemory from "../models/UserMemory.js";

/**
 * memoryService — Cross-Session Long-Term Memory Updater
 *
 * Called by insightAggregatorWorker after SESSION_INTELLIGENCE_READY.
 * Merges topics and insights from the completed session into the user's
 * persistent UserMemory document using Set-based deduplication.
 *
 * Design principles:
 *   - Idempotent: safe to call multiple times for the same session
 *   - Fail-silent: memory failure never prevents session completion
 *   - Bounded growth: hard cap at 200 topics + 200 insights to prevent noise
 */

const MAX_TOPICS   = 200;
const MAX_INSIGHTS = 200;

/**
 * Merge new session intelligence into the user's long-term memory.
 *
 * @param {string} userId        - The user who owns this session
 * @param {object} intelligence  - Final session intelligence from insightAggregatorWorker
 *                                 { topics[], insights[], decisions[], action_items[] }
 */
export async function updateMemory(userId, intelligence) {
  if (!userId) {
    console.log("⚠️  memoryService: no userId — skipping memory update");
    return;
  }

  try {
    let memory = await UserMemory.findOne({ userId });

    if (!memory) {
      memory = new UserMemory({ userId, topics: [], insights: [], sessionCount: 0 });
      console.log(`🧠 memoryService: creating new UserMemory for user ${userId}`);
    }

    const newTopics   = intelligence.topics   || [];
    const newInsights = intelligence.insights || [];

    // Merge with Set deduplication — no duplicates across sessions
    const mergedTopics = [
      ...new Set([...memory.topics, ...newTopics])
    ].slice(0, MAX_TOPICS);

    const mergedInsights = [
      ...new Set([...memory.insights, ...newInsights])
    ].slice(0, MAX_INSIGHTS);

    const addedTopics   = mergedTopics.length   - memory.topics.length;
    const addedInsights = mergedInsights.length - memory.insights.length;

    memory.topics       = mergedTopics;
    memory.insights     = mergedInsights;
    memory.sessionCount = (memory.sessionCount || 0) + 1;
    memory.lastUpdated  = new Date();

    await memory.save();

    console.log(
      `🧠 memoryService: updated memory for ${userId} — ` +
      `+${addedTopics} topics (total: ${mergedTopics.length}), ` +
      `+${addedInsights} insights (total: ${mergedInsights.length}), ` +
      `sessions: ${memory.sessionCount}`
    );
  } catch (err) {
    // Never let memory failure crash a session
    console.error(`❌ memoryService: failed to update memory for ${userId}:`, err.message);
  }
}
