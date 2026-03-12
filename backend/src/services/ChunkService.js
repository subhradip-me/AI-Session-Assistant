import { exec } from "child_process";
import path from "path";
import fs from "fs";

class ChunkService {

  async splitAudio(audioPath) {

    const chunkDir = "uploads/chunks";

    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const outputPattern = path.join(chunkDir, "chunk_%03d.wav");

    const command =
      `ffmpeg -i "${audioPath}" -f segment -segment_time 30 -c copy "${outputPattern}"`;

    return new Promise((resolve, reject) => {

      exec(command, (error) => {

        if (error) {
          return reject(error);
        }

        console.log("Audio split into chunks");

        // Read chunk files to get count
        const chunkFiles = fs.readdirSync(chunkDir).filter(f => f.startsWith("chunk_"));

        resolve({ chunkDir, chunkFiles });

      });

    });

  }

}

export default new ChunkService();