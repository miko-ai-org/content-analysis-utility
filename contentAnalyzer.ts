import { processFile, resetStats, getLanguageStats, formatDuration, saveFilesByLanguage } from './index';
import { getLanguageDisplayName } from './detectLanguage';

export interface LanguageStats {
    watchSeconds: number;
    lines: number;
    numberOfPfs: number;
    numberOfVideosAudio: number;
    files: string[];
}

export interface ProcessingResults {
    languageStats: Record<string, LanguageStats>;
    totalWatchSeconds: number;
    totalLines: number;
    totalPdfs: number;
    totalVideosAudio: number;
    formattedResults: string;
}

export interface ProgressUpdate {
    type: 'file' | 'link' | 'complete';
    message: string;
    currentFile?: string;
    progress?: number;
}

export class ContentAnalyzer {
    private progressCallback?: (progress: ProgressUpdate) => void;

    constructor(progressCallback?: (progress: ProgressUpdate) => void) {
        this.progressCallback = progressCallback;
    }

    private updateProgress(type: ProgressUpdate['type'], message: string, currentFile?: string) {
        if (this.progressCallback) {
            this.progressCallback({
                type,
                message,
                currentFile,
            });
        }
    }

    async processFile(dirPath: string, item: string): Promise<ProcessingResults> {
        // Reset state using index.ts function
        resetStats();

        this.updateProgress('file', 'Processing files...', item);

        // Use the processFile function from index.ts
        await processFile(dirPath, item, (fileName) => this.updateProgress('file', 'Processing files...', fileName));

        // Get results using index.ts function
        const languageStats = getLanguageStats();

        // Calculate totals
        const totals = this.calculateTotals(languageStats);

        // Format results
        const formattedResults = this.formatResults(languageStats);

        await saveFilesByLanguage();

        this.updateProgress('complete', 'Processing complete!');

        return {
            languageStats,
            ...totals,
            formattedResults
        };
    }

    private calculateTotals(languageStats: Record<string, LanguageStats>) {
        let totalWatchSeconds = 0;
        let totalLines = 0;
        let totalPdfs = 0;
        let totalVideosAudio = 0;

        for (const stats of Object.values(languageStats)) {
            totalWatchSeconds += stats.watchSeconds;
            totalLines += stats.lines;
            totalPdfs += stats.numberOfPfs;
            totalVideosAudio += stats.numberOfVideosAudio;
        }

        return {
            totalWatchSeconds,
            totalLines,
            totalPdfs,
            totalVideosAudio
        };
    }

    private formatResults(languageStats: Record<string, LanguageStats>): string {
        const sortedLanguages = Object.keys(languageStats).sort();
        let result = "--- Language Breakdown ---\n";

        for (const language of sortedLanguages) {
            const stats = languageStats[language];
            const languageDisplayName = getLanguageDisplayName(language);
            result += `${languageDisplayName} - Watch time: ${formatDuration(stats.watchSeconds)}, Lines: ${stats.lines}, PDFs: ${stats.numberOfPfs}, Videos/Audio: ${stats.numberOfVideosAudio}\n`;
        }

        return result;
    }
}