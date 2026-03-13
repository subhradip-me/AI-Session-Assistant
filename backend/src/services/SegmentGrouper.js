class SegmentGrouper {

  // ─────────────────────────────────────────────────────────────────────────────
  // Time-based grouping: Groups segments into 90-second windows (buckets).
  // Each bucket represents a coherent time block for AI analysis.
  // ─────────────────────────────────────────────────────────────────────────────

  groupSegments(segments) {

    const WINDOW = 90; // seconds per time bucket
    const groups = {};

    // Group segments by their start time into 90-second buckets
    for (const seg of segments) {
      const bucket = Math.floor(seg.start / WINDOW);

      if (!groups[bucket]) {
        groups[bucket] = {
          start: seg.start,
          end: seg.end,
          text: seg.text
        };
      } else {
        groups[bucket].text += " " + seg.text;
        groups[bucket].end = seg.end;
      }
    }

    // Convert to array and assign segmentIds
    const result = Object.values(groups).map((g, i) => ({
      segmentId: i,
      start: g.start,
      end: g.end,
      duration: g.end - g.start,
      text: g.text
    }));

    return result;

  }

}

export default new SegmentGrouper();