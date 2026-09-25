import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { HiveConfig } from '../types.js';
import { isLlmConfigured, getLlmConfig, describeLlm } from '../ai/llm.js';
import { generateDocs, listProjectFiles } from './docs-client.js';
import type { DocType } from './docs-client.js';
import { ScannerClient } from './scanner-client.js';
import { insertScanResult, getScanHistory } from '../db.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';

export function registerAIStudioRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _config: HiveConfig
): boolean {
  const pathname = url.pathname;

  // GET /api/ai-studio/config — is an LLM backend available (Settings → AI)?
  if (pathname === '/api/ai-studio/config' && req.method === 'GET') {
    const configured = isLlmConfigured();
    sendJson(res, 200, {
      configured,
      backend: getLlmConfig().backend,
      description: configured ? describeLlm() : null,
    });
    return true;
  }

  // POST /api/ai-studio/generate-docs — generate documentation
  if (pathname === '/api/ai-studio/generate-docs' && req.method === 'POST') {
    if (!isLlmConfigured()) {
      sendJson(res, 400, { error: 'No AI backend is configured. Choose one in Settings → AI.' });
      return true;
    }

    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as {
          filePaths: string[];
          docType: DocType;
          projectRoot?: string;
          additionalContext?: string;
        };

        if (!body.filePaths || !Array.isArray(body.filePaths) || body.filePaths.length === 0) {
          sendJson(res, 400, { error: 'filePaths is required and must be a non-empty array' });
          return;
        }

        if (!body.docType || !['api', 'schema', 'readme', 'onboarding'].includes(body.docType)) {
          sendJson(res, 400, { error: 'docType must be one of: api, schema, readme, onboarding' });
          return;
        }

        const result = await generateDocs({
          filePaths: body.filePaths,
          docType: body.docType,
          projectRoot: body.projectRoot,
          additionalContext: body.additionalContext,
        });

        sendJson(res, 200, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[ai-studio] Generate docs error:', msg);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // GET /api/ai-studio/project-files?root=... — list files for file picker
  if (pathname === '/api/ai-studio/project-files' && req.method === 'GET') {
    const root = url.searchParams.get('root');
    if (!root) {
      sendJson(res, 400, { error: 'root query parameter is required' });
      return true;
    }

    try {
      const resolvedRoot = path.resolve(root);
      if (!fs.existsSync(resolvedRoot)) {
        sendJson(res, 404, { error: `Directory not found: ${root}` });
        return true;
      }

      const files = listProjectFiles(resolvedRoot);
      sendJson(res, 200, { root: resolvedRoot, files });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return true;
  }

  // --- Codebase Health Scanner routes ---

  // GET /api/ai-studio/scan?projectPath=...
  if (pathname === '/api/ai-studio/scan' && req.method === 'GET') {
    const projectPath = url.searchParams.get('projectPath');
    if (!projectPath) {
      sendJson(res, 400, { error: 'Missing projectPath query parameter' });
      return true;
    }

    const client = new ScannerClient();
    (async () => {
      try {
        const result = await client.scanProject(projectPath);

        // Store the result in SQLite for trend tracking
        insertScanResult({
          projectPath: result.projectPath,
          healthScore: result.healthScore,
          todoCount: result.todoCount,
          fixmeCount: result.fixmeCount,
          totalFiles: result.totalFiles,
          totalSizeMb: result.totalSizeMb,
          outdatedDeps: result.outdatedDeps,
          resultsJson: JSON.stringify(result),
        });

        sendJson(res, 200, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // GET /api/ai-studio/scan-history?projectPath=...&limit=20
  if (pathname === '/api/ai-studio/scan-history' && req.method === 'GET') {
    const projectPath = url.searchParams.get('projectPath');
    if (!projectPath) {
      sendJson(res, 400, { error: 'Missing projectPath query parameter' });
      return true;
    }
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    try {
      const history = getScanHistory(projectPath, isNaN(limit) ? 20 : limit);
      sendJson(res, 200, { history });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return true;
  }

  return false;
}
