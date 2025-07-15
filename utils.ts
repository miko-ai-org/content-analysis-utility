import * as unzipper from 'unzipper';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import pdf from 'pdf-parse';

export async function unzip(zipFile: string) {
    const zip = await unzipper.Open.file(zipFile);
    const files = zip.files;
    const unzippedDir = 'unzipped';

    // Create unzipped directory if it doesn't exist
    if (!fs.existsSync(unzippedDir)) {
        fs.mkdirSync(unzippedDir);
    }

    // Extract all files
    for (const file of files) {
        const filePath = path.join(unzippedDir, file.path);
        const fileDir = path.dirname(filePath);

        // Create nested directories if needed
        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true });
        }

        // Extract and save the file
        const content = await file.buffer();
        fs.writeFileSync(filePath, content);
    }
}

export function getDurationInSecondsOfMp3File(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
}

export async function getPdfLineCount(filePath: string) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    const text = data.text;
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    return lines.length;
}