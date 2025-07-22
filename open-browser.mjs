// open-browser.mjs
import open from 'open';

const url = process.argv[2];
if (!url) {
    console.error('Usage: node open-browser.mjs <url>');
    process.exit(1);
}

await open(url);