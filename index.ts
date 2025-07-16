import dotenv from 'dotenv';
dotenv.config({ debug: false });
import { getDurationInSecondsOfMp3File, getPdfLineCount, unzip } from './utils';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const zipFile = args[0];

let totalWatchSeconds = 0;
let totalLines = 0;

function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds.toFixed(1)} seconds`;
    } else if (seconds < 3600) {
        const minutes = seconds / 60;
        return `${minutes.toFixed(1)} minutes`;
    } else if (seconds < 86400) {
        const hours = seconds / 3600;
        return `${hours.toFixed(1)} hours`;
    } else {
        const days = seconds / 86400;
        return `${days.toFixed(1)} days`;
    }
}

async function processDirectory(dirPath: string) {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
            // Recursively process subdirectory
            await processDirectory(itemPath);
        } else if (stats.isFile()) {
            // Process file
            const fileType = item.split('.').pop();
            if (fileType === 'mp3') {
                const duration = await getDurationInSecondsOfMp3File(itemPath);
                totalWatchSeconds += duration;
            } else if (fileType === 'pdf') {
                const lines = await getPdfLineCount(itemPath);
                totalLines += lines;
            } else if (fileType === 'zip') {
                let dir = await unzip(dirPath, itemPath);
                await processDirectory(dir);
            } else {
                console.warn(`Unknown file type: ${fileType}`);
            }
        }
    }
}

async function main() {
    let dir = await unzip("", zipFile);

    await processDirectory(dir);

    console.log(`Total watch time: ${formatDuration(totalWatchSeconds)}`);
    console.log(`Total lines: ${totalLines}`);
}

main();
