import fs from 'fs';
import { google } from 'googleapis';
import path from 'path';



export async function downloadDriveFileWithOAuth(fileId: string, accessToken: string): Promise<string> {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    // Get metadata (name, mimeType)
    const metadata = await drive.files.get({
        fileId,
        fields: 'name',
    });

    const fileName = metadata.data.name ?? `drive-file-${fileId}`;
    const destPath = path.join(process.env.DATA!, "temp", fileName);
    const dest = fs.createWriteStream(destPath);

    // Download file content
    const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
    );

    await new Promise((resolve, reject) => {
        res.data
            .on('end', resolve)
            .on('error', reject)
            .pipe(dest);
    });
    return destPath;
}
