import dotenv from 'dotenv';
dotenv.config({ debug: false });
import { getAllLinksFromXlsxFile, getAllLinksFromPdfFile, getDurationInSecondsOfMp3File, getPdfLineCount, unzip, getYoutubeVideoDurationInSeconds, downloadFileFromGdrive, getDurationInSecondsOfMp4File, getPdfLanguage, getYoutubeVideoTitle, detectLanguageFromTitle } from './utils';
import * as fs from 'fs';
import * as path from 'path';

let seenLinks = new Set<string>();

let languageStats: Record<string, { watchSeconds: number; lines: number, numberOfPfs: number, numberOfVideosAudio: number, files: string[] }> = {};

export function updateLanguageStats(language: string, watchSeconds: number = 0, lines: number = 0, numberOfPfs: number = 0, numberOfVideosAudio: number = 0, location: string) {
    if ((numberOfVideosAudio > 0 && watchSeconds === 0) || (numberOfPfs > 0 && lines === 0)) {
        return;
    }
    if (!languageStats[language]) {
        languageStats[language] = { watchSeconds: 0, lines: 0, numberOfPfs: 0, numberOfVideosAudio: 0, files: [] };
    }
    languageStats[language].watchSeconds += watchSeconds;
    languageStats[language].lines += lines;
    languageStats[language].numberOfPfs += numberOfPfs;
    languageStats[language].numberOfVideosAudio += numberOfVideosAudio;
    languageStats[language].files.push(location);
}

export function formatDuration(seconds: number): string {
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

export async function processFile(dirPath: string, item: string, accessToken: string, updateProgressCallback: (fileName: string) => void) {
    updateProgressCallback(item);
    const itemPath = path.join(dirPath, item);
    const stats = fs.statSync(itemPath);

    if (stats.isDirectory()) {
        // Recursively process subdirectory
        await processDirectory(itemPath, accessToken, updateProgressCallback);
    } else if (stats.isFile()) {
        // Process file
        const fileType = item.split('.').pop();
        if (fileType === 'mp3') {
            const duration = await getDurationInSecondsOfMp3File(itemPath);
            updateLanguageStats('en', duration, 0, 0, 1, itemPath);
        } else if (fileType === 'pdf') {
            const lines = await getPdfLineCount(itemPath);
            const language = await getPdfLanguage(itemPath);
            updateLanguageStats(language, 0, lines, 1, 0, itemPath);

            // Also extract and process links from PDF
            const links = await getAllLinksFromPdfFile(itemPath);
            let promises = [];
            for (const link of links) {
                promises.push(processLink(link, accessToken, updateProgressCallback));
            }
            await Promise.all(promises);
        } else if (fileType === 'zip') {
            let dir = await unzip(dirPath, itemPath);
            await processDirectory(dir, accessToken, updateProgressCallback);
        } else if (fileType === "xlsx") {
            let links = await getAllLinksFromXlsxFile(itemPath);
            let promises = [];
            for (const link of links) {
                promises.push(processLink(link, accessToken, updateProgressCallback));
            }
            await Promise.all(promises);
        } else if (fileType === "mp4") {
            let duration = await getDurationInSecondsOfMp4File(itemPath);
            updateLanguageStats('en', duration, 0, 0, 1, itemPath);
        } else {
            updateLanguageStats('other', 0, 0, 0, 0, itemPath);
        }
    }
}

export async function processDirectory(dirPath: string, accessToken: string, updateProgressCallback: (fileName: string) => void) {
    const items = fs.readdirSync(dirPath);
    let promises = [];
    for (const item of items) {
        promises.push(processFile(dirPath, item, accessToken, updateProgressCallback));
    }
    await Promise.all(promises);
}

export async function processLink(link: string, accessToken: string, updateProgressCallback: (fileName: string) => void) {
    if (seenLinks.has(link)) {
        return;
    }
    seenLinks.add(link);
    if (link.includes("youtube.com") || link.includes("youtu.be")) {
        let duration = await getYoutubeVideoDurationInSeconds(link);
        let title = await getYoutubeVideoTitle(link);
        let language = await detectLanguageFromTitle(title);

        updateLanguageStats(language, duration, 0, 0, 1, link);
    } else if (link.includes("drive.google.com")) {
        try {
            let filePath = await downloadFileFromGdrive(link, accessToken);
            await processFile(path.dirname(filePath), path.basename(filePath), accessToken, updateProgressCallback);
        } catch (error) {
            console.error(`Failed to download file from Drive: ${link}. Error: ${(error as any).message}`);
        }
        // } else if (link.includes("vimeo.com")) {
        //     try {
        //         let duration = await getVimeoVideoDurationFromLink(link);
        //         updateLanguageStats('en', duration, 0, 0, 1, link);
        //     } catch (error) {
        //         console.error(`Failed to get Vimeo video duration: ${link}. Error: ${(error as any).message}`);
        //     }
    } else {
        updateLanguageStats('other', 0, 0, 0, 0, link);
    }
}

export function resetStats() {
    seenLinks.clear();
    languageStats = {};
}

export function getLanguageStats() {
    return { ...languageStats };
}

export function isLink(file: string) {
    return file.startsWith("https://") || file.startsWith("http://");
}

export function saveFilesByLanguage() {
    const sortedLanguages = Object.keys(languageStats).sort();
    for (const language of sortedLanguages) {
        let files = languageStats[language].files;
        let allLinks = [];
        for (const file of files) {
            if (isLink(file)) {
                allLinks.push(file);
            } else {
                const relativePath = path.relative("./", file);
                const languageDir = path.join(process.env.DATA!, "languages", language);
                const targetDir = path.join(languageDir, path.dirname(relativePath));
                const targetPath = path.join(languageDir, relativePath);

                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                fs.copyFileSync(file, targetPath);
            }
        }
        if (allLinks.length > 0) {
            const languageDir = path.join(process.env.DATA!, "languages", language);
            const linksFilePath = path.join(languageDir, "links.txt");
            if (!fs.existsSync(languageDir)) {
                fs.mkdirSync(languageDir, { recursive: true });
            }
            fs.writeFileSync(linksFilePath, allLinks.join("\n"), "utf-8");
        }
    }
}