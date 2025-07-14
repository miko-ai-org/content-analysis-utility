import { unzip } from './utils';

const args = process.argv.slice(2);
const zipFile = args[0];

async function main() {
    await unzip(zipFile);
}

main();
