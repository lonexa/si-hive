import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkflowDefinition, WorkflowStep } from './types.js';
import { getCredential } from './workflow-db.js';
import { decrypt } from './workflow-crypto.js';

const TIMEOUT_MS = 120_000; // 2 minutes

export interface ExecutionResult {
  output: string;
  dataJson: string | null;
  changesJson: string | null;
  screenshotPath: string | null;
  errorMessage: string | null;
}

export async function executeWorkflow(definition: WorkflowDefinition, workflowId?: number): Promise<ExecutionResult> {
  switch (definition.type) {
    case 'scrape':
      return executeScrape(definition);
    case 'api':
      return executeApi(definition);
    case 'browser':
      return executeBrowser(definition);
    case 'monitor':
      return executeMonitor(definition, workflowId);
    case 'action':
      return executeAction(definition, workflowId);
    default:
      return { output: `Unknown workflow type: ${definition.type}`, dataJson: null, changesJson: null, screenshotPath: null, errorMessage: `Unknown type` };
  }
}

// --- Action (built-in Hive operation) ---
async function executeAction(def: WorkflowDefinition, workflowId?: number): Promise<ExecutionResult> {
  const kind = def.action?.kind;
  if (!kind) {
    return { output: '', dataJson: null, changesJson: null, screenshotPath: null, errorMessage: 'No action kind defined' };
  }
  const { BUILTIN_ACTIONS } = await import('./actions/index.js');
  const action = BUILTIN_ACTIONS[kind];
  if (!action) {
    return { output: '', dataJson: null, changesJson: null, screenshotPath: null, errorMessage: `Unknown action: ${kind}` };
  }
  try {
    const result = await action.run({ workflowId: workflowId ?? 0 });
    return {
      output: result.output,
      dataJson: result.dataJson ?? null,
      changesJson: null,
      screenshotPath: null,
      errorMessage: result.errorMessage ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: msg, dataJson: null, changesJson: null, screenshotPath: null, errorMessage: msg };
  }
}

// --- Scrape ---
async function executeScrape(def: WorkflowDefinition): Promise<ExecutionResult> {
  const steps = def.steps || [];
  const context: Record<string, unknown> = {};
  const logs: string[] = [];

  for (const step of steps) {
    try {
      await executeStep(step, context, logs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`[ERROR] Step ${step.action} failed: ${msg}`);
      return { output: logs.join('\n'), dataJson: null, changesJson: null, screenshotPath: null, errorMessage: msg };
    }
  }

  const dataJson = def.output?.dataSchema ? JSON.stringify(context) : null;
  return { output: logs.join('\n'), dataJson, changesJson: null, screenshotPath: null, errorMessage: null };
}

// --- API ---
async function executeApi(def: WorkflowDefinition): Promise<ExecutionResult> {
  // Same as scrape — steps-based
  return executeScrape(def);
}

