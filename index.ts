import { getDurationInSecondsOfMp3File, getPdfLineCount, unzip } from './utils';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const zipFile = args[0];

let totalWatchSeconds = 0;
let totalLines = 0;

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
            } else {
                console.warn(`Unknown file type: ${fileType}`);
            }
        }
    }
}

async function main() {
    await unzip(zipFile);

    await processDirectory('./unzipped');

    console.log(`Total watch seconds: ${totalWatchSeconds}`);
    console.log(`Total lines: ${totalLines}`);
}

main();
