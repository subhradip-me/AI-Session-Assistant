import { exec } from "child_process";
import path from "path";

class WhisperService {

  static async transcribe(audioPath) {

    return new Promise((resolve, reject) => {

      const whisperPath = "D:/ai-tools/whisper.cpp/build/bin/Release/whisper-cli.exe";
      const modelPath = "D:/ai-tools/whisper.cpp/models/ggml-base.bin";

      const command = `"${whisperPath}" -m "${modelPath}" -f "${audioPath}" -nt`;

      exec(command, (error, stdout, stderr) => {

        if (error) {
          console.error("Whisper error:", error);
          return reject(error);
        }

        const transcript = stdout.trim();

        resolve(transcript);

      });

    });

  }

}

export default WhisperService;