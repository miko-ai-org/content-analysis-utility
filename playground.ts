import { getPdfLineCount } from './utils';

getPdfLineCount('./a.pdf').then(t => console.log(t)).catch(e => console.error(e));