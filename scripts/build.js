#!/usr/bin/env node
'use strict';

// Regenerates content.js (Chrome/Firefox extension) and drawvinism.user.js
// (Safari/Tampermonkey-style userscript) from the single shared source of
// truth in src/drawvinism-core.js, so the two never drift out of sync again.
// Run via `npm run build`, or automatically on commit via the pre-commit
// git hook installed by scripts/install-hooks.sh.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = 'andreamalhera/drawvinism-extension';
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/main/drawvinism.user.js`;

const { version } = require(path.join(ROOT, 'version.json'));

const core = fs
    .readFileSync(path.join(ROOT, 'src', 'drawvinism-core.js'), 'utf8')
    .replace(/__VERSION__/g, version);

const contentBanner =
    '/**\n' +
    ' * DrawVinism 🧬 - Extension Content Script\n' +
    ' * Persistent, Per-File Version Control for draw.io Models\n' +
    ' */\n';

fs.writeFileSync(path.join(ROOT, 'content.js'), contentBanner + core);

// @updateURL/@downloadURL let Safari's "Userscripts" app (and any other
// GM-standard userscript manager) auto-detect and pull new versions: it
// periodically re-fetches @updateURL, compares @version, and if newer,
// downloads @downloadURL. Both require a matching @version to do anything.
const userscriptHeader =
    '// ==UserScript==\n' +
    '// @name         DrawVinism 🧬\n' +
    `// @namespace    https://github.com/${REPO}\n` +
    `// @version      ${version}\n` +
    '// @match        https://app.diagrams.net/*\n' +
    '// @match        https://*.diagrams.net/*\n' +
    '// @match        https://*.draw.io/*\n' +
    '// @run-at       document-end\n' +
    `// @updateURL    ${RAW_URL}\n` +
    `// @downloadURL  ${RAW_URL}\n` +
    '// ==/UserScript==\n\n';

fs.writeFileSync(path.join(ROOT, 'drawvinism.user.js'), userscriptHeader + core);

console.log(`Built content.js and drawvinism.user.js at version ${version}`);
