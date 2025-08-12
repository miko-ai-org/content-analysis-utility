import fs from 'fs';
import { google } from 'googleapis';
import http from 'http';
import { spawn } from 'child_process';
import { OAuth2Client } from 'google-auth-library';
import path from 'path';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const TOKEN_PATH = path.resolve('token.json');
const REDIRECT_PORT = 5556;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`;


function openBrowser(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'open-browser.mjs');

        const proc = spawn('node', [scriptPath, url], {
            stdio: 'inherit',
        });

        proc.on('close', (code) => {
            code === 0 ? resolve() : reject(new Error(`open-browser exited with code ${code}`));
        });
    });
}

export async function authorizeDesktop(): Promise<OAuth2Client> {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON!);
    const { client_id, client_secret } = creds.installed;

    const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        REDIRECT_URI
    );

    if (fs.existsSync(TOKEN_PATH)) {
        oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
        return oAuth2Client;
    }

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });

    console.log('Authorize this app by visiting this URL:\n', authUrl);
    await openBrowser(authUrl); // assumes your openBrowser helper works

    const code = await new Promise<string>((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const urlObj = new URL(req.url!, REDIRECT_URI);
            const authCode = urlObj.searchParams.get('code');
            res.end('Authentication complete. You can close this window.');
            server.close();

            if (authCode) resolve(authCode);
            else reject(new Error('No authorization code in redirect URL'));
        });

        server.listen(REDIRECT_PORT, () => {
            console.log(`Listening on ${REDIRECT_URI} for OAuth redirect...`);
        });
    });

    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('Token stored to', TOKEN_PATH);

    return oAuth2Client;
}


export async function downloadDriveFileWithOAuth(fileId: string): Promise<string> {
    const auth = await authorizeDesktop();
    const drive = google.drive({ version: 'v3', auth });

    // Get metadata (name, mimeType)
    const metadata = await drive.files.get({
        fileId,
        fields: 'name',
    });

    const fileName = metadata.data.name ?? `drive-file-${fileId}`;
    const destPath = path.join("./temp", fileName);
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
