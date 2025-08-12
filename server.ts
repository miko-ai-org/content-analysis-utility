import dotenv from 'dotenv';
dotenv.config({ debug: false });
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs';
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

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
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
        const results = await analyzer.processFile('./uploads', req.file.filename);

        // Send results
        clientSocket.emit('processing-complete', results);

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json({ success: true, message: 'File processed successfully' });

    } catch (error) {
        console.error('Upload error:', error);

        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            error: error instanceof Error ? error.message : 'An error occurred during processing'
        });
    }
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