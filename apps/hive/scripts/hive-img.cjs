#!/usr/bin/env node
/**
 * hive-img — render an image inline in the Hive terminal.
 *
 * Usage:
 *   hive-img <path>            # render at default size (40 cols wide)
 *   hive-img <path> --width=N  # render N columns wide
 *
 * Emits an iTerm2 inline-image OSC sequence to stdout. xterm.js's image
 * addon (loaded in every Hive terminal session) parses it and renders
 * the image inline at the cursor's current row.
 *
 * Limits:
 *   - Files larger than 8 MB are rejected (the base64 blob would balloon
 *     into the megabytes and choke the terminal).
 *   - Click-to-expand falls back to the rendered canvas snapshot since
 *     this CLI doesn't go through the path-tracking dropfile route.
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 8 * 1024 * 1024;

function die(msg, code = 1) {
  process.stderr.write(`hive-img: ${msg}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
  process.stdout.write('Usage: hive-img <path> [--width=N]\n');
  process.exit(0);
}

let target = null;
let width = 40;
for (const a of args) {
  const m = /^--width=(\d+)$/.exec(a);
  if (m) {
    width = Math.max(1, Math.min(200, parseInt(m[1], 10)));
  } else if (!a.startsWith('-')) {
    target = a;
  }
}

if (!target) die('missing file path', 2);

const abs = path.resolve(process.cwd(), target);
let stat;
try {
  stat = fs.statSync(abs);
} catch (err) {
  die(`cannot stat ${abs}: ${err.message}`, 2);
}
if (!stat.isFile()) die(`${abs} is not a regular file`, 2);
if (stat.size > MAX_BYTES) {
  die(`${abs} is ${(stat.size / 1024 / 1024).toFixed(1)} MB (limit ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB)`, 2);
}

const bytes = fs.readFileSync(abs);
const nameB64 = Buffer.from(path.basename(abs), 'utf-8').toString('base64');
const dataB64 = bytes.toString('base64');

// iTerm2 inline-image protocol. ESC ] 1337 ; File = ... ; inline=1 : <b64> BEL
process.stdout.write(
  '\x1b]1337;' +
  `File=name=${nameB64};size=${bytes.length};inline=1;width=${width};preserveAspectRatio=1:${dataB64}` +
  '\x07' +
  '\n',
);
