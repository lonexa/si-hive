import { spawn } from 'node:child_process';
import { claudeExePath } from '../claude/detect.js';
import type { WorkflowDefinition, NotifyDirective } from './types.js';
import * as connectorDb from './connector-db.js';

function spawnClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let cmd = claudeExePath();
    let args = ['--dangerously-skip-permissions', '--print', '--output-format', 'text'];

    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
      args = ['/c', cmd, ...args];
      cmd = 'cmd.exe';
    } else {
      args.push(prompt);
    }

    console.log(`[workflow-ai] Spawning: ${cmd} (${args.length} args)`);

    const proc = spawn(cmd, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    if (process.platform === 'win32') {
      proc.stdin?.write(prompt);
      proc.stdin?.end();
    }

    let output = '';
    const MAX_BYTES = 2 * 1024 * 1024;
    let bytes = 0;

    const append = (chunk: Buffer) => {
      if (bytes >= MAX_BYTES) return;
      const text = chunk.toString('utf-8');
      output += text;
      bytes += text.length;
    };

    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);

    proc.on('close', (code) => {
      console.log(`[workflow-ai] Claude exited with code ${code}, output length: ${output.length}`);
      if (code === 0) resolve(output);
      else reject(new Error(`Claude exited with code ${code}: ${output.slice(0, 500)}`));
    });

    proc.on('error', reject);
  });
}

function parseJsonFromOutput<T>(output: string): T | null {
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const toParse = jsonMatch ? jsonMatch[1] : output;
  try {
    const start = toParse.indexOf('{');
    const end = toParse.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return JSON.parse(toParse.slice(start, end + 1));
    }
    return JSON.parse(toParse);
  } catch {
    return null;
  }
}

export async function generateWorkflowDefinition(description: string): Promise<{
  name: string;
  type: 'scrape' | 'browser' | 'api' | 'monitor';
  definition: WorkflowDefinition;
  summary: string;
  notify?: NotifyDirective[];
}> {
  // Fetch available connectors to inject into the prompt
  let connectorSection = '';
  try {
    const connectors = await connectorDb.listConnectors();
    if (connectors.length > 0) {
      const connectorList = connectors.map(c => `- "${c.name}" (type: ${c.type})`).join('\n');
      connectorSection = `
## Available Connectors
The user has these notification connectors configured:
${connectorList}

If the user's description mentions sending results, emailing, notifying, posting to Slack/chat, etc., include a "notify" array in your output:
{
  "notify": [
    {
      "connector": "exact connector name from list above",
      "template": "summary_table|summary_text|raw_data",
      "lookbackRuns": 5,
      "subject": "optional email subject — supports {{workflowName}} and {{date}}",
      "message": "optional preamble text"
    }
  ]
}
- Use "summary_table" for email (HTML table), "summary_text" for Slack/chat (plain text), "raw_data" for webhooks
- lookbackRuns = how many past runs of data to include (default 1, set higher if user says "last 5 days" etc.)
- If the user does NOT mention sending/notifying, do NOT include the notify array
`;
    }
  } catch {
    // If connector DB isn't available, skip the section
  }

  const prompt = `You are a workflow automation designer. The user wants to automate a task. Analyze their description and generate a workflow definition.

## User Request
${description}

## Instructions
Generate a JSON object with this exact structure:

{
  "name": "Short workflow name (max 60 chars)",
  "type": "scrape|browser|api|monitor",
  "summary": "One sentence human-readable description of what this workflow will do",
  "definition": {
    "version": 1,
    "type": "scrape|browser|api|monitor",
    "steps": [
      {
        "action": "fetch|extract|transform|assert",
        "url": "URL to fetch (for fetch action)",
        "method": "GET|POST (for fetch action, default GET)",
        "headers": {"key": "value"},
        "selector": "CSS selector or regex pattern (for extract action)",
        "regex": "regex pattern (for extract action)",
        "field": "field name to store extracted value",
        "expression": "JS expression for transform",
        "expected": "expected value for assert"
      }
    ],
    "playwrightScript": "// Page interaction code ONLY (browser, context, page, _results, _logs are already available)",
    "output": {
      "format": "text|data|screenshot|data+screenshot",
      "dataSchema": {
        "fields": [{"name": "fieldName", "type": "number|string|date", "label": "Display Label"}]
      },
      "chartConfig": {
        "type": "line|bar|area",
        "xField": "field name for x axis",
        "yFields": ["field names for y axis"]
      }
    }
  }
}

## Type Selection Guide
- "scrape": For extracting data from web pages using HTTP fetch + CSS selectors/regex. No browser needed.
- "api": For calling REST APIs and processing JSON responses.
- "browser": For complex interactions requiring a real browser (login, click, fill forms). Generate a full Playwright script.
- "monitor": For detecting CHANGES on a page. The runtime automatically compares extracted data against the previous run and reports only what's new/different. Use this when the user says "monitor", "watch for changes", "alert if different", etc. Use extract steps with regex to pull out the specific content to track (e.g., headlines, prices, status text). Always include a dataSchema so the extracted fields are stored for comparison.
${connectorSection}
## Rules
- Do NOT include a schedule, cron expression, or frequency in your output. The user sets the schedule separately.
- For "browser" type, playwrightScript must contain ONLY page interaction code.
  The variables \`browser\`, \`context\`, \`page\`, \`_results\`, \`_logs\`, and \`safeGoto\` are already created by the runtime.
  Do NOT include imports, require statements, chromium.launch(), browser.newContext(), context.newPage(), or browser.close().
  Use \`await safeGoto(url)\` instead of \`await page.goto(url)\` for navigation (it handles retries and aborted loads).
  Use _logs.push() to log messages and assign to _results for data output.
- For "scrape", "api", and "monitor" types, use steps array
- For "scrape" and "monitor" extract steps on HTML pages, you MUST use "regex" (not "selector"). CSS selectors only work on JSON responses. Use regex patterns to extract content from HTML (e.g., regex: "<title>(.*?)</title>" to get titles).
- Include dataSchema if the output contains structured data that could be charted
- Include chartConfig if the data has numeric values over time
- Return ONLY the JSON object, no other text`;

  const output = await spawnClaude(prompt);
  const result = parseJsonFromOutput<{
    name: string;
    type: 'scrape' | 'browser' | 'api' | 'monitor';
    definition: WorkflowDefinition;
    summary: string;
    notify?: NotifyDirective[];
  }>(output);

  if (!result) {
    console.error('[workflow-ai] Failed to parse workflow definition from Claude output:', output.slice(0, 1000));
    throw new Error('Failed to generate workflow definition. Claude returned unparseable output.');
  }

  // Validate type
  const validTypes = ['scrape', 'browser', 'api', 'monitor'] as const;
  if (!validTypes.includes(result.type)) {
    result.type = 'scrape';
  }

  // Ensure definition has version
  if (result.definition) {
    result.definition.version = 1;
    result.definition.type = result.type;
    // Attach notify directives to the definition (stored with the workflow)
    if (result.notify?.length) {
      result.definition.notify = result.notify;
    }
  }

  return result;
}
