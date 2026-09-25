#!/usr/bin/env node
/**
 * hive-chart — render an inline chart in the Hive terminal.
 *
 * Subcommands:
 *   hive-chart bar     <csv>  --x=<col>      --y=<col>     [--title=...]
 *   hive-chart line    <csv>  --x=<col>      --y=<col>     [--title=...]
 *   hive-chart pie     <csv>  --slice=<col>  --value=<col> [--title=...]
 *   hive-chart scatter <csv>  --x=<col>      --y=<col>     [--title=...]
 *
 * In place of <csv> you may pass `--json='[{"x":1,"y":2},...]'`.
 *
 * Common flags:
 *   --width=N      output PNG width  (default 800, max 1600)
 *   --height=N     output PNG height (default 480, max 1200)
 *   --title=...    chart title
 *   -h, --help     show this help
 *
 * Renders a PNG via Vega-Lite -> Vega SVG -> sharp, then emits an iTerm2
 * inline-image OSC sequence to stdout (same protocol hive-img uses, parsed
 * by xterm.js's image addon in every Hive terminal).
 *
 * Exit codes: 0 success, 2 user error, 1 unexpected failure.
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 1200;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 480;

const USAGE = `Usage:
  hive-chart bar     <csv>  --x=<col>     --y=<col>     [--title=...]
  hive-chart line    <csv>  --x=<col>     --y=<col>     [--title=...]
  hive-chart pie     <csv>  --slice=<col> --value=<col> [--title=...]
  hive-chart scatter <csv>  --x=<col>     --y=<col>     [--title=...]

Data input:
  <csv>                    path to a CSV file with header row
  --json='[{...},{...}]'   inline JSON array (alternative to CSV)

Options:
  --width=N      output PNG width  (default ${DEFAULT_WIDTH}, max ${MAX_WIDTH})
  --height=N     output PNG height (default ${DEFAULT_HEIGHT}, max ${MAX_HEIGHT})
  --title=TEXT   chart title
  -h, --help     show this help
`;

function die(msg, code = 1) {
  process.stderr.write(`hive-chart: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { kind: null, csv: null, flags: {} };
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const validKinds = new Set(['bar', 'line', 'pie', 'scatter']);
  out.kind = argv[0];
  if (!validKinds.has(out.kind)) {
    die(`unknown subcommand: ${out.kind}. Run \`hive-chart --help\``, 2);
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq === -1) {
        out.flags[a.slice(2)] = true;
      } else {
        const key = a.slice(2, eq);
        let val = a.slice(eq + 1);
        // Strip optional surrounding quotes that shells sometimes leak through.
        if (
          val.length >= 2 &&
          ((val[0] === '"' && val[val.length - 1] === '"') ||
            (val[0] === "'" && val[val.length - 1] === "'"))
        ) {
          val = val.slice(1, -1);
        }
        out.flags[key] = val;
      }
    } else if (!out.csv) {
      out.csv = a;
    } else {
      die(`unexpected positional arg: ${a}`, 2);
    }
  }
  return out;
}

function readData(csvPath, jsonFlag) {
  if (jsonFlag) {
    try {
      const parsed = JSON.parse(jsonFlag);
      if (!Array.isArray(parsed)) die('--json must be a JSON array', 2);
      if (parsed.length === 0) die('--json array is empty', 2);
      return parsed;
    } catch (err) {
      die(`bad --json: ${err.message}`, 2);
    }
  }
  if (!csvPath) {
    die('missing data: provide a CSV path or --json=<array>', 2);
  }
  const abs = path.resolve(process.cwd(), csvPath);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf-8');
  } catch (err) {
    die(`cannot read ${abs}: ${err.message}`, 2);
  }
  let parser;
  try {
    parser = require('csv-parse/sync');
  } catch {
    die("missing dep 'csv-parse'. Run `npm install` in the Hive repo root.", 1);
  }
  let rows;
  try {
    rows = parser.parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    die(`bad CSV: ${err.message}`, 2);
  }
  if (rows.length === 0) die(`${abs} has no data rows`, 2);
  // Try numeric coercion per column when every value parses as a number.
  const cols = Object.keys(rows[0]);
  for (const col of cols) {
    let allNumeric = true;
    for (const r of rows) {
      const v = r[col];
      if (v === '' || v == null) continue;
      if (Number.isNaN(Number(v))) {
        allNumeric = false;
        break;
      }
    }
    if (allNumeric) {
      for (const r of rows) {
        if (r[col] !== '' && r[col] != null) r[col] = Number(r[col]);
      }
    }
  }
  return rows;
}

function clampDim(raw, def, max, label) {
  if (raw == null || raw === true) return def;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n <= 0) die(`bad --${label}: ${raw}`, 2);
  return Math.min(max, n);
}

function buildSpec(kind, data, flags, width, height) {
  const title = flags.title || undefined;
  const config = {
    view: { stroke: null },
    axis: { labelFontSize: 11, titleFontSize: 12 },
    legend: { labelFontSize: 11, titleFontSize: 12 },
    title: { fontSize: 14, anchor: 'start' },
    font: 'Segoe UI, Helvetica, Arial, sans-serif',
  };
  const base = { $schema: 'https://vega.github.io/schema/vega-lite/v6.json', title, data: { values: data }, config };

  // Pie uses width/height; bar/line/scatter use width with band/quantitative scales.
  switch (kind) {
    case 'bar': {
      const xCol = flags.x;
      const yCol = flags.y;
      if (!xCol || !yCol) die('bar needs --x=<col> and --y=<col>', 2);
      ensureCol(data, xCol);
      ensureCol(data, yCol);
      return {
        ...base,
        width,
        height,
        mark: { type: 'bar', cornerRadiusEnd: 2 },
        encoding: {
          x: { field: xCol, type: inferType(data, xCol, 'nominal'), sort: '-y' },
          y: { field: yCol, type: inferType(data, yCol, 'quantitative') },
          tooltip: [{ field: xCol }, { field: yCol }],
        },
      };
    }
    case 'line': {
      const xCol = flags.x;
      const yCol = flags.y;
      if (!xCol || !yCol) die('line needs --x=<col> and --y=<col>', 2);
      ensureCol(data, xCol);
      ensureCol(data, yCol);
      return {
        ...base,
        width,
        height,
        mark: { type: 'line', point: true, interpolate: 'monotone' },
        encoding: {
          x: { field: xCol, type: inferType(data, xCol, 'quantitative') },
          y: { field: yCol, type: inferType(data, yCol, 'quantitative') },
          tooltip: [{ field: xCol }, { field: yCol }],
        },
      };
    }
    case 'scatter': {
      const xCol = flags.x;
      const yCol = flags.y;
      if (!xCol || !yCol) die('scatter needs --x=<col> and --y=<col>', 2);
      ensureCol(data, xCol);
      ensureCol(data, yCol);
      return {
        ...base,
        width,
        height,
        mark: { type: 'point', filled: true, size: 60 },
        encoding: {
          x: { field: xCol, type: inferType(data, xCol, 'quantitative') },
          y: { field: yCol, type: inferType(data, yCol, 'quantitative') },
          tooltip: [{ field: xCol }, { field: yCol }],
        },
      };
    }
    case 'pie': {
      const sliceCol = flags.slice;
      const valueCol = flags.value;
      if (!sliceCol || !valueCol) die('pie needs --slice=<col> and --value=<col>', 2);
      ensureCol(data, sliceCol);
      ensureCol(data, valueCol);
      const size = Math.min(width, height);
      return {
        ...base,
        width: size,
        height: size,
        mark: { type: 'arc', innerRadius: 0, padAngle: 0.01 },
        encoding: {
          theta: { field: valueCol, type: 'quantitative' },
          color: { field: sliceCol, type: 'nominal', legend: { title: sliceCol } },
          tooltip: [{ field: sliceCol }, { field: valueCol }],
        },
      };
    }
    default:
      die(`unknown chart kind: ${kind}`, 2);
  }
}

function ensureCol(data, col) {
  if (!Object.prototype.hasOwnProperty.call(data[0], col)) {
    const cols = Object.keys(data[0]).join(', ');
    die(`column '${col}' not in data. Available: ${cols}`, 2);
  }
}

function inferType(data, col, fallback) {
  let numericCount = 0;
  let total = 0;
  for (const r of data) {
    const v = r[col];
    if (v === '' || v == null) continue;
    total++;
    if (typeof v === 'number' && !Number.isNaN(v)) numericCount++;
  }
  if (total > 0 && numericCount === total) {
    return fallback === 'nominal' ? 'ordinal' : 'quantitative';
  }
  return fallback;
}

async function render(spec) {
  // vega and vega-lite are ESM-only at v6+; dynamic-import them from this CJS file.
  let vegaLite;
  let vega;
  try {
    vegaLite = await import('vega-lite');
  } catch (err) {
    die(`missing dep 'vega-lite'. Run \`npm install\` in the Hive repo root. (${err.message})`, 1);
  }
  try {
    vega = await import('vega');
  } catch (err) {
    die(`missing dep 'vega'. Run \`npm install\` in the Hive repo root. (${err.message})`, 1);
  }
  let compiled;
  try {
    compiled = vegaLite.compile(spec);
  } catch (err) {
    die(`vega-lite compile failed: ${err.message}`, 1);
  }
  const runtime = vega.parse(compiled.spec);
  const view = new vega.View(runtime, { renderer: 'none' });
  let svg;
  try {
    svg = await view.toSVG();
  } catch (err) {
    die(`vega render failed: ${err.message}`, 1);
  }
  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    die(`missing dep 'sharp'. Run \`npm install\` in the Hive repo root. (${err.message})`, 1);
  }
  let png;
  try {
    png = await sharp(Buffer.from(svg, 'utf-8'))
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    die(`SVG -> PNG conversion failed: ${err.message}`, 1);
  }
  return png;
}

function emitInlineImage(buf, name) {
  if (buf.length > MAX_BYTES) {
    die(
      `chart PNG is ${(buf.length / 1024 / 1024).toFixed(1)} MB (limit ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB) — try smaller --width / --height`,
      2,
    );
  }
  const nameB64 = Buffer.from(name, 'utf-8').toString('base64');
  const dataB64 = buf.toString('base64');
  // iTerm2 inline-image protocol. ESC ] 1337 ; File = ... ; inline=1 : <b64> BEL
  process.stdout.write(
    '\x1b]1337;' +
      `File=name=${nameB64};size=${buf.length};inline=1;preserveAspectRatio=1:${dataB64}` +
      '\x07' +
      '\n',
  );
}

(async () => {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  const width = clampDim(parsed.flags.width, DEFAULT_WIDTH, MAX_WIDTH, 'width');
  const height = clampDim(parsed.flags.height, DEFAULT_HEIGHT, MAX_HEIGHT, 'height');
  const data = readData(parsed.csv, parsed.flags.json);
  const spec = buildSpec(parsed.kind, data, parsed.flags, width, height);
  try {
    const png = await render(spec);
    emitInlineImage(png, `hive-chart-${parsed.kind}.png`);
    process.exit(0);
  } catch (err) {
    // Most error paths already called die(); catch any stray exception here.
    die(err.stack || err.message || String(err), 1);
  }
})();
