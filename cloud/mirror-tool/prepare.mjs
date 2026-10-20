// Unmodified AGPL SingleFile tool, installed only in the capture worker.
// Corresponding source: https://github.com/gildas-lormeau/single-file-cli
import {script} from './node_modules/single-file-cli/lib/single-file-bundle.js';
import {writeFileSync} from 'node:fs';
writeFileSync(new URL('./bundle.js',import.meta.url),script);
