import * as unzipper from 'unzipper';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import pdf from 'pdf-parse';
import axios from 'axios';

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

export async function getYoutubeVideoDurationInSeconds(videoUrl: string) {
    const videoId = new URL(videoUrl).searchParams.get('v');
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.GOOGLE_API_KEY}&part=contentDetails`;

    const res = await axios.get(apiUrl);
    const duration = res.data.items[0].contentDetails.duration;

    // ISO 8601 duration -> seconds
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');

    return hours * 3600 + minutes * 60 + seconds;
}
