import * as unzipper from 'unzipper';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import pdf from 'pdf-parse';
import axios from 'axios';
import * as xlsx from 'xlsx';
import { downloadDriveFileWithOAuth } from './driveDownloader';
import { Browser } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFString } from 'pdf-lib';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

export async function unzip(pathPrefix: string, zipFile: string): Promise<string> {
    if (pathPrefix !== "" && !pathPrefix.endsWith('/')) {
        pathPrefix = pathPrefix + '/';
    }

    const zip = await unzipper.Open.file(zipFile);
    const files = zip.files;
    const unzippedDir = pathPrefix + 'unzipped-' + (zipFile.split('/').pop()?.replace('.zip', ''));

    // Create unzipped directory if it doesn't exist
    if (!fs.existsSync(unzippedDir)) {
        fs.mkdirSync(unzippedDir);
    }

    // Extract all files
    for (const file of files) {
        // Skip directory entries (they typically end with '/')
        if (file.path.endsWith('/')) {
            continue;
        }

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

    return unzippedDir;
}

export function getDurationInSecondsOfMp3File(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
}

export function getDurationInSecondsOfMp4File(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err: Error | null, metadata: any) => {
            if (err) {
                return reject(new Error(`Failed to probe video file: ${err.message}`));
            }

            if (!metadata || !metadata.format) {
                return reject(new Error('Invalid metadata: missing format information'));
            }

            const duration = metadata.format.duration;

            if (typeof duration !== 'number' || isNaN(duration) || duration < 0) {
                return reject(new Error('Invalid duration: duration is not a valid positive number'));
            }

            resolve(duration);
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

export async function getAllLinksFromPdfFile(filePath: string): Promise<string[]> {
    const dataBuffer = fs.readFileSync(filePath);
    const links = new Set<string>();

    // --- Extract from plain text ---
    const data = await pdf(dataBuffer);
    const text = data.text;

    const urlRegex = /https?:\/\/[^\s<>"{}|\\^[\]`]+/gi;
    const textMatches = text.match(urlRegex);
    if (textMatches) {
        textMatches.forEach(link => links.add(link.trim()));
    }

    // --- Extract from annotations ---
    const pdfDoc = await PDFDocument.load(dataBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();

    for (const page of pages) {
        const annotsRef = page.node.get(PDFName.of('Annots'));
        if (!annotsRef) continue;

        const annotsObj = pdfDoc.context.lookup(annotsRef);
        if (!(annotsObj instanceof PDFArray)) continue;

        const annotsArray = annotsObj as PDFArray;
        for (const annotRef of annotsArray.asArray()) {
            const annot = pdfDoc.context.lookup(annotRef);
            if (!(annot instanceof PDFDict)) continue;

            const subtype = annot.get(PDFName.of('Subtype'));
            if (subtype?.toString() !== '/Link') continue;

            const actionRef = annot.get(PDFName.of('A'));
            if (!actionRef) continue;

            const action = pdfDoc.context.lookup(actionRef);
            if (!(action instanceof PDFDict)) continue;

            const actionType = action.get(PDFName.of('S'));
            const uri = action.get(PDFName.of('URI'));

            if (actionType?.toString() === '/URI' && uri instanceof PDFString) {
                links.add(uri.decodeText());
            }
        }
    }

    return Array.from(links);
}


export async function getYoutubeVideoDurationInSeconds(videoUrl: string) {
    if (videoUrl.includes("@")) {
        // this refers to a user channel.. so we ignore it.
        return 0;
    }

    let videoId: string | null = null;

    try {
        const url = new URL(videoUrl);

        if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') {
            // Handle youtube.com/watch?v=VIDEO_ID format
            videoId = url.searchParams.get('v');
        } else if (url.hostname === 'youtu.be') {
            // Handle youtu.be/VIDEO_ID format
            videoId = url.pathname.slice(1); // Remove the leading '/'
        }

        if (!videoId) {
            throw new Error('Could not extract video ID from URL');
        }
    } catch (error) {
        throw new Error('Invalid YouTube URL format');
    }

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

export async function getAllLinksFromXlsxFile(filePath: string) {
    let cellContent = await getAllCellContentFromXlsxFile(filePath);
    let links = new Set<string>();
    for (const sheetName of Object.keys(cellContent)) {
        for (const row of cellContent[sheetName]) {
            for (const cell of row) {
                // Check for explicit hyperlink property
                if (cell.hyperlink) {
                    links.add(cell.hyperlink);
                }

                // Check for URLs within cell text value
                if (typeof cell.value === 'string') {
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    const matches = cell.value.match(urlRegex);
                    if (matches) {
                        matches.forEach((link: string) => links.add(link));
                    }
                }
            }
        }
    }
    return Array.from(links);
}

async function getAllCellContentFromXlsxFile(filePath: string) {
    const workbook = xlsx.readFile(filePath);
    const allSheetsData: { [sheetName: string]: any[][] } = {};

    // Iterate through all sheets
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const sheetData: any[][] = [];

        // Get the range of the sheet
        const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1:A1');

        // Iterate through each row and column
        for (let row = range.s.r; row <= range.e.r; row++) {
            const rowData: any[] = [];

            for (let col = range.s.c; col <= range.e.c; col++) {
                const cellAddress = xlsx.utils.encode_cell({ r: row, c: col });
                const cell = sheet[cellAddress];

                if (cell) {
                    const cellInfo: any = {
                        value: cell.v || '', // Cell value
                        formula: cell.f || null, // Formula if any
                        type: cell.t || 'unknown' // Cell type
                    };

                    // Check for hyperlink
                    if (cell.l) {
                        cellInfo.hyperlink = cell.l.Target || cell.l;
                    }

                    rowData.push(cellInfo);
                } else {
                    // Empty cell
                    rowData.push({
                        value: '',
                        formula: null,
                        type: 'empty',
                        hyperlink: null
                    });
                }
            }

            sheetData.push(rowData);
        }

        allSheetsData[sheetName] = sheetData;
    }

    return allSheetsData;
}

export async function downloadFileFromGdrive(url: string): Promise<string> {
    const fileId = extractDriveFileId(url);
    if (!fileId) {
        throw new Error('Could not extract file ID from URL');
    }

    const filePath = await downloadDriveFileWithOAuth(fileId);
    return filePath;
}

function extractDriveFileId(link: string): string | null {
    const match = link.match(/\/d\/([a-zA-Z0-9_-]+)/) || link.match(/id=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

let browser: Browser | null = null;

let vimeoRequestQueue: string[] = [];

export async function getVimeoVideoDurationFromLink(url: string): Promise<number> {
    if (url.includes("/review/")) {
        return await getVimeoVideoDurationUsingBrowser(url);
    } else if (url.includes("folder")) {
        throw new Error("Folder links are not supported yet");
    } else {
        try {
            return await getVimeoVideoDurationOfLinkUsingAPI(url);
        } catch (error) {
            return await getVimeoVideoDurationUsingBrowser(url);
        }
    }
}

async function getVimeoVideoDurationOfLinkUsingAPI(url: string): Promise<number> {
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
    const oembedRes = await axios.get(oembedUrl, { timeout: 5000 });
    if (typeof oembedRes.data.duration === 'number') {
        return oembedRes.data.duration;
    }
    throw new Error(`Failed to get Vimeo video duration: ${url}. Error: ${(oembedRes.data as any).message}`);
}

async function getVimeoVideoDurationUsingBrowser(url: string) {
    vimeoRequestQueue.push(url);
    while (vimeoRequestQueue[0] !== url) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    try {
        return await processVimeoRequestQueue(url);
    } finally {
        vimeoRequestQueue.shift();
    }
}

async function processVimeoRequestQueue(url: string) {
    if (!browser) {
        puppeteer.use(StealthPlugin());
        browser = await puppeteer.launch({
            headless: false,
            args: ['--start-maximized'],
            defaultViewport: null,
        });
    }

    const page = await browser.newPage();
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    );

    try {
        await page.goto(url, { waitUntil: 'networkidle2' });

        let isCaptcha = await page.evaluate(() => {
            const targetText = "To continue, please confirm that you're a human (and not a spambot).";

            for (const el of Array.from(document.querySelectorAll('*'))) {
                if (el.textContent && el.textContent.includes(targetText)) {
                    return true;
                }
            }

            return false;
        });

        if (isCaptcha) {
            throw new Error(`Captcha detected for ${url}`);
        }

        let isPasswordProtected = await page.evaluate(() => {
            const targetText = "This video is password protected";

            for (const el of Array.from(document.querySelectorAll('*'))) {
                if (el.textContent && el.textContent.includes(targetText)) {
                    return true;
                }
            }

            return false;
        });

        if (isPasswordProtected) {
            throw new Error(`Password protected video detected for ${url}`);
        }

        // Wait for video metadata to load
        await page.waitForSelector('video', { timeout: 7000 });

        const duration = await page.evaluate(() => {
            return new Promise<string | null>((resolve) => {
                let div = document.querySelector('.Timecode_module_timecode__66300889');
                if (!div) {
                    return resolve(null);
                }
                let text = div.textContent;
                return resolve(text);
            });
        });

        if (!duration) {
            throw new Error(`No duration found for ${url}`);
        }

        let splitted = duration.split(':').map(Number);
        if (splitted.length === 2) {
            return splitted[0] * 60 + splitted[1];
        } else if (splitted.length === 3) {
            return splitted[0] * 3600 + splitted[1] * 60 + splitted[2];
        } else {
            throw new Error(`Invalid duration format: ${duration}`);
        }
    } catch (err) {
        throw new Error(`Failed to get duration for ${url}: ${err}`);
    } finally {
        await page.close();
    }
}