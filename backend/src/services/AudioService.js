import { exec } from "child_process";
import path from "path";

class AudioService {

  async extractAudio(videoPath) {

    const audioPath = videoPath.replace(/\.[^/.]+$/, ".wav");

    return new Promise((resolve, reject) => {

      const command = `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${audioPath}"`;

      exec(command, (error) => {

        if (error) {
          return reject(error);
        }

        resolve(audioPath);

      });

    });

  }

}

export default new AudioService();