import dotenv from 'dotenv';
dotenv.config({ debug: false });
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { ContentAnalyzer } from './contentAnalyzer';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let isProcessing = false;

// Utility function to create zip from languages folder
async function zipLanguagesFolder(): Promise<string> {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const zipFilePath = `./languages_${timestamp}.zip`;
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level
        });

        output.on('close', () => {
            console.log(`Created zip file: ${zipFilePath} (${archive.pointer()} total bytes)`);
            resolve(zipFilePath);
        });

        output.on('error', (err) => {
            reject(err);
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        // Check if languages folder exists
        if (fs.existsSync('./languages')) {
            archive.directory('./languages/', false);
        } else {
            // Create empty zip if no languages folder exists
            archive.append('No content found', { name: 'empty.txt' });
        }

        archive.finalize();
    });
}

app.post('/upload', upload.single('file'), async (req, res) => {
    // Ensure temp directory exists
    if (!fs.existsSync("./temp")) {
        fs.mkdirSync("./temp");
    }
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        if (isProcessing) {
            return res.status(429).json({ error: 'Server is currently processing another file. Please wait and try again.' });
        }

        isProcessing = true;

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
        const results = await analyzer.processFile('./uploads', req.file.filename);

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

    } catch (error) {
        console.error('Upload error:', error);

        res.status(500).json({
            error: error instanceof Error ? error.message : 'An error occurred during processing'
        });
    } finally {
        // Cleanup uploaded file
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
                console.log(`Cleaned up uploaded file: ${req.file.path}`);
            } catch (error) {
                console.error(`Failed to delete uploaded file ${req.file.path}:`, error);
            }
        }

        // Clean up any remaining temporary directories
        try {
            // Remove temp directory if it exists
            if (fs.existsSync("./temp")) {
                fs.rmSync("./temp", { recursive: true, force: true });
                console.log('Cleaned up ./temp directory');
            }

            // Remove languages directory if it exists
            if (fs.existsSync("./languages")) {
                fs.rmSync("./languages", { recursive: true, force: true });
                console.log('Cleaned up ./languages directory');
            }

            // Clean up uploads directory if it's empty (optional)
            const uploadsDir = './uploads';
            if (fs.existsSync(uploadsDir)) {
                fs.rmSync(uploadsDir, { recursive: true, force: true });
                console.log('Cleaned up uploads directory');
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
    const filePath = path.join(__dirname, filename);

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
            console.log(`File ${filename} downloaded successfully`);
            // Clean up the zip file after successful download
            setTimeout(() => {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log(`Cleaned up zip file: ${filePath}`);
                    }
                } catch (error) {
                    console.error(`Failed to delete zip file ${filePath}:`, error);
                }
            }, 1000); // Wait 1 second before cleanup
        }
    });
});

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