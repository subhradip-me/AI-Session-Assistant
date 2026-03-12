import SpeakerSegmentationService from "./SpeakerSegmentationService.js";
import Transcript from "../models/Transcript.js";

class SpeakerService {

  static async process(mediaId, transcript) {

    const segments = SpeakerSegmentationService.segment(transcript);

    // Save structured transcript to database
    const savedTranscript = await Transcript.create({
      mediaId,
      segments
    });

    console.log(`Structured transcript stored for ${mediaId}`);

    return {
      mediaId,
      segments
    };

  }

}

export default SpeakerService;