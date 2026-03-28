/**
 * cleanup_sessions.js
 * Deletes ALL Session docs + their related data that have no valid SessionState,
 * or that are in a terminal "failed" / stuck state (no SessionState = upload failed).
 *
 * Run: node cleanup_sessions.js [--all] [--dry-run]
 *   --all      : delete every session (not just orphaned ones)
 *   --dry-run  : print what would be deleted without deleting
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import SessionState     from './src/models/SessionState.js';
import Session          from './src/models/Session.js';
import SessionReport    from './src/models/SessionReport.js';
import SessionContext   from './src/models/SessionContext.js';
import Transcript       from './src/models/Transcript.js';
import SegmentAnalysis  from './src/models/SegmentAnalysis.js';
import BlockAnalysis    from './src/models/BlockAnalysis.js';
import RetrievalFeedback from './src/models/RetrievalFeedback.js';
import connectDB        from './src/config/db.js';

const DRY_RUN  = process.argv.includes('--dry-run');
const DELETE_ALL = process.argv.includes('--all');

await connectDB();

const sessions = await Session.find({}).lean();
const stateMap = Object.fromEntries(
  (await SessionState.find({}).lean()).map(s => [s.mediaId, s])
);

console.log(`Found ${sessions.length} Session docs, ${Object.keys(stateMap).length} SessionState docs\n`);

let deleted = 0;
for (const s of sessions) {
  const state = stateMap[s.mediaId];
  // Orphaned = no SessionState (upload failed before state was created)
  const isOrphaned = !state;
  const isFailed   = state?.status === 'failed';
  const shouldDelete = DELETE_ALL || isOrphaned || isFailed;

  const reason = DELETE_ALL ? 'all' : isOrphaned ? 'orphaned (no state)' : isFailed ? 'failed' : 'skip';
  const tag    = shouldDelete ? '🗑️ ' : '✅ ';
  console.log(`${tag} ${s.mediaId}  status=${state?.status || 'NO STATE'}  reason=${reason}`);

  if (shouldDelete && !DRY_RUN) {
    await Promise.all([
      Session.deleteOne({ mediaId: s.mediaId }),
      SessionState.deleteOne({ mediaId: s.mediaId }),
      Transcript.deleteMany({ mediaId: s.mediaId }),
      SegmentAnalysis.deleteMany({ mediaId: s.mediaId }),
      BlockAnalysis.deleteMany({ mediaId: s.mediaId }),
      SessionContext.deleteMany({ mediaId: s.mediaId }),
      SessionReport.deleteOne({ mediaId: s.mediaId }),
      RetrievalFeedback.deleteMany({ mediaId: s.mediaId }),
    ]);
    deleted++;
    console.log(`   → deleted`);
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] No changes made. Remove --dry-run to apply.');
} else {
  console.log(`\n✅ Done. Deleted ${deleted} session(s).`);
}

mongoose.disconnect();
