import dotenv from 'dotenv';
dotenv.config({ debug: false });
import { getAllLinksFromXlsxFile, getAllLinksFromPdfFile, getDurationInSecondsOfMp3File, getPdfLineCount, unzip, getYoutubeVideoDurationInSeconds, downloadFileFromGdrive, getDurationInSecondsOfMp4File, getPdfLanguage, getYoutubeVideoTitle, detectLanguageFromTitle } from './utils';
import { getLanguageDisplayName } from './detectLanguage';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const inputFile = args[0];

let seenLinks = new Set<string>();

let languageStats: Record<string, { watchSeconds: number; lines: number, numberOfPfs: number, numberOfVideosAudio: number }> = {};

function updateLanguageStats(language: string, watchSeconds: number = 0, lines: number = 0, numberOfPfs: number = 0, numberOfVideosAudio: number = 0) {
    if ((numberOfVideosAudio > 0 && watchSeconds === 0) || (numberOfPfs > 0 && lines === 0)) {
        return;
    }
    if (!languageStats[language]) {
        languageStats[language] = { watchSeconds: 0, lines: 0, numberOfPfs: 0, numberOfVideosAudio: 0 };
    }
    languageStats[language].watchSeconds += watchSeconds;
    languageStats[language].lines += lines;
    languageStats[language].numberOfPfs += numberOfPfs;
    languageStats[language].numberOfVideosAudio += numberOfVideosAudio;
}

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
            updateLanguageStats('en', duration, 0, 0, 1);
        } else if (fileType === 'pdf') {
            const lines = await getPdfLineCount(itemPath);
            const language = await getPdfLanguage(itemPath);
            updateLanguageStats(language, 0, lines, 1, 0);

            // Also extract and process links from PDF
            const links = await getAllLinksFromPdfFile(itemPath);
            let promises = [];
            for (const link of links) {
                promises.push(processLink(link));
            }
            await Promise.all(promises);
        } else if (fileType === 'zip') {
            let dir = await unzip(dirPath, itemPath);
            await processDirectory(dir);
        } else if (fileType === "xlsx") {
            let links = await getAllLinksFromXlsxFile(itemPath);
            let promises = [];
            for (const link of links) {
                promises.push(processLink(link));
            }
            await Promise.all(promises);
        } else if (fileType === "mp4") {
            let duration = await getDurationInSecondsOfMp4File(itemPath);
            updateLanguageStats('en', duration, 0, 0, 1);
        } else {
            console.warn(`Unknown file type: ${fileType}`);
        }
    }
}

async function processDirectory(dirPath: string) {
    const items = fs.readdirSync(dirPath);
    let promises = [];
    for (const item of items) {
        promises.push(processFile(dirPath, item));
    }
    await Promise.all(promises);
}

async function processLink(link: string) {
    if (seenLinks.has(link)) {
        return;
    }
    seenLinks.add(link);
    if (link.includes("youtube.com") || link.includes("youtu.be")) {
        let duration = await getYoutubeVideoDurationInSeconds(link);
        let title = await getYoutubeVideoTitle(link);
        let language = await detectLanguageFromTitle(title);

        updateLanguageStats(language, duration, 0, 0, 1);
    } else if (link.includes("drive.google.com")) {
        try {
            let filePath = await downloadFileFromGdrive(link);
            await processFile(path.dirname(filePath), path.basename(filePath));
        } catch (error) {
            console.error(`Failed to download file from Drive: ${link}. Error: ${(error as any).message}`);
        }
        // } else if (link.includes("vimeo.com")) {
        //     try {
        //         let duration = await getVimeoVideoDurationFromLink(link);
        //         updateLanguageStats('en', duration, 0, 0, 1);
        //     } catch (error) {
        //         console.error(`Failed to get Vimeo video duration: ${link}. Error: ${(error as any).message}`);
        //     }
    } else {
        console.warn(`Unknown link type: ${link}`);
    }
}

async function main() {
    if (!fs.existsSync("./temp")) {
        fs.mkdirSync("./temp");
    }
    await processFile("./", inputFile);
    console.log("\n------------------------\n");
    console.log('--- Language Breakdown ---');
    const sortedLanguages = Object.keys(languageStats).sort();
    for (const language of sortedLanguages) {
        const stats = languageStats[language];
        const languageDisplayName = getLanguageDisplayName(language);
        console.log(`${languageDisplayName} - Watch time: ${formatDuration(stats.watchSeconds)}, Lines: ${stats.lines}, PDFs: ${stats.numberOfPfs}, Videos/Audio: ${stats.numberOfVideosAudio}`);
    }
}

main();
