import dotenv from 'dotenv';
dotenv.config({ debug: false });
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { zipLanguagesFolder } from './utils';
import { ContentAnalyzer } from './contentAnalyzer';
import crypto from 'crypto';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = process.env.DATA_DIR + 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Keep original filename with timestamp to avoid conflicts
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext);
        cb(null, `${basename}_${timestamp}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.mp3', '.mp4', '.zip', '.xlsx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${ext} not supported. Allowed types: ${allowedTypes.join(', ')}`));
        }
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let isProcessing = false;

app.post('/upload', upload.single('file'), async (req, res) => {

    let authToken = req.headers.authorization;
    if (!authToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    authToken = authToken.split(' ')[1];

    let googleAccessToken = "";

    try {
        let decoded = jwt.verify(authToken, JWT_SECRET!);
        googleAccessToken = (decoded as any).access_token;
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Ensure temp directory exists
    if (!fs.existsSync(process.env.DATA_DIR + "temp")) {
        fs.mkdirSync(process.env.DATA_DIR + "temp");
    }

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        if (isProcessing) {
            return res.status(429).json({ error: 'Server is currently processing another file. Please wait and try again.' });
        }

        isProcessing = true;

        // delete zip file starting with languages_
        const languagesZipFiles = fs.readdirSync(process.env.DATA_DIR!).filter(file => file.startsWith("languages_"));
        for (const file of languagesZipFiles) {
            fs.unlinkSync(path.join(process.env.DATA_DIR!, file));
        }

        const socketId = req.body.socketId;
        const clientSocket = io.sockets.sockets.get(socketId);

        if (!clientSocket) {
            return res.status(400).json({ error: 'Invalid socket connection' });
        }

        // Emit processing start
        clientSocket.emit('processing-start', {
            filename: req.file.originalname,
            size: req.file.size
        });

        // Create content analyzer with progress callback
        const analyzer = new ContentAnalyzer((progress) => {
            clientSocket.emit('processing-progress', progress);
        });

        // Process the uploaded file
        try {
            const results = await analyzer.processFile(process.env.DATA_DIR + 'uploads', req.file.filename, googleAccessToken);

            // Create zip file from languages folder
            const zipFilePath = await zipLanguagesFolder();
            const zipFileName = path.basename(zipFilePath);
            const zipFileSize = fs.statSync(zipFilePath).size;

            // Send results with zip file info
            clientSocket.emit('processing-complete', {
                ...results,
                zipFile: {
                    filename: zipFileName,
                    size: zipFileSize,
                    downloadUrl: `/download/${zipFileName}`
                }
            });

            res.json({
                success: true,
                message: 'File processed successfully',
                zipFile: {
                    filename: zipFileName,
                    size: zipFileSize,
                    downloadUrl: `/download/${zipFileName}`
                }
            });
        } catch (processingError) {
            console.error('Processing error:', processingError);
            // Emit error to client
            clientSocket.emit('processing-error', {
                message: processingError instanceof Error ? processingError.message : 'Processing failed'
            });

            // Also send error response
            res.status(500).json({
                error: processingError instanceof Error ? processingError.message : 'An error occurred during processing'
            });
        }

    } catch (error) {
        console.error('Pre processing error:', error);

        res.status(500).json({
            error: error instanceof Error ? error.message : 'An error occurred during pre processing'
        });
    } finally {
        // Cleanup uploaded file
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (error) {
                console.error(`Failed to delete uploaded file ${req.file.path}:`, error);
            }
        }

        // Clean up any remaining temporary directories
        try {
            // Remove temp directory if it exists
            if (fs.existsSync(process.env.DATA_DIR + "temp")) {
                fs.rmSync(process.env.DATA_DIR + "temp", { recursive: true, force: true });
            }

            // Remove languages directory if it exists
            if (fs.existsSync(process.env.DATA_DIR + "languages")) {
                fs.rmSync(process.env.DATA_DIR + "languages", { recursive: true, force: true });
            }

            // Clean up uploads directory if it's empty (optional)
            const uploadsDir = process.env.DATA_DIR + 'uploads';
            if (fs.existsSync(uploadsDir)) {
                fs.rmSync(uploadsDir, { recursive: true, force: true });
            }
        } catch (error) {
            console.error('Error during cleanup:', error);
        }

        isProcessing = false;
    }
});

// Download endpoint for zip files
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.resolve(process.env.DATA_DIR!, filename);

    // Verify file exists and is a zip file
    if (!fs.existsSync(filePath) || !filename.endsWith('.zip')) {
        return res.status(404).json({ error: 'File not found' });
    }

    // Set appropriate headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/zip');

    // Send the file
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error sending file:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error downloading file' });
            }
        } else {
            // Clean up the zip file after successful download
            setTimeout(() => {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (error) {
                    console.error(`Failed to delete zip file ${filePath}:`, error);
                }
            }, 1000); // Wait 1 second before cleanup
        }
    });
});

app.get('/auth/google', (req, res) => {
    const redirectUri = 'https://accounts.google.com/o/oauth2/v2/auth?' +
        new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            redirect_uri: process.env.API_URL + "/auth/google/callback",
            response_type: 'code',
            scope: 'email profile https://www.googleapis.com/auth/drive.readonly',
            hd: "miko.ai",
            state: crypto.randomBytes(16).toString('hex') // Add state parameter for security
        }).toString();

    res.redirect(redirectUri);
});

app.get('/auth/google/callback', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const code = req.query.code;
    const error = req.query.error;

    if (error) {
        return res.redirect(`${process.env.API_URL}/`);
    }

    try {
        // Exchange code for tokens
        const { data } = await axios.post('https://oauth2.googleapis.com/token', {
            code,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            redirect_uri: process.env.API_URL + "/auth/google/callback",
            grant_type: 'authorization_code',
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });

        const { access_token } = data;

        // Get user info
        const userInfo = await axios.get(`https://www.googleapis.com/oauth2/v3/userinfo`, {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        let googleUserId = userInfo.data.sub;

        // Create JWT token
        const token = jwt.sign(
            {
                sub: googleUserId,
                access_token
            },
            JWT_SECRET!,
            { expiresIn: '30m' }
        );

        // Redirect with the token
        res.redirect(`${process.env.API_URL}/?token=${token}`);
    } catch (err) {
        next(err);
    }
}) as express.RequestHandler);

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 500MB.' });
        }
    }
    res.status(500).json({ error: error.message || 'Server error' });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}); 