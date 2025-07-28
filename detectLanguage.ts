import { loadModule } from "cld3-asm";
import ISO6391 from 'iso-639-1';

let cldInstance: any = null;
let isInitializing = false;
let initPromise: Promise<any> | null = null;

async function initializeCLD() {
    if (cldInstance) {
        return cldInstance;
    }

    if (isInitializing && initPromise) {
        return initPromise;
    }

    isInitializing = true;
    initPromise = (async () => {
        try {
            const cldFactory = await loadModule();
            cldInstance = cldFactory.create(0, 2000); // min and max bytes
            return cldInstance;
        } finally {
            isInitializing = false;
        }
    })();

    return initPromise;
}

export async function detectLanguage(text: string) {
    try {
        const cld = await initializeCLD();
        const result = cld.findLanguage(text);
        return result;
    } catch (error) {
        console.error("Language detection failed:", error);
        // Fallback to English if detection fails
        return {
            language: 'en',
            probability: 0.5,
            is_reliable: false
        };
    }
}

export function getLanguageDisplayName(languageCode: string): string {
    if (languageCode === 'other') {
        return 'Other';
    }
    const languageName = ISO6391.getName(languageCode);
    return languageName || languageCode.charAt(0).toUpperCase() + languageCode.slice(1);
}