import fs from "fs";
import path from "path";

class TranscriptService {
    

    // Save transcript chunk to file system

    static saveChunk(mediaId, chunkIndex, text) {

        const dir = path.resolve(`transcripts/${mediaId}`);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const filePath = `${dir}/chunk_${chunkIndex}.txt`;

        fs.writeFileSync(filePath, text);

    }
    

    // Merge all chunk transcripts into final transcript
    
    static async merge(mediaId) {

        const dir = path.resolve(`transcripts/${mediaId}`);

        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith('chunk_') && f.endsWith('.txt'))
            .sort((a, b) => {
                const aNum = parseInt(a.match(/chunk_(\d+)/)[1]);
                const bNum = parseInt(b.match(/chunk_(\d+)/)[1]);
                return aNum - bNum;
            });

        let finalTranscript = "";

        for (const file of files) {
            const text = fs.readFileSync(`${dir}/${file}`, "utf8");
            finalTranscript += text + "\n";
        }

        const finalPath = `${dir}/final_transcript.txt`;
        fs.writeFileSync(finalPath, finalTranscript);

        console.log(`Merged ${files.length} chunks into final transcript`);

        return finalTranscript;
    }

    

    // Check if all transcript chunks are saved
    
    static isComplete(mediaId, expectedChunks) {

        const dir = path.resolve(`transcripts/${mediaId}`);

        if (!fs.existsSync(dir)) {
            console.log(`Directory not found: ${dir}`);
            return false;
        }

        const files = fs.readdirSync(dir).filter(f => f.startsWith('chunk_') && f.endsWith('.txt'));

        console.log(`isComplete check: ${files.length} files found, ${expectedChunks} expected`);

        return files.length === expectedChunks;

    }

}

export default TranscriptService;