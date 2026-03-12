class SpeakerSegmentationService {

  static segment(transcript) {

    const sentences = transcript
      .split(/(?<=[.?!])\s+/)
      .filter(Boolean);

    let currentSpeaker = 1;
    const averageDuration = 5; // rough estimate: 5 seconds per sentence

    // First pass: assign speakers to each sentence
    const rawSegments = sentences.map((text, index) => {

      // naive alternation for now - use dynamic IDs (speaker_001, speaker_002, etc.)
      const speakerId = `speaker_${String(currentSpeaker).padStart(3, '0')}`;

      currentSpeaker = currentSpeaker === 1 ? 2 : 1;

      return {
        speakerId,
        start: index * averageDuration,
        end: (index + 1) * averageDuration,
        text: text.trim()
      };

    });

    // Second pass: merge consecutive segments from same speaker
    const mergedSegments = [];
    let currentSegment = null;

    for (const segment of rawSegments) {
      if (!currentSegment || currentSegment.speakerId !== segment.speakerId) {
        // New speaker - save previous and start new segment
        if (currentSegment) {
          mergedSegments.push(currentSegment);
        }
        currentSegment = { ...segment };
      } else {
        // Same speaker - merge with current segment
        currentSegment.text += " " + segment.text;
        currentSegment.end = segment.end;
      }
    }

    // Add the last segment
    if (currentSegment) {
      mergedSegments.push(currentSegment);
    }

    // Third pass: add segmentId to final segments
    return mergedSegments.map((segment, index) => ({
      segmentId: index,
      speakerId: segment.speakerId,
      start: segment.start,
      end: segment.end,
      text: segment.text
    }));

  }

}

export default SpeakerSegmentationService;