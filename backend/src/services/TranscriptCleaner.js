class TranscriptCleaner {

  cleanSegments(segments) {

    const cleaned = [];

    const seen = new Set();

    for (let seg of segments) {

      let text = seg.text;

      if (!text) continue;

      // remove music/noise markers
      text = text.replace(/\[.*?\]/g, "");

      // normalize spaces
      text = text.replace(/\s+/g, " ").trim();

      const key = text.toLowerCase();

      if (seen.has(key)) continue;

      seen.add(key);

      cleaned.push({
        ...seg,
        text
      });

    }

    return cleaned;
  }

}

export default new TranscriptCleaner();