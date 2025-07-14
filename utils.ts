import * as unzipper from 'unzipper';
import * as fs from 'fs';
import * as path from 'path';

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