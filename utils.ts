import * as unzipper from 'unzipper';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import pdf from 'pdf-parse';
import axios from 'axios';
import * as xlsx from 'xlsx';
import mime from 'mime-types';
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFString } from 'pdf-lib';

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
    const pdfDoc = await PDFDocument.load(dataBuffer);
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

    const filePath = await downloadPublicDriveFileWithExtension(fileId);
    return filePath;
}

async function getDriveFileMetadata(fileId: string) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType&key=${process.env.GOOGLE_API_KEY}`;
    const res = await axios.get(url);
    return res.data;
}

export async function downloadPublicDriveFileWithExtension(fileId: string): Promise<string> {
    const metadata = await getDriveFileMetadata(fileId);
    const extension = mime.extension(metadata.mimeType) || 'bin';
    const safeName = `file-${fileId}.${extension}`;
    const filename = safeName.includes('.') ? safeName : `${safeName}.${extension}`;
    const destPath = path.join("./temp", filename);

    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${process.env.GOOGLE_API_KEY}`;

    const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const writer = fs.createWriteStream(destPath);
    await new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', () => resolve(destPath));
        writer.on('error', reject);
    });

    return destPath;
}

function extractDriveFileId(link: string): string | null {
    const match = link.match(/\/d\/([a-zA-Z0-9_-]+)/) || link.match(/id=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}