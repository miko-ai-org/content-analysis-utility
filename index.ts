import dotenv from 'dotenv';
dotenv.config({ debug: false });
import { getAllLinksFromXlsxFile, getAllLinksFromPdfFile, getDurationInSecondsOfMp3File, getPdfLineCount, unzip, getYoutubeVideoDurationInSeconds } from './utils';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const inputFile = args[0];

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

async function processFile(dirPath: string, item: string) {
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

            // Also extract and process links from PDF
            const links = await getAllLinksFromPdfFile(itemPath);
            for (const link of links) {
                await processLink(link);
            }
        } else if (fileType === 'zip') {
            let dir = await unzip(dirPath, itemPath);
            await processDirectory(dir);
        } else if (fileType === "xlsx") {
            let links = await getAllLinksFromXlsxFile(itemPath);
            for (const link of links) {
                await processLink(link);
            }
        } else {
            console.warn(`Unknown file type: ${fileType}`);
        }
    }
}

async function processDirectory(dirPath: string) {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        await processFile(dirPath, item);
    }
}

async function processLink(link: string) {
    if (link.includes("youtube.com") || link.includes("youtu.be")) {
        let duration = await getYoutubeVideoDurationInSeconds(link);
        totalWatchSeconds += duration;
    } else {
        console.warn(`Unknown link type: ${link}`);
    }
}

async function main() {
    await processFile("./", inputFile);

    console.log(`Total watch time: ${formatDuration(totalWatchSeconds)}`);
    console.log(`Total lines: ${totalLines}`);
}

main();
