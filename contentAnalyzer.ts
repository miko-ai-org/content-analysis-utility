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
    message: string;
    currentFile?: string;
    percentage?: number;
}

export class ContentAnalyzer {
    private progressCallback?: (progress: ProgressUpdate) => void;

    constructor(progressCallback?: (progress: ProgressUpdate) => void) {
        this.progressCallback = progressCallback;
    }

    private updateProgress(message: string, currentFile?: string, percentage?: number) {
        if (this.progressCallback) {
            this.progressCallback({
                message,
                currentFile,
                percentage
            });
        }
    }

    async processFile(dirPath: string, item: string, accessToken: string): Promise<ProcessingResults> {
        // Reset state using index.ts function
        resetStats();

        this.updateProgress('Starting analysis...', item, 10);

        // Use the processFile function from index.ts
        await processFile(dirPath, item, accessToken, (fileName) =>
            this.updateProgress('Processing files...', fileName, 30)
        );

        this.updateProgress('Calculating statistics...', undefined, 60);

        // Get results using index.ts function
        const languageStats = getLanguageStats();

        // Calculate totals
        const totals = this.calculateTotals(languageStats);

        this.updateProgress('Formatting results...', undefined, 80);

        // Format results
        const formattedResults = this.formatResults(languageStats);

        this.updateProgress('Organizing files by language...', undefined, 90);

        saveFilesByLanguage();

        this.updateProgress('Processing complete!', undefined, 100);

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