// --- Browser ---
async function executeBrowser(def: WorkflowDefinition): Promise<ExecutionResult> {
  if (!def.playwrightScript) {
    return { output: 'No Playwright script defined', dataJson: null, changesJson: null, screenshotPath: null, errorMessage: 'Missing playwrightScript' };
  }

  // Sanitize: strip any import/require/launch/close lines the AI may have generated.
  // The wrapper already provides browser, context, page, _results, _logs.
  let script = def.playwrightScript
    .replace(/^\s*(import\s+.*from\s+['"]playwright.*['"];?\s*)$/gm, '// (import removed — provided by wrapper)')
    .replace(/^\s*(const|let|var)\s+\{?\s*chromium\s*\}?\s*=\s*require\(.*\);?\s*$/gm, '// (require removed)')
    .replace(/^\s*(const|let|var)\s+browser\s*=\s*await\s+chromium\.(launch|connect).*$/gm, '// (launch removed — browser provided)')
    .replace(/^\s*(const|let|var)\s+context\s*=\s*await\s+browser\.newContext.*$/gm, '// (context removed — provided)')
    .replace(/^\s*(const|let|var)\s+page\s*=\s*await\s+(context|browser)\.newPage.*$/gm, '// (page removed — provided)')
    .replace(/^\s*await\s+browser\.close\(\).*$/gm, '// (close removed — handled by wrapper)')
    .replace(/^\s*await\s+context\.close\(\).*$/gm, '// (close removed — handled by wrapper)');

  if (def.credentialId) {
    try {
      const cred = await getCredential(def.credentialId);
      if (cred) {
        const password = decrypt(cred.passwordEnc);
        script = script.replace(/\{\{USERNAME\}\}/g, cred.username);
        script = script.replace(/\{\{PASSWORD\}\}/g, password);
      }
    } catch (err) {
      console.error('[workflow-engine] Failed to resolve credentials:', err);
    }
  }

  // Write script inside project root so ESM can resolve node_modules
  const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..');
  const tmpDir = path.join(projectRoot, '.hive-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const scriptPath = path.join(tmpDir, `workflow-${Date.now()}.mjs`);

  // Wrap script — uses Playwright's bundled Chromium (npx playwright install chromium)
  const wrappedScript = `
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);

// Catch unhandled rejections so the process doesn't crash silently
process.on('unhandledRejection', (err) => {
  console.log(JSON.stringify({ data: {}, logs: ['[ERROR] Unhandled: ' + (err instanceof Error ? err.message : String(err))] }));
  process.exit(0);
});

// Find Playwright's bundled Chromium (playwright-core doesn't auto-detect it)
function findBundledChromium() {
  const dirs = [
    'C:\\\\Windows\\\\system32\\\\config\\\\systemprofile\\\\AppData\\\\Local\\\\ms-playwright',
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
  ];
  for (const base of dirs) {
    try {
      if (!fs.existsSync(base)) continue;
      const entries = fs.readdirSync(base).filter(e => e.startsWith('chromium-')).sort().reverse();
      for (const entry of entries) {
        const exe = path.join(base, entry, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(exe)) return exe;
      }
    } catch {}
  }
  return null;
}

async function run() {
  const executablePath = findBundledChromium();
  if (!executablePath) {
    console.log(JSON.stringify({ data: {}, logs: ['[ERROR] Playwright Chromium not found. Run: npx playwright install chromium'] }));
    return;
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  let _results = {};
  let _logs = [];

  // Helper: navigate with retry on ERR_ABORTED
  async function safeGoto(url, opts = {}) {
    try {
      return await page.goto(url, { waitUntil: 'commit', ...opts });
    } catch (err) {
      if (err.message && err.message.includes('ERR_ABORTED')) {
        _logs.push('[WARN] Navigation aborted, waiting and retrying...');
        await new Promise(r => setTimeout(r, 3000));
        try {
          return await page.goto(url, { waitUntil: 'load', timeout: 60000, ...opts });
        } catch {
          _logs.push('[WARN] Retry failed, continuing with current page state...');
          return null;
        }
      }
      throw err;
    }
  }

  try {
    ${script}
  } catch (err) {
    _logs.push('[ERROR] ' + (err instanceof Error ? err.message : String(err)));
  }

  // Always try to clean up
  try { await context.close(); } catch {}
  try { await browser.close(); } catch {}

  console.log(JSON.stringify({ data: _results, logs: _logs }));
}

run().catch(err => {
  console.log(JSON.stringify({ data: {}, logs: ['[ERROR] ' + (err instanceof Error ? err.message : String(err))] }));
  process.exit(0);
});
`;

  fs.writeFileSync(scriptPath, wrappedScript, 'utf-8');

  return new Promise((resolve) => {
    const proc = spawn('node', [scriptPath], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      // Clean up temp file
      try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }

      if (code !== 0) {
        resolve({
          output: stdout + '\n' + stderr,
          dataJson: null,
          changesJson: null,
          screenshotPath: null,
          errorMessage: `Script exited with code ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
        resolve({
          output: (result.logs || []).join('\n') || stdout,
          dataJson: result.data && Object.keys(result.data).length > 0 ? JSON.stringify(result.data) : null,
          changesJson: null,
          screenshotPath: null,
          errorMessage: null,
        });
      } catch {
        resolve({
          output: stdout,
          dataJson: null,
          changesJson: null,
          screenshotPath: null,
          errorMessage: null,
        });
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
      resolve({
        output: err.message,
        dataJson: null,
        changesJson: null,
        screenshotPath: null,
        errorMessage: err.message,
      });
    });
  });
}

// --- Monitor (with change detection) ---
async function executeMonitor(def: WorkflowDefinition, workflowId?: number): Promise<ExecutionResult> {
  const steps = def.steps || [];
  if (steps.length === 0) {
    return { output: 'No steps defined for monitor', dataJson: null, changesJson: null, screenshotPath: null, errorMessage: 'No steps' };
  }

  const fetchStep = steps.find(s => s.action === 'fetch');
  if (!fetchStep?.url) {
    return { output: 'No fetch URL defined', dataJson: null, changesJson: null, screenshotPath: null, errorMessage: 'No URL' };
  }

  try {
    const response = await fetch(fetchStep.url, {
      method: fetchStep.method || 'GET',
      headers: fetchStep.headers || {},
    });
    const text = await response.text();
    const logs: string[] = [`Fetched ${fetchStep.url} - Status: ${response.status}`, `Content length: ${text.length}`];

    // Run remaining steps (extract, transform, assert)
    const context: Record<string, unknown> = { _body: text };
    for (const step of steps.slice(1)) {
      await executeStep(step, context, logs);
    }

    // Build current data snapshot (exclude internal fields)
    const currentData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (!key.startsWith('_')) currentData[key] = value;
    }

    // Change detection: compare with previous run
    let changes: Record<string, unknown> | null = null;
    let changeCount = 0;
    let isFirstRun = true;

    if (workflowId) {
      try {
        const { getWorkflowRunDataRecent } = await import('./workflow-db.js');
        const previousRuns = await getWorkflowRunDataRecent(workflowId, 1);
        if (previousRuns.length > 0) {
          isFirstRun = false;
          const previousData: Record<string, unknown> = JSON.parse(previousRuns[previousRuns.length - 1].dataJson);
          changes = {};

          for (const [key, currentVal] of Object.entries(currentData)) {
            const prevVal = previousData[key];
            const currentStr = JSON.stringify(currentVal);
            const prevStr = JSON.stringify(prevVal);

            if (currentStr === prevStr) continue;

            // Array diff: find genuinely new items not in previous
            if (Array.isArray(currentVal) && Array.isArray(prevVal)) {
              if (typeof currentVal[0] === 'object' && currentVal[0] !== null) {
                // Array of objects: diff by first string field (URL, title, etc.) as key
                const keyField = Object.keys(currentVal[0]).find(k =>
                  typeof (currentVal[0] as Record<string, unknown>)[k] === 'string'
                ) || Object.keys(currentVal[0])[0];
                const prevKeys = new Set(prevVal.map(item =>
                  String((item as Record<string, unknown>)[keyField] ?? '')
                ));
                const newItems = currentVal.filter(item =>
                  !prevKeys.has(String((item as Record<string, unknown>)[keyField] ?? ''))
                );
                if (newItems.length > 0) {
                  changes[key] = newItems;
                  changeCount += newItems.length;
                  logs.push(`"${key}": ${newItems.length} new item(s)`);
                } else {
                  logs.push(`"${key}": items reordered/updated but no new entries`);
                }
              } else {
                // Array of primitives (strings/numbers): check if all values are numeric
                const allNumeric = currentVal.every(v => !isNaN(Number(v)));
                if (allNumeric) {
                  // Numeric arrays (scores, counts, etc.) — skip, these are volatile
                  logs.push(`"${key}": numeric values changed (ignored for change detection)`);
                } else {
                  // Non-numeric array of strings: set diff
                  const prevSet = new Set(prevVal.map(String));
                  const newItems = currentVal.filter(v => !prevSet.has(String(v)));
                  if (newItems.length > 0) {
                    changes[key] = newItems;
                    changeCount += newItems.length;
                    logs.push(`"${key}": ${newItems.length} new item(s)`);
                  } else {
                    logs.push(`"${key}": values reordered but no new entries`);
                  }
                }
              }
            }
            // String diff: find new lines
            else if (typeof currentVal === 'string' && typeof prevVal === 'string') {
              const currentLines = currentVal.split('\n').map(l => l.trim()).filter(Boolean);
              const prevLines = new Set(prevVal.split('\n').map(l => l.trim()).filter(Boolean));
              const newLines = currentLines.filter(l => !prevLines.has(l));
              if (newLines.length > 0) {
                changes[key] = newLines.join('\n');
                changeCount += newLines.length;
                logs.push(`"${key}": ${newLines.length} new line(s)`);
              }
            }
            // Other types: just flag as changed
            else {
              changes[key] = currentVal;
              changeCount++;
              logs.push(`"${key}": changed`);
            }
          }

          if (changeCount === 0) {
            logs.push('No changes detected since last run');
          } else {
            logs.push(`${changeCount} change(s) detected`);
          }
        }
      } catch (err) {
        logs.push(`Change detection skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (isFirstRun) {
      logs.push('First run - storing baseline snapshot');
    }

    // Always store full data for future comparison
    const dataJson = JSON.stringify(currentData);

    // Output shows only changes (or full data on first run / no changes)
    const outputData = isFirstRun
      ? currentData
      : (changes && changeCount > 0 ? changes : currentData);

    const outputLines = [
      ...logs,
      '',
      changeCount > 0 ? '--- Changes ---' : (isFirstRun ? '--- Baseline ---' : '--- No Changes ---'),
      ...Object.entries(outputData).map(([k, v]) =>
        `${k}: ${typeof v === 'string' ? v.slice(0, 500) : JSON.stringify(v)?.slice(0, 500)}`
      ),
    ];

    // changesJson: only the new/changed items (for notifications), null if no changes
    const changesJson = changes && changeCount > 0 ? JSON.stringify(changes) : null;

    return {
      output: outputLines.join('\n'),
      dataJson,
      changesJson,
      screenshotPath: null,
      errorMessage: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: msg, dataJson: null, changesJson: null, screenshotPath: null, errorMessage: msg };
  }
}

// --- Step Executor ---
async function executeStep(step: WorkflowStep, context: Record<string, unknown>, logs: string[]): Promise<void> {
  switch (step.action) {
    case 'fetch': {
      const response = await fetch(step.url!, {
        method: step.method || 'GET',
        headers: step.headers || {},
        body: step.body || undefined,
      });
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        context._body = await response.json();
        logs.push(`Fetched ${step.url} (JSON) — Status: ${response.status}`);
      } else {
        context._body = await response.text();
        logs.push(`Fetched ${step.url} (text, ${(context._body as string).length} chars) — Status: ${response.status}`);
      }
      break;
    }

    case 'extract': {
      const body = typeof context._body === 'string' ? context._body : JSON.stringify(context._body);
      if (step.regex) {
        const re = new RegExp(step.regex, 'g');
        const allMatches: string[][] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(body)) !== null) {
          allMatches.push([...m]);
        }

        if (allMatches.length === 0) {
          logs.push(`Regex "${step.regex}" did not match`);
        } else if (allMatches.length === 1) {
          // Single match: store as simple value
          const value = allMatches[0][1] || allMatches[0][0];
          if (step.field) context[step.field] = value;
          logs.push(`Extracted "${step.field}": ${String(value).slice(0, 100)}`);
        } else {
          // Multiple matches: store as array of values (or array of objects if multiple capture groups)
          const firstMatch = allMatches[0];
          if (firstMatch.length > 2) {
            // Multiple capture groups: store as array of objects with group indices as keys
            const items = allMatches.map(m => {
              const obj: Record<string, string> = {};
              for (let i = 1; i < m.length; i++) {
                obj[`g${i}`] = m[i] || '';
              }
              return obj;
            });
            if (step.field) context[step.field] = items;
            logs.push(`Extracted "${step.field}": ${items.length} items (${firstMatch.length - 1} groups each)`);
          } else {
            // Single capture group: store as array of strings
            const values = allMatches.map(m => m[1] || m[0]);
            if (step.field) context[step.field] = values;
            logs.push(`Extracted "${step.field}": ${values.length} items`);
          }
        }
      } else if (step.selector && typeof context._body === 'object') {
        // JSON path extraction (simple dot notation)
        const parts = step.selector.split('.');
        let val: unknown = context._body;
        for (const p of parts) {
          val = (val as Record<string, unknown>)?.[p];
        }
        if (step.field && val !== undefined) {
          context[step.field] = val;
          logs.push(`Extracted "${step.field}": ${JSON.stringify(val)}`);
        }
      }
      break;
    }

    case 'transform': {
      if (step.field && step.expression) {
        try {
          // Simple expression evaluation — supports basic math on extracted values
          const fn = new Function(...Object.keys(context), `return ${step.expression}`);
          const val = fn(...Object.values(context));
          context[step.field] = val;
          logs.push(`Transformed "${step.field}": ${val}`);
        } catch (err) {
          logs.push(`Transform error: ${err}`);
        }
      }
      break;
    }

    case 'assert': {
      if (step.field && step.expected !== undefined) {
        const actual = String(context[step.field] ?? '');
        if (actual !== step.expected) {
          throw new Error(`Assertion failed: ${step.field} = "${actual}", expected "${step.expected}"`);
        }
        logs.push(`Assert passed: ${step.field} = "${actual}"`);
      }
      break;
    }
  }
}
