class SegmentGrouper {

  groupSegments(segments) {

    const groups = [];

    let current = null;

    const PAUSE_THRESHOLD = 2;
    const MAX_DURATION = 60; // seconds

    for (let seg of segments) {

      if (!current) {
        current = {
          start: seg.start,
          end: seg.end,
          text: seg.text
        };
        continue;
      }

      const pause = seg.start - current.end;
      const duration = current.end - current.start;

      const shouldSplit =
        pause > PAUSE_THRESHOLD ||
        duration > MAX_DURATION;

      if (shouldSplit) {

        groups.push(current);

        current = {
          start: seg.start,
          end: seg.end,
          text: seg.text
        };

      } else {

        current.text += " " + seg.text;
        current.end = seg.end;

      }

    }

    if (current) {
      groups.push(current);
    }

    return groups;

  }

}

export default new SegmentGrouper();