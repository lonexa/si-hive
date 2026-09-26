import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';

// Crash guard: background pollers and integrations can reject outside a
// request context. Log and keep the server up; failed jobs retry next tick.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] (server stays up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] (server stays up):', err);
});

import { loadConfig, saveConfig } from './config.js';
import crypto from 'node:crypto';
import { getDb, closeDb, insertEvent } from './db.js';
import { initSharedStorage } from './storage/init.js';
import { registerStorageRoutes } from './storage/routes.js';
import { registerIntegrationRoutes } from './integrations/routes.js';
import { registerLlmRoutes } from './ai/routes.js';
import { registerDeliveryRoutes } from './delivery/routes.js';
import { registerModuleRoutes } from './modules/routes.js';
import { inactiveModuleForPath } from './modules/registry.js';
import { Aggregator } from './state/aggregator.js';
import { ClaudeWatcher } from './watchers/claude-watcher.js';
import { SessionWatcher } from './watchers/session-watcher.js';
import { startUsageLogger, stopUsageLogger } from './analytics/usage-logger.js';
import { processEvent } from './hooks/event-receiver.js';
import { focusPane } from './actions/terminal.js';
import { sendInput } from './actions/send-input.js';
import { deleteTeam } from './actions/cleanup.js';
import { Notifier } from './notifications/notifier.js';
import { spawnPty, getPtySession, destroyPty, destroyAllPtys, attachWebSocket, detachWebSocket, writeToPtyBySessionId, renamePtySession, resizePty } from './terminal-pty.js';
import { decodeWindowsProjectDir } from './parsers/process-discovery-windows.js';
import { isWindows, isWindowsService } from './platform.js';
import { QueueEngine } from './queue/queue-engine.js';
import { getAllProviderStatus, getProvider, getEnabledProviders } from './providers/registry.js';
import { syncSkillToProviders, removeSkillFromProviders, syncAllSkills } from './providers/skill-sync.js';
import type { ProviderId, ProvidersConfig } from './types.js';
import { registerKBRoutes } from './kb/routes.js';
import { registerSharingRoutes } from './sharing/routes.js';
import { registerHooksRoutes } from './hooks/routes.js';
import { registerSkillRequirementsRoutes } from './skills/requirements-routes.js';
import { registerAccountRoutes } from './providers/account-routes.js';
import { registerCalendarRoutes } from './dashboard/calendar-routes.js';
import { handleGmailRoutes } from './gmail/routes.js';
import { registerReplayRoutes } from './sessions/replay-routes.js';
import { registerDropfileRoute } from './sessions/dropfile.js';
import { activityWss } from './sessions/activity-stream.js';
import { getSessionInfo, getLiveSessionHolder } from './sessions/replay-client.js';
import { encodeWindowsPath } from './parsers/process-discovery-windows.js';
import { registerScreenshotRoutes } from './sessions/screenshot-routes.js';
import { registerAnalyticsRoutes } from './analytics/analytics-routes.js';
import { registerGitRoutes } from './projects/git-routes.js';
import { registerDependencyRoutes } from './projects/dependencies-routes.js';
import { registerAIStudioRoutes } from './ai-studio/ai-studio-routes.js';
import { registerSecurityRoutes } from './security/security-routes.js';
import { registerPersonaRoutes } from './personas/routes.js';
import { registerUserManagementRoutes } from './admin/user-routes.js';
import { registerEventTrackRoutes } from './admin/event-track-routes.js';
import { registerNowRoutes } from './now/routes.js';
import { registerHandoffRoutes } from './handoff/routes.js';
import { registerSearchRoutes } from './search/routes.js';
import { registerReviewRoutes } from './reviews/routes.js';
import { checkForUpdates, applyUpdates, getChangelog } from './updater.js';
import { getServerVersion } from './server-version.js';
import { setDashboardWss } from './ws-presence.js';
// Lite-merged route handlers
import { handleTodoRoutes } from './todo/routes.js';
import { handleWorkflowRoutes } from './workflows/routes.js';
import { handleTeamRoutes } from './team/routes.js';
import { handleChatRoutes } from './chat/routes.js';
import { handleChatWsConnection } from './chat/chat-ws.js';
import { handleMessagingRoutes } from './messaging/routes.js';
import { WorkflowScheduler } from './workflows/workflow-scheduler.js';
import { syncBundledSkills } from './skills/bundled-skills.js';
// Auth
import { registerAuthRoutes } from './auth/routes.js';
import { createAuthTables, cleanExpiredSessions, migrateLiteToFull } from './auth/session-manager.js';
import { authenticate, isPublicPath } from './auth/middleware.js';
import { isAuthEnabled, getAuthSettings, localUser } from './auth/settings.js';
import { isPathInScope, hasProjectScope } from './project-scope.js';
import { computeScopedStats, scopedPlanSlugs } from './insights/scoped.js';
import type { AuthenticatedRequest } from './auth/types.js';
import { readBody as sharedReadBody, sendJson as jsonResponse } from '../../../packages/shared/src/server/http-utils.js';
import { SessionTimeTracker } from './analytics/session-time-tracker.js';
import { TurnTimeTracker } from './analytics/turn-time-tracker.js';
import { execSync } from 'node:child_process';
import { parseStopHookPayload } from './hooks/stop-hook.js';
import { registerIncognitoRoutes } from './privacy/routes.js';
import { runPendingPurges } from './privacy/purge.js';
import {
  isIncognitoSession,
  isIncognitoPath as isIncognitoProjectPath,
  isIncognitoId,
  setSessionIncognito,
  linkSession as linkIncognitoSession,
} from './privacy/incognito.js';
import { scanTranscriptForDecisions } from './hooks/decision-detector.js';
import { enableAutostart, disableAutostart, isAutostartEnabled, isAutostartSupported } from './actions/autostart.js';
import {
  upsertTaskQueue,
  getTaskQueue,
  insertQueueTask,
  getQueueTasks,
  updateQueueTask,
  reorderQueueTasks,
  deleteQueueTask,
  clearCompletedTasks,
  updateTaskQueuePaused,
  insertLiveLoop,
  getLiveLoops,
  stopLiveLoop,
} from './db.js';
import { LOOP_TEMPLATES } from './loops/templates.js';
import { Scheduler } from './schedules/scheduler.js';
import {
  getAllSchedules,
  getSchedule,
  insertSchedule,
  updateSchedule,
  deleteSchedule,
  getScheduleRuns,
  getScheduleRun,
  deleteScheduleRuns,
  getAllSessionTemplates,
  getSessionTemplate,
  insertSessionTemplate,
  updateSessionTemplate,
  deleteSessionTemplate,
  incrementTemplateUsage,
  getAllSavedPrompts,
  insertSavedPrompt,
  updateSavedPrompt,
  deleteSavedPrompt,
  incrementPromptUsage,
} from './db.js';
import type { WsMessage, WsMessageType, SendInputRequest } from './types.js';
import { hivePath } from '../../../packages/shared/src/server/paths.js';

// --- Instruction file mapping (provider-agnostic) ---
const INSTRUCTION_FILES: Record<string, { filename: string; subdir?: string; globalHome: string }> = {
  claude: { filename: 'CLAUDE.md', subdir: '.claude', globalHome: path.join(os.homedir(), '.claude') },
  gemini: { filename: 'GEMINI.md', globalHome: path.join(os.homedir(), '.gemini') },
  codex: { filename: 'AGENTS.md', globalHome: path.join(os.homedir(), '.codex') },
};

// --- Git ownership check when running as a Windows service ---
// As a service SI Hive runs as SYSTEM, so every project folder is owned by
// another account and git refuses it ("detected dubious ownership") — in AI
// sessions and in SI Hive's own git calls. Trust project folders for every
// process SI Hive launches, via git's env-based config (it counts as
// command-line config, where safe.directory is honored). Global git config is
// left untouched.
if (isWindowsService()) {
  const n = parseInt(process.env.GIT_CONFIG_COUNT || '', 10) || 0;
  process.env[`GIT_CONFIG_KEY_${n}`] = 'safe.directory';
  process.env[`GIT_CONFIG_VALUE_${n}`] = '*';
  process.env.GIT_CONFIG_COUNT = String(n + 1);
}

// --- Load config and initialize ---
const config = loadConfig();
const PORT = parseInt(process.env.HIVE_PORT || '') || config.server.port;

// Initialize DB (creates table if needed)
const db = getDb();
// Shared database (SQLite by default; Postgres / SQL Server via Settings → Storage).
await initSharedStorage();

// Initialize auth tables
createAuthTables(db);
migrateLiteToFull(db);

// Periodically clean expired auth sessions (every 30 min)
setInterval(() => {
  try { cleanExpiredSessions(db); } catch { /* ignore */ }
}, 30 * 60 * 1000);

// Install bundled skills under ~/.claude/skills/ so built-in actions that
// spawn Claude (e.g. claude-daily) can find their skill on any dev machine.
try { syncBundledSkills(); } catch (err) { console.error('[bundled-skills] Startup sync failed:', err); }

// Seed system connectors (Team Email for distribution workflows) so the
// AutomationWizard always has something to wire up.
void import('./workflows/bundled-connectors.js')
  .then(m => m.syncBundledConnectors())
  .catch(err => console.error('[bundled-connectors] Startup seed failed:', err));

// Initialize Workflow scheduler (merged from Lite)
const workflowScheduler = new WorkflowScheduler();
workflowScheduler.setConfig(config, saveConfig);
workflowScheduler.startTeamWorkflows().catch(err => console.error('[workflow-scheduler] Start failed:', err));

// Ensure {projectsRoot}/Generic exists if projectsRoot is configured
if (config.projectsRoot) {
  const genericDir = path.join(config.projectsRoot, 'Generic');
  if (!fs.existsSync(genericDir)) {
    try { fs.mkdirSync(genericDir, { recursive: true }); } catch { /* ignore */ }
  }
}

// Pre-resolve provider binary paths to warm the cache (avoids slow `where` on first launch)
for (const provider of getEnabledProviders(config)) {
  try { provider.exePath(); } catch { /* not installed */ }
}

// Create aggregator and parse initial state
const aggregator = new Aggregator(config);
aggregator.initialize();

// Create queue engine
const queueEngine = new QueueEngine(aggregator);

// Broadcast queue changes via WebSocket
queueEngine.on('queue_changed', () => {
  const queuesState = queueEngine.getQueuesState();
  aggregator.refreshQueues(queuesState);
});

queueEngine.on('queue_empty', () => {
  const queuesState = queueEngine.getQueuesState();
  aggregator.refreshQueues(queuesState);
});

// Create and start session time tracker
const timeTracker = new SessionTimeTracker();
timeTracker.start();

// Create and start hook-driven turn time tracker (UserPromptSubmit → Stop)
const turnTracker = new TurnTimeTracker();
turnTracker.start();

// Track session status changes for auto time logging
let previousSessionStatuses = new Map<string, string>();
aggregator.on('sessions_updated', () => {
  const currentSessions = aggregator.getState().sessions;
  for (const session of currentSessions) {
    const prevStatus = previousSessionStatuses.get(session.id);
    if (prevStatus !== session.status) {
      // Status changed — trigger clock-in or clock-out
      timeTracker.onSessionStatusChange(session.id, session.status, session.project ?? 'unknown');
    } else if (session.status === 'working') {
      // Session is still working — record activity so the idle timer doesn't
      // prematurely clock it out, and re-clock-in if it was idle-evicted.
      timeTracker.ensureTracking(session.id, session.project ?? 'unknown');
    }
  }
  // Update tracking map
  previousSessionStatuses = new Map(currentSessions.map(s => [s.id, s.status]));
});

// Create and start scheduler
const scheduler = new Scheduler();
scheduler.setConfig(config);
scheduler.start();

// Create and start notifier
const notifier = new Notifier(aggregator, config.notifications ?? { macOS: true, browser: true });
notifier.start();

// Broadcast notification_fired events to all WebSocket clients
notifier.on('notification_fired', (payload: { sessionId: string; suppressBrowser: boolean }) => {
  const message: WsMessage = {
    version: 1,
    type: 'notification_fired',
    payload,
  };
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
});

// Broadcast scheduler events via WebSocket (wss is defined later but hoisted via const)
scheduler.on('run_started', () => {
  aggregator.refreshSchedules();
});
scheduler.on('run_completed', () => {
  aggregator.refreshSchedules();
});

// Start file watchers
const claudeWatcher = new ClaudeWatcher(aggregator, config.claudeHome);
claudeWatcher.start();

const sessionWatcher = new SessionWatcher(aggregator, config.claudeHome, config);
sessionWatcher.start();

// Start the Claude usage logger so [Hive].[claude_usage_log] gets populated
// (powers Time Tracking, Dev Metrics, and Cost Optimizer analytics tabs).
startUsageLogger();
process.on('SIGTERM', () => { void stopUsageLogger(); });
process.on('SIGINT',  () => { void stopUsageLogger(); });

// A project marked incognito while off-VPN couldn't delete what it had
// already logged to shared SQL. Retry it now that we're up.
setTimeout(() => {
  void runPendingPurges().catch((err) => {
    console.warn('[incognito] Pending purge retry failed:', err instanceof Error ? err.message : err);
  });
}, 15_000).unref?.();

// Track last event timestamp for health endpoint
let lastEventTimestamp: string | null = null;
const serverStartTime = new Date().toISOString();

// Allowlist of (method, path-pattern) pairs that produce an audit_log row.
// Anything not on this list is considered routine traffic and skipped.
const AUDITABLE_ACTIONS: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  // Auth & identity
  { method: 'POST',   pattern: /^\/api\/auth\/role-override$/ },
  { method: 'POST',   pattern: /^\/api\/auth\/logout$/ },
  { method: 'PATCH',  pattern: /^\/api\/auth\/users\/[^/]+\/role$/ },

  // Admin user management
  { method: 'POST',   pattern: /^\/api\/admin\/users\/[^/]+\/force-update$/ },
  { method: 'PATCH',  pattern: /^\/api\/admin\/users\/[^/]+\/role$/ },
  { method: 'DELETE', pattern: /^\/api\/admin\/users\/[^/]+\/role-override$/ },
  { method: 'POST',   pattern: /^\/api\/admin\/users\/[^/]+\/overrides$/ },
  { method: 'DELETE', pattern: /^\/api\/admin\/users\/[^/]+\/overrides\/[^/]+$/ },

  // Permissions & config
  { method: 'PATCH',  pattern: /^\/api\/permissions$/ },
  { method: 'PATCH',  pattern: /^\/api\/permissions\/projects\/[^/]+$/ },
  { method: 'PATCH',  pattern: /^\/api\/config$/ },

  // System control
  { method: 'POST',   pattern: /^\/api\/server\/restart$/ },
  { method: 'POST',   pattern: /^\/api\/updates\/apply$/ },
  { method: 'POST',   pattern: /^\/api\/system\/autostart$/ },
  { method: 'DELETE', pattern: /^\/api\/system\/autostart$/ },

  // Install actions (community packages)
  { method: 'POST',   pattern: /^\/api\/agents\/install$/ },
  { method: 'POST',   pattern: /^\/api\/skills\/install$/ },
  { method: 'PATCH',  pattern: /^\/api\/plugins\/[^/]+\/toggle$/ },
];

function isAuditableAction(method: string, pathname: string): boolean {
  return AUDITABLE_ACTIONS.some(a => a.method === method && a.pattern.test(pathname));
}

// --- Request origin checks ---
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Extra host names this server answers to (comma-separated HIVE_ALLOWED_HOSTS, e.g. a LAN name). */
function extraAllowedHosts(): string[] {
  return (process.env.HIVE_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function hostnameOf(hostHeader: string): string {
  // Strip the port: "localhost:4747" → "localhost", "[::1]:4747" → "[::1]"
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hostHeader.trim().toLowerCase());
  return m ? m[1] : hostHeader.toLowerCase();
}

/** Guards against DNS rebinding: only answer to our own host names. */
function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true; // HTTP/1.0 clients; nothing to rebind
  const name = hostnameOf(hostHeader);
  if (LOOPBACK_HOSTNAMES.has(name)) return true;
  // When exposed on the network (login enabled / HIVE_HOST), any host name is
  // allowed unless an explicit allowlist is configured.
  const extra = extraAllowedHosts();
  if (extra.length > 0) return extra.includes(name);
  return HOSTS.some((h) => h !== '127.0.0.1');
}

/** Same-origin, or a local dev frontend on another localhost port. */
function isAllowedOrigin(origin: string, hostHeader: string | undefined): boolean {
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  if (hostHeader && o.host.toLowerCase() === hostHeader.toLowerCase()) return true;
  return o.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(o.hostname.toLowerCase());
}

// --- HTTP Server ---
const requestListener: http.RequestListener = (req, res) => { void handleRequest(req, res); };
const server = http.createServer(requestListener);

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  // Cross-site protection. Browsers let any web page send requests to
  // localhost, so reject requests whose Host (DNS rebinding) or Origin (CSRF)
  // doesn't belong to this server. CLI clients (hooks, curl) send no Origin.
  if (!isAllowedHost(req.headers.host)) {
    res.writeHead(421, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Host not allowed' }));
    return;
  }
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin, req.headers.host)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Cross-origin request blocked' }));
    return;
  }
  // A local dev frontend (Vite on another localhost port) needs CORS headers.
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // --- Audit logging for security-meaningful actions ---
  // Allowlist of mutating routes worth recording: role/permission changes, admin
  // user-management actions, config edits, system control, and sensitive data ops.
  // Routine telemetry (heartbeat, events/track, hooks) is intentionally excluded.
  if (req.method && url.pathname.startsWith('/api/') && isAuditableAction(req.method, url.pathname)) {
    // Fire-and-forget audit logging (don't block the response)
    import('./security/audit-client.js').then(({ AuditClient }) => {
      const client = new AuditClient();
      client.logAction(
        `${req.method} ${url.pathname}`,
        url.pathname.split('/')[2] || 'api',
        url.pathname,
        null,
        process.env.HIVE_SERVICE_USER || path.basename(process.env.USERPROFILE || '') || os.userInfo().username,
      ).catch(() => {}).finally(() => client.close().catch(() => {}));
    }).catch(() => {});
  }

  // --- Auth middleware — always try to authenticate (populates req.user if valid session) ---
  if (isAuthEnabled(config)) {
    authenticate(req as AuthenticatedRequest, db, getAuthSettings(config).roleOverride);
  } else {
    // Login off: every request acts as this machine's local user (admin).
    (req as AuthenticatedRequest).user = localUser(config);
  }
  // Arm the user's personal workflows on first authenticated request
  const userOid = (req as AuthenticatedRequest).user?.oid;
  if (userOid) workflowScheduler.armPersonalWorkflows(userOid).catch(() => {});

  // --- Auth routes ---
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/auth/')) {
    if (registerAuthRoutes(url, req as AuthenticatedRequest, res, db, config, saveConfig)) return;
  }

  // --- Enforce auth on non-public API routes ---
  if (isAuthEnabled(config) && !isPublicPath(url.pathname, req.socket.remoteAddress) && url.pathname.startsWith('/api/')) {
    if (!(req as AuthenticatedRequest).user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }
  }

  // --- API Routes ---
  if (url.pathname === '/api/state' && req.method === 'GET') {
    handleGetState(res);
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'POST') {
    handlePostEvent(req, res);
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    handleGetEvents(res);
    return;
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    handleHealth(res);
    return;
  }

  // Serve a local file for preview (images, etc.) — used by ArtifactsPanel
  if (url.pathname === '/api/file-preview' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.bmp': 'image/bmp', '.csv': 'text/csv', '.txt': 'text/plain',
      '.json': 'application/json', '.pdf': 'application/pdf',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Open a file's folder in the OS file explorer
  if (url.pathname === '/api/open-path' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (filePath && fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      // execFile (no shell) so a crafted file name can't inject commands.
      import('child_process').then(({ execFile }) => {
        if (process.platform === 'win32') execFile('explorer', [`/select,${filePath}`]);
        else if (process.platform === 'darwin') execFile('open', ['-R', filePath]);
        else execFile('xdg-open', [dir]);
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // Client-side error reports (ErrorBoundary, window.onerror). Logged locally.
  if (url.pathname === '/api/errors/report' && req.method === 'POST') {
    sharedReadBody(req).then((raw) => {
      try {
        const e = JSON.parse(raw) as { message?: string; route?: string; stack?: string };
        console.error(`[client-error] ${e.route ?? ''} ${e.message ?? ''}${e.stack ? `\n${e.stack}` : ''}`);
      } catch { /* ignore malformed reports */ }
      jsonResponse(res, 204, {});
    }).catch(() => jsonResponse(res, 204, {}));
    return;
  }

  if (url.pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: getServerVersion() }));
    return;
  }

  if (url.pathname === '/api/actions/focus-session' && req.method === 'POST') {
    handleFocusSession(req, res);
    return;
  }

  if (url.pathname === '/api/actions/send-input' && req.method === 'POST') {
    handleSendInput(req, res);
    return;
  }

  // --- First-run setup wizard ---
  if (url.pathname === '/api/setup' && req.method === 'GET') {
    jsonResponse(res, 200, {
      completed: !!config.setupCompletedAt,
      projectsRoot: config.projectsRoot,
      providers: getAllProviderStatus(config),
      primary: config.aiProviders?.primary ?? 'claude',
    });
    return;
  }
  if (url.pathname === '/api/setup' && req.method === 'POST') {
    if (isAuthEnabled(config) && (req as AuthenticatedRequest).user?.role !== 'admin') {
      jsonResponse(res, 403, { error: 'Admin access required' });
      return;
    }
    sharedReadBody(req).then((raw) => {
      const b = JSON.parse(raw || '{}') as { projectsRoot?: string; primary?: ProviderId; complete?: boolean };
      if (typeof b.projectsRoot === 'string') config.projectsRoot = b.projectsRoot.trim();
      if (typeof b.projectsRoot === 'string') aggregator.refreshSessions();
      if (b.primary && ['claude', 'gemini', 'codex'].includes(b.primary)) {
        const ap = (config.aiProviders ??= { primary: 'claude', providers: {} });
        ap.primary = b.primary;
        ap.providers[b.primary] = { ...(ap.providers[b.primary] ?? {}), enabled: true };
      }
      if (b.complete) config.setupCompletedAt = new Date().toISOString();
      saveConfig(config);
      jsonResponse(res, 200, { ok: true, completed: !!config.setupCompletedAt });
    }).catch((err) => jsonResponse(res, 400, { error: (err as Error).message }));
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    handleGetConfig(res);
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'PATCH') {
    handlePatchConfig(req, res);
    return;
  }

  // --- Provider test endpoint ---
  const providerTestMatch = url.pathname.match(/^\/api\/providers\/([a-z]+)\/test$/);
  if (providerTestMatch && req.method === 'POST') {
    const providerId = providerTestMatch[1] as ProviderId;
    const validIds: ProviderId[] = ['claude', 'gemini', 'codex'];
    if (!validIds.includes(providerId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown provider: ${providerId}` }));
      return;
    }
    const provider = getProvider(providerId);
    const providerCfg = config.aiProviders?.providers?.[providerId];
    const installed = provider.isInstalled(providerCfg?.customPath);
    if (!installed) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `${provider.displayName} binary not found`, installed: false }));
      return;
    }
    // Try to get version
    try {
      const exePath = provider.exePath(providerCfg?.customPath);
      const version = execSync(`"${exePath}" --version`, { encoding: 'utf-8', timeout: 10000 }).trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, installed: true, version, path: exePath }));
    } catch (err) {
      const exePath = provider.exePath(providerCfg?.customPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, installed: true, version: 'unknown', path: exePath, warning: 'Could not get version' }));
    }
    return;
  }

  // --- Insights API routes ---
  if (url.pathname === '/api/insights/stats' && req.method === 'GET') {
    handleInsightsStats(res);
    return;
  }

  if (url.pathname === '/api/insights/history' && req.method === 'GET') {
    handleInsightsHistory(res);
    return;
  }

  if (url.pathname === '/api/insights/plans' && req.method === 'GET') {
    handleInsightsPlans(res);
    return;
  }

  if (url.pathname === '/api/insights/developer-stats' && req.method === 'GET') {
    handleDeveloperStats(url, res);
    return;
  }

  // POST /api/sessions/:sessionId/rename — send /rename command to PTY
  const renameMatch = /^\/api\/sessions\/([^/]+)\/rename$/.exec(url.pathname);
  if (renameMatch && req.method === 'POST') {
    const sid = decodeURIComponent(renameMatch[1]);
    readBody(req).then((bodyStr) => {
      try {
        const { name } = JSON.parse(bodyStr) as { name: string };
        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing name' }));
          return;
        }
        // Clean the name: take first 40 chars, remove newlines
        const cleanName = name.replace(/[\r\n]/g, ' ').trim().slice(0, 40);
        // PTY IDs contain the Claude session ID as a suffix
        const sent = writeToPtyBySessionId(sid, `/rename ${cleanName}\r`);
        res.writeHead(sent ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: sent }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid body' }));
      }
    }).catch(() => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read body' }));
    });
    return;
  }

  // GET /api/sessions/:sessionId/info — quick metadata lookup by ID, scans
  // ~/.claude/projects/ for the JSONL. Used by SessionDetailPage to recover
  // the cwd for sessions that aren't in the in-memory dashboard store.
  const infoMatch = /^\/api\/sessions\/([^/]+)\/info$/.exec(url.pathname);
  if (infoMatch && req.method === 'GET') {
    const sid = decodeURIComponent(infoMatch[1]);
    const info = getSessionInfo(sid);
    res.writeHead(info.exists ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
    return;
  }

  // GET /api/sessions/tui-mode — current Claude Code renderer mode, read from
  // ~/.claude/settings.json ("tui" key: "fullscreen" | "default"). Lets the
  // session toolbar's full-screen toggle show the real state and send the
  // correct command (/tui fullscreen vs /tui default). State is per-user/global
  // — Claude Code persists the choice here, so it survives restarts.
  if (url.pathname === '/api/sessions/tui-mode' && req.method === 'GET') {
    let mode = 'default';
    try {
      const settingsPath = path.join(config.claudeHome, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { tui?: string };
        if (settings.tui === 'fullscreen') mode = 'fullscreen';
      }
    } catch { /* fall back to default */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ mode }));
    return;
  }

  // GET /api/sessions/temp/:terminalId/resolve?cwd=<path>
  // Resolves a temp terminal ID (`new-*`, `handoff-*`) to its real Claude
  // session ID. Tries persisted discovery map first (survives server restart),
  // then falls back to "most recently modified JSONL in cwd within last hour"
  // when the cwd is supplied by the client's sessionStorage intent.
  const resolveMatch = /^\/api\/sessions\/temp\/([^/]+)\/resolve$/.exec(url.pathname);
  if (resolveMatch && req.method === 'GET') {
    const tid = decodeURIComponent(resolveMatch[1]);
    const cwdParam = url.searchParams.get('cwd') || undefined;
    const sinceRaw = url.searchParams.get('since');
    const sinceParam = sinceRaw ? Number(sinceRaw) : undefined;
    const since = sinceParam && Number.isFinite(sinceParam) ? sinceParam : undefined;

    const cached = terminalSessionIdMap.get(tid);
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId: cached, source: 'cached' }));
      return;
    }

    // Heuristic fallback — only when client supplies the original cwd AND
    // a `since` timestamp (when the temp ID was minted). Without `since`,
    // we'd pick up pre-existing JSONLs and hijack fresh +AI clicks into
    // resumes of unrelated old sessions. Small back-off so clock skew or
    // mtime rounding doesn't drop the JSONL Claude is currently writing.
    if (cwdParam && since) {
      try {
        let realHome = os.homedir();
        try {
          const userHomePath = path.join(path.dirname(process.execPath), '..', 'user-home.txt');
          if (fs.existsSync(userHomePath)) realHome = fs.readFileSync(userHomePath, 'utf-8').trim();
        } catch { /* ignore */ }
        const claudeHome = process.env['CLAUDE_HOME'] ?? path.join(realHome, '.claude');
        const encoded = encodeProjectDirForWatch(cwdParam);
        const sessionsDir = path.join(claudeHome, 'projects', encoded);
        const sinceFloor = since - 5_000;
        if (fs.existsSync(sessionsDir)) {
          let best = '';
          let bestMtime = 0;
          for (const f of fs.readdirSync(sessionsDir)) {
            if (!f.endsWith('.jsonl')) continue;
            try {
              const st = fs.statSync(path.join(sessionsDir, f));
              if (st.mtimeMs < sinceFloor) continue;
              if (st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = f; }
            } catch { /* skip */ }
          }
          if (best && Date.now() - bestMtime < 60 * 60 * 1000) {
            const sid = best.replace('.jsonl', '');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sessionId: sid, source: 'recent-jsonl', modifiedAt: new Date(bestMtime).toISOString() }));
            return;
          }
        }
      } catch (err) {
        console.warn(`[resolve] cwd scan failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No mapping found' }));
    return;
  }

  // GET /api/sessions/:sessionId/transcript
  const transcriptMatch = /^\/api\/sessions\/([^/]+)\/transcript$/.exec(url.pathname);
  if (transcriptMatch && req.method === 'GET') {
    handleGetTranscript(transcriptMatch[1], res);
    return;
  }

  // GET /api/sessions/:sessionId/transcript-markdown
  const transcriptMdMatch = /^\/api\/sessions\/([^/]+)\/transcript-markdown$/.exec(url.pathname);
  if (transcriptMdMatch && req.method === 'GET') {
    handleGetTranscriptMarkdown(transcriptMdMatch[1], res);
    return;
  }

  // POST /api/sessions/:sessionId/transcript-file — save transcript to temp file, return path
  const transcriptFileMatch = /^\/api\/sessions\/([^/]+)\/transcript-file$/.exec(url.pathname);
  if (transcriptFileMatch && req.method === 'POST') {
    handleCreateTranscriptFile(transcriptFileMatch[1], res);
    return;
  }

  // DELETE /api/teams/:name
  if (url.pathname.startsWith('/api/teams/') && req.method === 'DELETE') {
    const teamName = decodeURIComponent(url.pathname.slice('/api/teams/'.length));
    handleDeleteTeam(teamName, res);
    return;
  }

  // --- Browse API route ---
  if (url.pathname === '/api/browse' && req.method === 'GET') {
    const dirPath = url.searchParams.get('path') || os.homedir();
    const resolved = path.resolve(dirPath);
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const items = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          path: path.join(resolved, e.name),
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ current: resolved, entries: items }));
    } catch (err: any) {
      const code = err.code === 'ENOENT' ? 404 : 400;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- Queue API routes ---

  // POST /api/hooks/stop — Claude stop hook endpoint
  if (url.pathname === '/api/hooks/stop' && req.method === 'POST') {
    handleStopHook(req, res);
    return;
  }

  // POST /api/hooks/user-prompt-submit — Claude UserPromptSubmit hook endpoint
  if (url.pathname === '/api/hooks/user-prompt-submit' && req.method === 'POST') {
    handleUserPromptSubmitHook(req, res);
    return;
  }

  // POST /api/hooks/setup — Auto-configure stop + user-prompt-submit hooks
  if (url.pathname === '/api/hooks/setup' && req.method === 'POST') {
    handleSetupHook(res);
    return;
  }

  // Queue CRUD routes: /api/queues/:sessionId
  const queueMatch = /^\/api\/queues\/([^/]+)$/.exec(url.pathname);
  if (queueMatch) {
    const sessionId = decodeURIComponent(queueMatch[1]);
    if (req.method === 'GET') {
      handleGetQueue(sessionId, res);
      return;
    }
    if (req.method === 'POST') {
      handleCreateQueue(sessionId, res);
      return;
    }
    if (req.method === 'PATCH') {
      handlePatchQueue(sessionId, req, res);
      return;
    }
  }

  // POST /api/queues/:sessionId/tasks — add task to queue
  const queueTasksMatch = /^\/api\/queues\/([^/]+)\/tasks$/.exec(url.pathname);
  if (queueTasksMatch && req.method === 'POST') {
    const sessionId = decodeURIComponent(queueTasksMatch[1]);
    handleAddQueueTask(sessionId, req, res);
    return;
  }

  // PATCH /api/queues/:sessionId/reorder — reorder tasks
  const queueReorderMatch = /^\/api\/queues\/([^/]+)\/reorder$/.exec(url.pathname);
  if (queueReorderMatch && req.method === 'PATCH') {
    const sessionId = decodeURIComponent(queueReorderMatch[1]);
    handleReorderQueue(sessionId, req, res);
    return;
  }

  // DELETE /api/queues/:sessionId/completed — clear completed tasks
  const queueClearMatch = /^\/api\/queues\/([^/]+)\/completed$/.exec(url.pathname);
  if (queueClearMatch && req.method === 'DELETE') {
    const sessionId = decodeURIComponent(queueClearMatch[1]);
    handleClearCompleted(sessionId, res);
    return;
  }

  // PATCH /api/queue-tasks/:taskId — update a specific queue task
  const queueTaskUpdateMatch = /^\/api\/queue-tasks\/([^/]+)$/.exec(url.pathname);
  if (queueTaskUpdateMatch && req.method === 'PATCH') {
    const taskId = decodeURIComponent(queueTaskUpdateMatch[1]);
    handleUpdateQueueTask(taskId, req, res);
    return;
  }

  // DELETE /api/queue-tasks/:taskId — delete a specific queue task
  const queueTaskDeleteMatch = /^\/api\/queue-tasks\/([^/]+)$/.exec(url.pathname);
  if (queueTaskDeleteMatch && req.method === 'DELETE') {
    const taskId = decodeURIComponent(queueTaskDeleteMatch[1]);
    handleDeleteQueueTask(taskId, res);
    return;
  }

  if (url.pathname === '/api/projects' && req.method === 'GET') {
    handleGetProjects(res);
    return;
  }

  if (url.pathname === '/api/projects/create' && req.method === 'POST') {
    handleCreateProject(req, res);
    return;
  }

  // --- CLAUDE.md API (legacy, backward compat) ---
  const claudeMdMatch = /^\/api\/projects\/([^/]+)\/claude-md$/.exec(url.pathname);
  if (claudeMdMatch) {
    const encodedPath = decodeURIComponent(claudeMdMatch[1]);
    if (req.method === 'GET') {
      handleGetInstructions(encodedPath, 'claude', res);
      return;
    }
    if (req.method === 'PUT') {
      handlePutInstructions(encodedPath, 'claude', req, res);
      return;
    }
  }

  if (url.pathname === '/api/claude-md/global' && req.method === 'GET') {
    handleGetGlobalInstructions('claude', res);
    return;
  }

  if (url.pathname === '/api/claude-md/global' && req.method === 'PUT') {
    handlePutGlobalInstructions('claude', req, res);
    return;
  }

  // --- Provider-agnostic instruction files API ---
  const instructionsMatch = /^\/api\/projects\/([^/]+)\/instructions$/.exec(url.pathname);
  if (instructionsMatch) {
    const encodedPath = decodeURIComponent(instructionsMatch[1]);
    const provider = (url.searchParams.get('provider') || 'claude') as string;
    if (!INSTRUCTION_FILES[provider]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown provider: ${provider}` }));
      return;
    }
    if (req.method === 'GET') {
      handleGetInstructions(encodedPath, provider, res);
      return;
    }
    if (req.method === 'PUT') {
      handlePutInstructions(encodedPath, provider, req, res);
      return;
    }
  }

  const instructionsAllMatch = /^\/api\/projects\/([^/]+)\/instructions\/all$/.exec(url.pathname);
  if (instructionsAllMatch && req.method === 'GET') {
    const encodedPath = decodeURIComponent(instructionsAllMatch[1]);
    handleGetAllInstructions(encodedPath, res);
    return;
  }

  const instructionsCopyMatch = /^\/api\/projects\/([^/]+)\/instructions\/copy-to-providers$/.exec(url.pathname);
  if (instructionsCopyMatch && req.method === 'POST') {
    const encodedPath = decodeURIComponent(instructionsCopyMatch[1]);
    const sourceProvider = (url.searchParams.get('source') || 'claude') as string;
    handleCopyInstructionsToProviders(encodedPath, sourceProvider, res);
    return;
  }

  if (url.pathname === '/api/instructions/sync-all' && req.method === 'POST') {
    handleSyncAllInstructions(res);
    return;
  }

  if (url.pathname === '/api/instructions/global') {
    const provider = (url.searchParams.get('provider') || 'claude') as string;
    if (!INSTRUCTION_FILES[provider]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown provider: ${provider}` }));
      return;
    }
    if (req.method === 'GET') {
      handleGetGlobalInstructions(provider, res);
      return;
    }
    if (req.method === 'PUT') {
      handlePutGlobalInstructions(provider, req, res);
      return;
    }
  }

  // --- Agents API ---
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const providerParam = url.searchParams.get('provider') as ProviderId | null;
    handleGetAgents(res, providerParam ?? undefined);
    return;
  }

  const agentMatch = /^\/api\/agents\/([^/]+)$/.exec(url.pathname);
  if (agentMatch) {
    const filename = decodeURIComponent(agentMatch[1]);
    const agentProvider = url.searchParams.get('provider') as ProviderId | null;
    if (req.method === 'GET') {
      handleGetAgent(filename, res, agentProvider ?? undefined);
      return;
    }
    if (req.method === 'PUT') {
      handlePutAgent(filename, req, res, agentProvider ?? undefined);
      return;
    }
    if (req.method === 'DELETE') {
      handleDeleteAgent(filename, res, agentProvider ?? undefined);
      return;
    }
  }

  // --- Skills API ---
  if (url.pathname === '/api/skills' && req.method === 'GET') {
    const skillProvider = url.searchParams.get('provider') as ProviderId | null;
    handleGetSkills(res, skillProvider ?? undefined);
    return;
  }
  if (url.pathname === '/api/skills/sync-all' && req.method === 'POST') {
    const result = syncAllSkills(config.claudeHome, config.aiProviders!);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  const skillMatch = /^\/api\/skills\/([^/]+)$/.exec(url.pathname);
  if (skillMatch) {
    const name = decodeURIComponent(skillMatch[1]);
    const skillProviderParam = url.searchParams.get('provider') as ProviderId | null;
    if (req.method === 'GET') {
      handleGetSkill(name, res, skillProviderParam ?? undefined);
      return;
    }
    if (req.method === 'PUT') {
      handlePutSkill(name, req, res, skillProviderParam ?? undefined);
      return;
    }
    if (req.method === 'DELETE') {
      handleDeleteSkill(name, res, skillProviderParam ?? undefined);
      return;
    }
  }

  // --- Plugins API ---
  if (url.pathname === '/api/plugins' && req.method === 'GET') {
    const pluginProvider = url.searchParams.get('provider') as ProviderId | null;
    handleGetPlugins(res, pluginProvider ?? undefined);
    return;
  }

  const pluginToggleMatch = /^\/api\/plugins\/([^/]+)\/toggle$/.exec(url.pathname);
  if (pluginToggleMatch && req.method === 'PATCH') {
    const pluginId = decodeURIComponent(pluginToggleMatch[1]);
    handleTogglePlugin(pluginId, res);
    return;
  }

  // --- Permissions API ---
  if (url.pathname === '/api/permissions' && req.method === 'GET') {
    handleGetPermissions(res);
    return;
  }

  if (url.pathname === '/api/permissions' && req.method === 'PATCH') {
    handlePatchPermissions(req, res);
    return;
  }

  if (url.pathname === '/api/permissions/projects' && req.method === 'GET') {
    handleGetPermissionProjects(res);
    return;
  }

  const permProjectMatch = /^\/api\/permissions\/projects\/([^/]+)$/.exec(url.pathname);
  if (permProjectMatch) {
    const encodedPath = decodeURIComponent(permProjectMatch[1]);
    if (req.method === 'GET') {
      handleGetProjectPermissions(encodedPath, res);
      return;
    }
    if (req.method === 'PATCH') {
      handlePatchProjectPermissions(encodedPath, req, res);
      return;
    }
  }

  // --- Community API ---
  const communityMatch = /^\/api\/community\/(agents|skills|plugins|hooks)$/.exec(url.pathname);
  if (communityMatch && req.method === 'GET') {
    const type = communityMatch[1] as 'agents' | 'skills' | 'plugins' | 'hooks';
    handleGetCommunity(type, res);
    return;
  }

  if (url.pathname === '/api/agents/install' && req.method === 'POST') {
    handleInstallAgent(req, res);
    return;
  }

  if (url.pathname === '/api/skills/install' && req.method === 'POST') {
    handleInstallSkill(req, res);
    return;
  }

  // --- Bookmarks API ---
  if (url.pathname === '/api/bookmarks' && req.method === 'GET') {
    handleGetBookmarks(res);
    return;
  }

  if (url.pathname === '/api/bookmarks' && req.method === 'POST') {
    handleCreateBookmark(req, res);
    return;
  }

  if (url.pathname.startsWith('/api/bookmarks') && req.method === 'DELETE') {
    const sid = url.searchParams.get('sessionId');
    if (sid) {
      handleDeleteBookmark(sid, res);
      return;
    }
  }

  // --- Auto-start API ---
  if (url.pathname === '/api/system/autostart' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ enabled: isAutostartSupported() && isAutostartEnabled(), supported: isAutostartSupported() }));
    return;
  }

  if (url.pathname === '/api/system/autostart' && req.method === 'POST') {
    const result = enableAutostart();
    res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/api/system/autostart' && req.method === 'DELETE') {
    const result = disableAutostart();
    res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // --- Scheduled Tasks API routes (legacy) ---
  if (url.pathname === '/api/scheduled-tasks' && req.method === 'GET') {
    handleGetScheduledTasks(res);
    return;
  }
  if (url.pathname === '/api/scheduled-tasks' && req.method === 'POST') {
    handleCreateScheduledTask(req, res);
    return;
  }
  const scheduledTaskMatch = /^\/api\/scheduled-tasks\/([^/]+)$/.exec(url.pathname);
  if (scheduledTaskMatch) {
    const name = decodeURIComponent(scheduledTaskMatch[1]);
    if (req.method === 'PUT') {
      handleUpdateScheduledTask(name, req, res);
      return;
    }
    if (req.method === 'DELETE') {
      handleDeleteScheduledTask(name, res);
      return;
    }
  }

  // --- Schedules API routes (new execution engine) ---
  if (url.pathname === '/api/schedules' && req.method === 'GET') {
    handleGetSchedules(res);
    return;
  }
  if (url.pathname === '/api/schedules' && req.method === 'POST') {
    handleCreateSchedule(req, res);
    return;
  }

  // Single run output: GET /api/schedule-runs/:runId
  const singleRunMatch = /^\/api\/schedule-runs\/([^/]+)$/.exec(url.pathname);
  if (singleRunMatch && req.method === 'GET') {
    handleGetSingleRun(decodeURIComponent(singleRunMatch[1]), res);
    return;
  }

  // Schedule sub-routes
  const scheduleRunMatch = /^\/api\/schedules\/([^/]+)\/run$/.exec(url.pathname);
  if (scheduleRunMatch && req.method === 'POST') {
    handleTriggerScheduleRun(decodeURIComponent(scheduleRunMatch[1]), res);
    return;
  }
  const scheduleToggleMatch = /^\/api\/schedules\/([^/]+)\/toggle$/.exec(url.pathname);
  if (scheduleToggleMatch && req.method === 'POST') {
    handleToggleSchedule(decodeURIComponent(scheduleToggleMatch[1]), res);
    return;
  }
  const scheduleRunsMatch = /^\/api\/schedules\/([^/]+)\/runs$/.exec(url.pathname);
  if (scheduleRunsMatch && req.method === 'GET') {
    handleGetScheduleRuns(decodeURIComponent(scheduleRunsMatch[1]), url, res);
    return;
  }
  const scheduleIdMatch = /^\/api\/schedules\/([^/]+)$/.exec(url.pathname);
  if (scheduleIdMatch) {
    const scheduleId = decodeURIComponent(scheduleIdMatch[1]);
    if (req.method === 'PUT') {
      handleUpdateSchedule(scheduleId, req, res);
      return;
    }
    if (req.method === 'DELETE') {
      handleDeleteSchedule(scheduleId, res);
      return;
    }
  }

  // --- Live Loops API routes ---
  if (url.pathname === '/api/loops' && req.method === 'GET') {
    handleGetLoops(url, res);
    return;
  }
  if (url.pathname === '/api/loop-templates' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(LOOP_TEMPLATES));
    return;
  }
  const loopSessionMatch = /^\/api\/loops\/([^/]+)$/.exec(url.pathname);
  if (loopSessionMatch) {
    const id = decodeURIComponent(loopSessionMatch[1]);
    if (req.method === 'POST') {
      handleCreateLoop(id, req, res);
      return;
    }
    if (req.method === 'DELETE') {
      handleStopLoop(id, res);
      return;
    }
  }

  // --- Update source (Settings → Updates): repo/branch on a connected git host ---
  if (url.pathname === '/api/updates/source' && req.method === 'GET') {
    jsonResponse(res, 200, config.updates ?? {});
    return;
  }
  if (url.pathname === '/api/updates/source' && req.method === 'PUT') {
    if (isAuthEnabled(config) && (req as AuthenticatedRequest).user?.role !== 'admin') {
      jsonResponse(res, 403, { error: 'Admin access required' });
      return;
    }
    sharedReadBody(req).then((raw) => {
      const b = JSON.parse(raw || '{}') as { connectionId?: string; repo?: string; branch?: string };
      const repo = b.repo?.trim();
      config.updates = repo ? { connectionId: b.connectionId || undefined, repo, branch: b.branch?.trim() || 'main' } : undefined;
      saveConfig(config);
      jsonResponse(res, 200, config.updates ?? {});
    }).catch((err) => jsonResponse(res, 400, { error: (err as Error).message }));
    return;
  }

  // --- Updater API routes ---
  if (url.pathname === '/api/updates/check' && req.method === 'GET') {
    checkForUpdates().then(status => {
      // Map REST API response to frontend's expected shape
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        upToDate: status.upToDate,
        currentCommit: status.currentVersion,
        remoteCommit: status.latestVersion,
        behindBy: status.upToDate ? 0 : 1,
        authConfigured: status.authConfigured,
      }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    });
    return;
  }
  if (url.pathname === '/api/updates/apply' && req.method === 'POST') {
    // Use Server-Sent Events to stream progress
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    applyUpdates((step, detail) => {
      sendEvent({ type: 'progress', step, detail });
    }).then(result => {
      sendEvent({ type: 'result', ...result });
      res.end();
    }).catch(err => {
      sendEvent({ type: 'result', success: false, message: (err as Error).message });
      res.end();
    });
    return;
  }
  if (url.pathname === '/api/updates/changelog' && req.method === 'GET') {
    getChangelog().then(entries => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entries));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    });
    return;
  }

  // --- Restart server ---
  if (url.pathname === '/api/server/restart' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Server restarting...' }));
    // Give the response time to send, then exit (service manager or tsx watch will restart)
    setTimeout(() => {
      console.log('[server] Restart requested, exiting...');
      process.exit(0);
    }, 1000);
    return;
  }




  // --- Optional modules: toggle API + gate a disabled module's routes ---
  if (url.pathname === '/api/modules' || url.pathname.startsWith('/api/modules/')) {
    if (req.method !== 'GET' && isAuthEnabled(config) && (req as AuthenticatedRequest).user?.role !== 'admin') {
      jsonResponse(res, 403, { error: 'Admin access required' });
      return;
    }
    if (registerModuleRoutes(url, req, res, config, saveConfig)) return;
  }
  {
    const off = inactiveModuleForPath(config, url.pathname);
    if (off) {
      jsonResponse(res, 404, { error: `The ${off.name} module is turned off or not set up (Settings → Modules)`, module: off.id });
      return;
    }
  }

  // --- Admin-only system settings (when login is on) ---
  // Changing storage, integrations or the AI backend affects every user and
  // touches stored credentials.
  if (
    isAuthEnabled(config) && req.method !== 'GET' &&
    (url.pathname.startsWith('/api/storage') || url.pathname.startsWith('/api/integrations') || url.pathname.startsWith('/api/llm'))
  ) {
    const u = (req as AuthenticatedRequest).user;
    const actual = u ? (db.prepare('SELECT role FROM users WHERE oid = ?').get(u.oid) as { role?: string } | undefined)?.role : undefined;
    if (actual !== 'admin') {
      jsonResponse(res, 403, { error: 'Admin access required' });
      return;
    }
  }

  // --- Delivery: tickets, pull requests, delivery feeds (via integrations) ---
  if (url.pathname.startsWith('/api/work/') || url.pathname.startsWith('/api/pulls') || url.pathname.startsWith('/api/delivery/')) {
    if (registerDeliveryRoutes(url, req, res, config)) return;
  }

  // --- LLM backend settings (Settings → AI) ---
  if (url.pathname === '/api/llm' || url.pathname === '/api/llm/test') {
    if (registerLlmRoutes(url, req, res, config, saveConfig)) return;
  }

  // --- Integrations (git hosts / ticket trackers) ---
  if (url.pathname.startsWith('/api/integrations')) {
    if (registerIntegrationRoutes(url, req, res, config, saveConfig)) return;
  }

  // --- Storage settings (shared database target) ---
  if (url.pathname === '/api/storage' || url.pathname === '/api/storage/test') {
    if (registerStorageRoutes(url, req, res, config, saveConfig)) return;
  }

  // --- Personas API routes ---
  if (url.pathname.startsWith('/api/personas')) {
    if (registerPersonaRoutes(url, req, res)) return;
  }

  // --- Knowledge Base API routes ---
  if (url.pathname.startsWith('/api/kb/')) {
    if (registerKBRoutes(url, req, res)) return;
  }

  // --- Sharing API routes (direct DB or Azure Functions proxy based on role) ---
  if (url.pathname.startsWith('/api/sharing/')) {
    if (registerSharingRoutes(url, req, res, config)) return;
    if (registerHooksRoutes(url, req, res, config)) return;
  }

  // --- AI provider account routes (list is open; mutations are admin-only) ---
  if (/^\/api\/providers\/[a-z]+\/accounts/.test(url.pathname)) {
    if (registerAccountRoutes(url, req, res, db)) return;
    jsonResponse(res, 404, { error: 'Account route not found' });
    return;
  }

  // --- Skill Requirements API routes (resolve/install + admin CRUD) ---
  if (url.pathname.startsWith('/api/skill-requirements') || url.pathname.startsWith('/api/admin/skill-requirements')) {
    if (registerSkillRequirementsRoutes(url, req, res, db, config)) return;
    jsonResponse(res, 404, { error: 'Skill requirements route not found' });
    return;
  }

  // --- Activity tracking (best-effort) ---
  if (url.pathname === '/api/activity/track') {
    if (registerUserManagementRoutes(url, req, res, db)) return;
    jsonResponse(res, 200, { ok: true });
    return;
  }

  // --- User Management / My-Overrides / Adoption / Usage analytics API routes ---
  if (url.pathname.startsWith('/api/admin/users') || url.pathname === '/api/admin/adoption' || url.pathname.startsWith('/api/admin/usage/') || url.pathname === '/api/auth/my-overrides') {
    if (registerUserManagementRoutes(url, req, res, db)) return;
  }

  // --- Granular event tracking (data-track click stream) ---
  if (url.pathname === '/api/events/track') {
    if (registerEventTrackRoutes(url, req, res)) return;
  }

  // --- Team "Now" board (presence + live-session snapshots) ---
  if (url.pathname === '/api/now/push' || url.pathname === '/api/now/board' || url.pathname === '/api/now/status') {
    if (registerNowRoutes(url, req, res)) return;
  }

  // --- Incognito (per-project / per-session opt-out of shared logging) ---
  if (url.pathname.startsWith('/api/incognito')) {
    if (registerIncognitoRoutes(url, req, res)) return;
  }

  // --- Cross-user session handoff ---
  if (url.pathname.startsWith('/api/handoff')) {
    if (registerHandoffRoutes(url, req, res)) return;
  }


  // --- Universal search + Ask Hive RAG ---
  if (url.pathname === '/api/search' || url.pathname === '/api/search/ask') {
    if (registerSearchRoutes(url, req, res, config)) return;
  }

  // --- Hive-native peer review ---
  if (url.pathname === '/api/reviews' || url.pathname.startsWith('/api/reviews/')) {
    if (registerReviewRoutes(url, req, res)) return;
  }









  // --- Calendar API routes ---
  if (url.pathname.startsWith('/api/dashboard/calendar')) {
    if (registerCalendarRoutes(url, req, res)) return;
  }


  // --- Session Replay API routes ---
  if (url.pathname.startsWith('/api/sessions/replay')) {
    if (registerReplayRoutes(url, req, res)) return;
  }

  // --- Session drag-and-drop file uploads ---
  if (/^\/api\/sessions\/[^/]+\/dropfile$/.test(url.pathname)) {
    if (await registerDropfileRoute(url, req, res)) return;
  }

  // --- Inline images injected into a session (for click-to-expand) ---
  {
    const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/injected-images$/);
    if (m && req.method === 'GET') {
      const { getInjectedImagePaths } = await import('./terminal-pty.js');
      const paths = getInjectedImagePaths(decodeURIComponent(m[1]));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paths }));
      return;
    }
  }


  // --- Session Screenshot (Playwright) ---
  if (registerScreenshotRoutes(url, req, res)) return;




  // --- Analytics API routes ---
  if (url.pathname.startsWith('/api/analytics/')) {
    if (registerAnalyticsRoutes(url, req, res, timeTracker, turnTracker)) return;
  }

  // --- Git API routes (under /api/projects/:path/git-*) ---
  if (url.pathname.match(/\/api\/projects\/.+\/git-/)) {
    if (registerGitRoutes(url, req, res)) return;
  }

  // --- Dependency scan routes (under /api/projects/:path/dependencies) ---
  if (url.pathname.match(/\/api\/projects\/.+\/dependencies$/)) {
    if (registerDependencyRoutes(url, req, res)) return;
  }

  // --- AI Studio API routes ---
  if (url.pathname.startsWith('/api/ai-studio/')) {
    if (registerAIStudioRoutes(url, req, res, config)) return;
  }

  // --- Security API routes ---
  if (url.pathname.startsWith('/api/security/')) {
    if (registerSecurityRoutes(url, req, res)) return;
  }

  // --- Session Templates API routes ---
  if (url.pathname === '/api/templates' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAllSessionTemplates()));
    return;
  }
  if (url.pathname === '/api/templates' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const template = insertSessionTemplate(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(template));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid template data' }));
      }
    });
    return;
  }
  if (url.pathname === '/api/templates' && req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const template = updateSessionTemplate(data.id, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(template));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid template data' }));
      }
    });
    return;
  }
  if (url.pathname === '/api/templates' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (id) {
      deleteSessionTemplate(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }
  const templateLaunchMatch = /^\/api\/templates\/([^/]+)\/launch$/.exec(url.pathname);
  if (templateLaunchMatch && req.method === 'POST') {
    const id = decodeURIComponent(templateLaunchMatch[1]);
    incrementTemplateUsage(id);
    const template = getSessionTemplate(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(template));
    return;
  }

  // --- Prompt Library API routes ---
  if (url.pathname === '/api/prompts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAllSavedPrompts()));
    return;
  }
  if (url.pathname === '/api/prompts' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const prompt = insertSavedPrompt(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(prompt));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid prompt data' }));
      }
    });
    return;
  }
  if (url.pathname === '/api/prompts' && req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const prompt = updateSavedPrompt(data.id, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(prompt));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid prompt data' }));
      }
    });
    return;
  }
  if (url.pathname === '/api/prompts' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (id) {
      deleteSavedPrompt(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }
  const promptUseMatch = /^\/api\/prompts\/([^/]+)\/use$/.exec(url.pathname);
  if (promptUseMatch && req.method === 'POST') {
    const id = decodeURIComponent(promptUseMatch[1]);
    incrementPromptUsage(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- Chat API routes ---
  if (url.pathname.startsWith('/api/chat/')) {
    if (handleChatRoutes(url, req, res)) return;
    jsonResponse(res, 404, { error: 'Chat route not found' });
    return;
  }

  // --- Messaging (person-to-person) API routes ---
  if (url.pathname.startsWith('/api/messaging/')) {
    if (handleMessagingRoutes(url, req, res)) return;
    jsonResponse(res, 404, { error: 'Messaging route not found' });
    return;
  }


  // Gmail / Calendar — local Google OAuth using the user's own client
  // (config.google). Tokens stay on this machine.
  if (url.pathname.startsWith('/api/gmail/') || url.pathname.startsWith('/api/calendar/')) {
    if (handleGmailRoutes(url, req, res, config, saveConfig, PORT)) return;
    jsonResponse(res, 404, { error: 'Gmail route not found' });
    return;
  }
  if (url.pathname.startsWith('/api/todo/')) {
    if (handleTodoRoutes(url, req, res, config, saveConfig)) return;
    jsonResponse(res, 404, { error: 'Todo route not found' });
    return;
  }
  if (url.pathname.startsWith('/api/workflows') || url.pathname.startsWith('/api/workflow-recipes') || url.pathname.startsWith('/api/workflow-credentials') || url.pathname.startsWith('/api/connectors') || url.pathname.startsWith('/api/distributions')) {
    if (handleWorkflowRoutes(url, req, res, workflowScheduler)) return;
    jsonResponse(res, 404, { error: 'Workflow route not found' });
    return;
  }
  if (url.pathname.startsWith('/api/team/')) {
    if (handleTeamRoutes(url, req, res)) return;
    jsonResponse(res, 404, { error: 'Team route not found' });
    return;
  }

  // --- Static file serving for production ---
  const distDir = path.join(import.meta.dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    serveStatic(url.pathname, distDir, res);
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// --- WebSocket Servers ---
const wss = new WebSocketServer({ noServer: true });        // Dashboard state
const wssTerm = new WebSocketServer({ noServer: true });     // Terminal PTY
const wssChat = new WebSocketServer({ noServer: true });     // Chat sessions

// Route upgrade requests by URL path. WebSockets are exempt from CORS, so
// the Origin/Host checks here are what stop a web page from attaching to a
// terminal; with login enabled, a valid session is also required.
function handleUpgrade(req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
  const origin = req.headers.origin;
  if (!isAllowedHost(req.headers.host) || (origin && !isAllowedOrigin(origin, req.headers.host))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  if (isAuthEnabled(config) && !authenticate(req as AuthenticatedRequest, db)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const pathname = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname;

  if (pathname.startsWith('/ws/terminal/')) {
    wssTerm.handleUpgrade(req, socket, head, (ws) => {
      wssTerm.emit('connection', ws, req);
    });
  } else if (pathname.startsWith('/ws/chat/')) {
    wssChat.handleUpgrade(req, socket, head, (ws) => {
      wssChat.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/activity') {
    activityWss.handleUpgrade(req, socket, head, (ws) => {
      activityWss.emit('connection', ws, req);
    });
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Tag the socket with the authenticated user's OID so admin actions
      // (e.g. force_update) can target a specific user's connections.
      try {
        const authed = authenticate(req as AuthenticatedRequest, db);
        (ws as WebSocket & { _userOid?: string }).
          _userOid = authed?.oid;
      } catch { /* anonymous client (auth not configured) — leave undefined */ }
      wss.emit('connection', ws, req);
    });
  }
}
server.on('upgrade', handleUpgrade);

// Expose the dashboard WSS to other server modules (e.g. admin user routes)
// so they can target specific users for force-update broadcasts and read
// which OIDs are currently online.
setDashboardWss(wss);

// Chat WebSocket — bridges chat UI to hidden PTY + JSONL
wssChat.on('connection', (ws, req: http.IncomingMessage) => {
  const chatUrl = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const conversationId = chatUrl.pathname.replace('/ws/chat/', '');
  if (!conversationId) {
    ws.close(4000, 'Missing conversation ID');
    return;
  }
  console.log(`[ws-chat] Chat connection for ${conversationId}`);
  handleChatWsConnection(conversationId, ws);
});

// Dashboard WebSocket
wss.on('connection', (ws) => {
  console.log(`[ws] Client connected (total: ${wss.clients.size})`);

  // Send full state snapshot on connect
  const message: WsMessage = {
    version: 1,
    type: 'full_state',
    payload: aggregator.getState(),
  };
  ws.send(JSON.stringify(message));

  ws.on('close', () => {
    console.log(`[ws] Client disconnected (total: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.error(`[ws] Client error:`, err);
  });
});

// Map of temp terminalId (`new-*`, `handoff-*`) → real Claude session ID
// once discovered via JSONL filesystem polling. Persisted to disk so a
// browser refresh after a server restart (e.g. after Refresh-from-Repo)
// can still recover the real session and stop the user from losing work
// on a bookmarked `new-<uuid>` URL.
const terminalSessionIdMap = new Map<string, string>();
const terminalSessionWatchers = new Map<string, ReturnType<typeof setInterval>>();

const TERMINAL_SESSION_MAP_FILE = hivePath('terminal-sessions.json');
const TERMINAL_SESSION_MAP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface TerminalSessionRecord {
  sessionId: string;
  /** Epoch ms — entries older than TTL are dropped on load */
  ts: number;
}

function loadTerminalSessionMap(): void {
  try {
    if (!fs.existsSync(TERMINAL_SESSION_MAP_FILE)) return;
    const raw = fs.readFileSync(TERMINAL_SESSION_MAP_FILE, 'utf-8');
    const data = JSON.parse(raw) as Record<string, TerminalSessionRecord>;
    const now = Date.now();
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v.sessionId === 'string' && typeof v.ts === 'number') {
        if (now - v.ts < TERMINAL_SESSION_MAP_TTL_MS) {
          terminalSessionIdMap.set(k, v.sessionId);
        }
      }
    }
    console.log(`[ws-term] Loaded ${terminalSessionIdMap.size} persisted terminal→session mappings`);
  } catch (err) {
    console.warn(`[ws-term] Failed to load terminal-sessions.json: ${err instanceof Error ? err.message : err}`);
  }
}

function saveTerminalSessionMap(): void {
  try {
    fs.mkdirSync(path.dirname(TERMINAL_SESSION_MAP_FILE), { recursive: true });
    const out: Record<string, TerminalSessionRecord> = {};
    const now = Date.now();
    for (const [k, sessionId] of terminalSessionIdMap) {
      out[k] = { sessionId, ts: now };
    }
    fs.writeFileSync(TERMINAL_SESSION_MAP_FILE, JSON.stringify(out, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[ws-term] Failed to persist terminal-sessions.json: ${err instanceof Error ? err.message : err}`);
  }
}

loadTerminalSessionMap();

function encodeProjectDirForWatch(p: string): string {
  if (process.platform === 'win32') return encodeWindowsPath(p);
  return p.replace(/\//g, '-');
}

function broadcastDiscoveredSessionId(termId: string, sessionId: string): void {
  // Carry an incognito mark from the temp terminal ID onto the real session ID
  // first — before anything downstream can log against the new ID.
  linkIncognitoSession(termId, sessionId);

  // Re-key the running PTY from the temp ID to the real Claude session ID so
  // the client can navigate to `/sessions/<real-id>` and reattach instead of
  // spawning a second `claude --resume` process against the same JSONL.
  if (termId !== sessionId) {
    const renamed = renamePtySession(termId, sessionId);
    if (renamed) {
      // Update any sockets currently tagged with the old termId so future
      // detach/cleanup calls hit the correct key.
      for (const client of wssTerm.clients) {
        const c = client as WebSocket & { _termId?: string };
        if (c._termId === termId) c._termId = sessionId;
      }
    }
  }
  for (const client of wssTerm.clients) {
    const c = client as WebSocket & { _termId?: string };
    if (c._termId === sessionId && c.readyState === WebSocket.OPEN) {
      try {
        c.send(JSON.stringify({ type: 'session-id-discovered', terminalId: termId, sessionId }));
      } catch { /* ignore */ }
    }
  }
}

/**
 * Watch ~/.claude/projects/<encoded-cwd>/ for a NEW JSONL file appearing
 * shortly after a `new-*`/`handoff-*` terminal spawn. Once detected, store
 * and broadcast the real Claude session ID so the client can replace the
 * URL — survives page reloads, server restarts via getSessionInfo lookup.
 */
function watchForTerminalSessionFile(termId: string, cwd: string): void {
  if (terminalSessionWatchers.has(termId) || terminalSessionIdMap.has(termId)) return;

  // Resolve real user home for service mode
  let realHome = os.homedir();
  try {
    const userHomePath = path.join(path.dirname(process.execPath), '..', 'user-home.txt');
    if (fs.existsSync(userHomePath)) {
      realHome = fs.readFileSync(userHomePath, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  const claudeHome = process.env['CLAUDE_HOME'] ?? path.join(realHome, '.claude');
  const encoded = encodeProjectDirForWatch(cwd);
  const sessionsDir = path.join(claudeHome, 'projects', encoded);

  let preExisting: Set<string> | null = null;
  try {
    if (fs.existsSync(sessionsDir)) {
      preExisting = new Set(fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')));
    }
  } catch { /* dir may not exist yet */ }

  let attempts = 0;
  const maxAttempts = 240; // 2 minutes at 500ms

  const timer = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts || terminalSessionIdMap.has(termId)) {
      clearInterval(timer);
      terminalSessionWatchers.delete(termId);
      return;
    }

    try {
      if (!fs.existsSync(sessionsDir)) return;
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl') && !f.includes(':'));

      // Strategy 1: a file that didn't exist before spawn
      if (preExisting) {
        for (const f of files) {
          if (!preExisting.has(f)) {
            const sid = f.replace('.jsonl', '');
            terminalSessionIdMap.set(termId, sid);
            saveTerminalSessionMap();
            console.log(`[ws-term] Discovered NEW Claude session for ${termId}: ${sid}`);
            broadcastDiscoveredSessionId(termId, sid);
            clearInterval(timer);
            terminalSessionWatchers.delete(termId);
            return;
          }
        }
      } else {
        // Pre-existing snapshot wasn't taken — first appearance counts as new
        if (files.length > 0) {
          // Pick most recently modified
          let best = '';
          let bestMtime = 0;
          for (const f of files) {
            try {
              const st = fs.statSync(path.join(sessionsDir, f));
              if (st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = f; }
            } catch { /* skip */ }
          }
          if (best && Date.now() - bestMtime < 60_000) {
            const sid = best.replace('.jsonl', '');
            terminalSessionIdMap.set(termId, sid);
            saveTerminalSessionMap();
            console.log(`[ws-term] Discovered Claude session for ${termId} (recent): ${sid}`);
            broadcastDiscoveredSessionId(termId, sid);
            clearInterval(timer);
            terminalSessionWatchers.delete(termId);
            return;
          }
        }
        // Initialize snapshot now that the dir exists, for subsequent polls
        preExisting = new Set(files);
      }
    } catch { /* ignore poll errors */ }
  }, 500);

  terminalSessionWatchers.set(termId, timer);
}

// Terminal WebSocket — bridges xterm.js ↔ node-pty
// PTY sessions persist across WebSocket disconnects (tab switches, page navigation).
// When a WebSocket reconnects for the same terminal ID, it reattaches to the existing PTY
// and replays buffered output. PTYs are only destroyed on explicit close, process exit,
// or orphan timeout (5 minutes with no WebSocket attached).
wssTerm.on('connection', (ws, req: http.IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const termId = url.pathname.replace('/ws/terminal/', '');

  if (!termId) {
    ws.close(4000, 'Missing terminal ID');
    return;
  }

  console.log(`[ws-term] Terminal connection for ${termId}`);

  // Tag the socket so background watchers can locate it for broadcasts.
  (ws as WebSocket & { _termId?: string })._termId = termId;

  // If we already discovered a real Claude session ID for this temp terminalId
  // (e.g. before a page reload), re-emit so the client can replace the URL.
  const existingSid = terminalSessionIdMap.get(termId);
  if (existingSid) {
    try {
      ws.send(JSON.stringify({ type: 'session-id-discovered', terminalId: termId, sessionId: existingSid }));
    } catch { /* ignore */ }
  }

  let ptyReady = false;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type: string;
        data?: string;
        cols?: number;
        rows?: number;
        cwd?: string;
        projectDir?: string;
        command?: string;
        args?: string[];
        provider?: ProviderId;
        account?: string;
        enhancements?: { inlineImages?: boolean };
      };

      switch (msg.type) {
        case 'spawn': {
          // Check if a PTY already exists for this terminal ID (reconnection)
          const existing = getPtySession(termId);
          if (existing) {
            // The account is baked into the process environment at spawn time,
            // so a request for a DIFFERENT one cannot be satisfied by
            // reattaching — kill it and fall through to a fresh spawn. Doing
            // this server-side makes the switch deterministic instead of racing
            // the client's `close` message against its new socket's `spawn`.
            //
            // An ABSENT account means "no opinion", never "use the default".
            // A remount that has lost track of the account (URL stabilization
            // used to drop it) must reattach to the running process rather than
            // respawn it on the default identity, which silently moves the
            // session onto the wrong subscription mid-conversation.
            // `default` and absent both mean the provider's primary config dir,
            // so normalise before comparing or a session already on the default
            // would respawn when the client names it explicitly.
            const normalizeAccount = (a?: string) => (!a || a === 'default' ? undefined : a);
            const accountChangeRequested =
              !!msg.account && normalizeAccount(msg.account) !== normalizeAccount(existing.accountId);
            if (accountChangeRequested) {
              console.log(
                `[ws-term] Account change for ${termId} ` +
                `(${existing.accountId ?? 'default'} -> ${msg.account}) - respawning`,
              );
              destroyPty(termId);
            } else {
              console.log(
                `[ws-term] Reattaching to existing PTY for ${termId} ` +
                `(exited=${existing.exited}, account=${existing.accountId ?? 'default'})`,
              );
              attachWebSocket(termId, ws);
              ptyReady = !existing.exited;
              // Report the account the process is ACTUALLY running under, so the
              // UI can show ground truth rather than whatever the client believes.
              ws.send(JSON.stringify({
                type: 'ready',
                reconnected: true,
                account: existing.accountId ?? 'default',
              }));
              break;
            }
          }

          // No existing PTY — spawn a new one
          let cwd = msg.cwd ?? process.cwd();
          // Guard: if cwd was empty string, fall back to process.cwd()
          if (!cwd) cwd = process.cwd();
          // If cwd is missing or doesn't exist, try to decode the encoded projectDir
          if (msg.projectDir && (!msg.cwd || !fs.existsSync(msg.cwd))) {
            if (isWindows) {
              const decoded = decodeWindowsProjectDir(msg.projectDir);
              if (fs.existsSync(decoded)) {
                cwd = decoded;
              }
            }
          }
          // Lazily create the directory if it's under projectsRoot (e.g., Generic folder)
          if (!fs.existsSync(cwd) && config.projectsRoot && cwd.startsWith(config.projectsRoot)) {
            try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* ignore */ }
          }

          // For `claude --resume <id>`, override cwd with the JSONL's actual
          // location when they diverge. The dashboard store's cwd reflects the
          // last directory the session was running in (the user may have
          // `cd`'d into a subdir during the session) — but Claude resolves
          // sessions by encode(cwd), so spawning from the subdir makes claude
          // exit with "No conversation found with session ID".
          if (msg.args && (msg.provider ?? 'claude') === 'claude') {
            const resumeIdx = msg.args.indexOf('--resume');
            const resumeId = resumeIdx >= 0 && msg.args.length > resumeIdx + 1 ? msg.args[resumeIdx + 1] : undefined;
            if (resumeId) {
              const info = getSessionInfo(resumeId);
              if (info.exists && info.cwd && info.cwd !== cwd) {
                console.log(`[ws-term] Correcting resume cwd for ${resumeId}: ${cwd} → ${info.cwd}`);
                cwd = info.cwd;
              }

              // A background agent still owns this session ID? A plain
              // `--resume` is guaranteed to fail ("...is currently running as
              // a background agent (bg)... add --fork-session"), leaving the
              // user staring at a dead terminal. Branch off a copy instead so
              // they at least land in a working session with full history.
              // Handled here rather than at each call site so every resume
              // entry point (session detail, grid, deep link) is covered.
              const holder = info.liveHolder ?? getLiveSessionHolder(resumeId);
              if (holder?.kind === 'bg' && !msg.args.includes('--fork-session')) {
                console.log(`[ws-term] ${resumeId} is held by a bg agent (pid ${holder.pid}) — adding --fork-session`);
                msg.args.splice(resumeIdx + 2, 0, '--fork-session');
                ws.send(JSON.stringify({
                  type: 'forked-session',
                  sessionId: resumeId,
                  holderPid: holder.pid,
                  holderName: holder.name,
                }));
              }
            }
          }

          const cols = msg.cols ?? 120;
          const rows = msg.rows ?? 30;

          console.log(`[ws-term] Spawn request: command=${msg.command}, args=${JSON.stringify(msg.args)}, cwd=${cwd}, projectDir=${msg.projectDir}`);

          // Coerce empty-string command to undefined so spawnPty uses the default shell
          const spawnCommand = msg.command || undefined;
          spawnPty(termId, cwd, cols, rows, spawnCommand, msg.args, msg.provider, msg.enhancements, msg.account).then((_session) => {
            ptyReady = true;
            // Attach this WebSocket to the new session
            attachWebSocket(termId, ws);
            ws.send(JSON.stringify({
              type: 'ready',
              reconnected: false,
              account: _session.accountId ?? 'default',
            }));
            console.log(`[ws-term] PTY spawned for ${termId} in ${cwd}`);
            // For temp terminal IDs (`new-*`, `handoff-*`), watch the cwd's project
            // dir for the JSONL Claude is about to create so we can stabilize the URL.
            if (/^(new|handoff)-/.test(termId) && (msg.provider ?? 'claude') === 'claude') {
              // Spawning into an incognito project? Mark the temp id too, so
              // the real session id inherits it by id (not just by cwd) once
              // discovered — that's what lets route redaction be exact.
              if (isIncognitoProjectPath(cwd) && !isIncognitoId(termId)) {
                setSessionIncognito(termId, true);
              }
              watchForTerminalSessionFile(termId, cwd);
            }
          }).catch((err) => {
            console.error(`[ws-term] Failed to spawn PTY (command=${msg.command}, resolved=${spawnCommand}, cwd=${cwd}):`, err);
            ws.send(JSON.stringify({ type: 'error', message: String(err) }));
          });
          break;
        }

        case 'input': {
          if (ptyReady && msg.data !== undefined) {
            const currentId = (ws as WebSocket & { _termId?: string })._termId ?? termId;
            const session = getPtySession(currentId);
            if (session && !session.exited) session.pty.write(msg.data);
          }
          break;
        }

        case 'resize': {
          if (ptyReady && msg.cols && msg.rows) {
            const currentId = (ws as WebSocket & { _termId?: string })._termId ?? termId;
            resizePty(currentId, msg.cols, msg.rows);
          }
          break;
        }

        case 'close': {
          const currentId = (ws as WebSocket & { _termId?: string })._termId ?? termId;
          console.log(`[ws-term] Close requested for ${currentId}`);
          destroyPty(currentId);
          break;
        }
      }
    } catch (err) {
      console.error(`[ws-term] Message error:`, err);
    }
  });

  // On WebSocket close: DETACH (don't destroy). The PTY keeps running.
  // Read the current _termId rather than the captured `termId` so that PTY
  // renames (after session-id discovery) detach against the renamed key.
  ws.on('close', () => {
    const currentId = (ws as WebSocket & { _termId?: string })._termId ?? termId;
    console.log(`[ws-term] Terminal disconnected (detaching): ${currentId}`);
    detachWebSocket(currentId, ws);
  });

  ws.on('error', (err) => {
    const currentId = (ws as WebSocket & { _termId?: string })._termId ?? termId;
    console.error(`[ws-term] Terminal error (detaching ${currentId}):`, err);
    detachWebSocket(currentId, ws);
  });
});

// --- Broadcast state changes to all clients ---
aggregator.on('change', (type: WsMessageType) => {
  const state = aggregator.getState();

  let payload: unknown;
  switch (type) {
    case 'sessions_updated':
      payload = { sessions: state.sessions };
      break;
    case 'projects_updated':
      payload = { projects: state.projects };
      break;
    case 'teams_updated':
      payload = { teams: state.teams };
      break;
    case 'tasks_updated':
      payload = { tasksByTeam: state.tasksByTeam, tasksBySession: state.tasksBySession };
      break;
    case 'event_added':
      payload = { events: state.events.slice(0, 1) }; // Just the newest event
      break;
    case 'events_updated':
      payload = { events: state.events };
      break;
    case 'session_activities_updated':
      payload = { sessionActivities: state.sessionActivities };
      break;
    case 'queues_updated':
      payload = { queues: state.queues };
      break;
    case 'scheduled_tasks_updated':
      payload = { scheduledTasks: state.scheduledTasks };
      break;
    case 'schedules_updated':
    case 'schedule_run_update':
      payload = { schedules: state.schedules };
      break;
    case 'live_loops_updated':
      payload = { liveLoops: state.liveLoops };
      break;
    default:
      payload = state;
  }

  const message: WsMessage = {
    version: 1,
    type,
    payload,
  };

  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
});

// --- Route Handlers ---

function handleGetState(res: http.ServerResponse): void {
  const state = aggregator.getState();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(state));
}

function handlePostEvent(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      const event = processEvent(parsed);
      aggregator.addEvent(event);

      lastEventTimestamp = event.timestamp;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, eventId: event.id }));
    } catch (err) {
      console.error(`[api] Error processing event:`, err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid event data' }));
    }
  });
  req.on('error', (err) => {
    console.error(`[api] Request error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleGetEvents(res: http.ServerResponse): void {
  const state = aggregator.getState();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(state.events));
}

function handleHealth(res: http.ServerResponse): void {
  const health = {
    status: 'ok',
    uptime: process.uptime(),
    startedAt: serverStartTime,
    watchers: {
      claude: claudeWatcher.ready,
      session: sessionWatcher.ready,
    },
    connectedClients: wss.clients.size,
    lastEventTimestamp,
    projects: config.projects.map((p) => ({
      name: p.name,
      path: p.path,
    })),
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(health));
}

function handleFocusSession(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body) as { paneId?: string };
      if (!parsed.paneId || typeof parsed.paneId !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing paneId' }));
        return;
      }

      console.log(`[api] Focus request: paneId="${parsed.paneId}"`);
      focusPane(parsed.paneId).then((result) => {
        console.log(`[api] Focus result: paneId="${parsed.paneId}" ok=${result.ok} error=${result.error ?? 'none'}`);
        const status = result.ok ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }).catch((err) => {
        console.error(`[api] Focus pane error:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error' }));
      });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
  req.on('error', (err) => {
    console.error(`[api] Request error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleSendInput(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body) as Partial<SendInputRequest>;
      if (!parsed.paneId || typeof parsed.paneId !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing paneId' }));
        return;
      }
      if (!parsed.type || !['approve', 'reject', 'abort', 'text'].includes(parsed.type)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid type' }));
        return;
      }
      if (parsed.input === undefined || parsed.input === null || typeof parsed.input !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing input' }));
        return;
      }

      const request: SendInputRequest = {
        paneId: parsed.paneId,
        input: parsed.input,
        type: parsed.type,
      };

      sendInput(request, aggregator).then((result) => {
        const status = result.ok ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }).catch((err) => {
        console.error(`[api] Send input error:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error' }));
      });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
  req.on('error', (err) => {
    console.error(`[api] Request error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleDeleteTeam(teamName: string, res: http.ServerResponse): void {
  if (!teamName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing team name' }));
    return;
  }

  const result = deleteTeam(config.claudeHome, teamName);
  if (result.success) {
    aggregator.refreshTeams();
    aggregator.refreshTasks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: result.error }));
  }
}

function handleGetConfig(res: http.ServerResponse): void {
  const configResponse: Record<string, unknown> = {
    notifications: config.notifications,
    projectsRoot: config.projectsRoot,
    theme: config.theme,
    launchFlags: config.launchFlags ?? { autoMode: false, dangerouslySkipPermissions: false },
    aiProviders: config.aiProviders ?? { primary: 'claude', providers: { claude: { enabled: true } } },
    providerStatus: getAllProviderStatus(config),
    nav: config.nav ?? {},
  };
  if (config.projectRoots) {
    configResponse.projectRoots = config.projectRoots;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(configResponse));
}

function handlePatchConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;

      // Patch notifications if present
      if (parsed.notifications && typeof parsed.notifications === 'object') {
        const incoming = parsed.notifications as Record<string, unknown>;

        if ('macOS' in incoming && typeof incoming.macOS !== 'boolean') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'notifications.macOS must be a boolean' }));
          return;
        }
        if ('browser' in incoming && typeof incoming.browser !== 'boolean') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'notifications.browser must be a boolean' }));
          return;
        }

        config.notifications = {
          ...config.notifications,
          ...('macOS' in incoming ? { macOS: incoming.macOS as boolean } : {}),
          ...('browser' in incoming ? { browser: incoming.browser as boolean } : {}),
        };

        notifier.updateConfig(config.notifications);
      }

      // Patch projectsRoot if present
      if ('projectsRoot' in parsed) {
        if (typeof parsed.projectsRoot !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'projectsRoot must be a string' }));
          return;
        }
        config.projectsRoot = parsed.projectsRoot;
        // Ensure Generic folder exists
        if (parsed.projectsRoot) {
          const genericDir = path.join(parsed.projectsRoot, 'Generic');
          if (!fs.existsSync(genericDir)) {
            try { fs.mkdirSync(genericDir, { recursive: true }); } catch { /* ignore */ }
          }
        }
      }

      // Project folders define which sessions this install shows.
      if ('projectsRoot' in parsed || 'projectRoots' in parsed) aggregator.refreshSessions();

      // Patch theme if present
      if ('theme' in parsed) {
        if (parsed.theme !== 'dark' && parsed.theme !== 'light') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'theme must be "dark" or "light"' }));
          return;
        }
        config.theme = parsed.theme;
      }

      // Patch projectRoots
      if ('projectRoots' in parsed) {
        if (Array.isArray(parsed.projectRoots)) {
          config.projectRoots = parsed.projectRoots as string[];
        }
      }

      // Patch launchFlags if present
      if ('launchFlags' in parsed) {
        if (parsed.launchFlags !== null && typeof parsed.launchFlags === 'object') {
          const incoming = parsed.launchFlags as Record<string, unknown>;
          const existing = config.launchFlags ?? { autoMode: false, dangerouslySkipPermissions: false };
          config.launchFlags = {
            autoMode: typeof incoming.autoMode === 'boolean' ? incoming.autoMode : existing.autoMode,
            dangerouslySkipPermissions: typeof incoming.dangerouslySkipPermissions === 'boolean' ? incoming.dangerouslySkipPermissions : existing.dangerouslySkipPermissions,
          };
        }
      }

      // Patch aiProviders if present
      if ('aiProviders' in parsed) {
        if (parsed.aiProviders !== null && typeof parsed.aiProviders === 'object') {
          const incoming = parsed.aiProviders as ProvidersConfig;
          const validIds: ProviderId[] = ['claude', 'gemini', 'codex'];

          // Validate primary is a valid provider ID
          if (incoming.primary && !validIds.includes(incoming.primary)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Invalid primary provider: ${incoming.primary}` }));
            return;
          }

          // Validate primary is enabled
          if (incoming.primary && incoming.providers && !incoming.providers[incoming.primary]?.enabled) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Primary provider must be enabled' }));
            return;
          }

          // Validate at least one provider is enabled
          if (incoming.providers) {
            const anyEnabled = Object.values(incoming.providers).some(p => p?.enabled);
            if (!anyEnabled) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'At least one provider must be enabled' }));
              return;
            }
          }

          config.aiProviders = {
            primary: incoming.primary ?? config.aiProviders?.primary ?? 'claude',
            providers: incoming.providers ?? config.aiProviders?.providers ?? { claude: { enabled: true } },
          };
        }
      }

      // Patch nav preferences if present (shallow read-then-merge so partial
      // updates don't wipe other nav fields)
      if ('nav' in parsed) {
        if (parsed.nav !== null && typeof parsed.nav === 'object') {
          config.nav = { ...(config.nav ?? {}), ...(parsed.nav as Record<string, unknown>) };
        }
      }

      // Persist to disk
      saveConfig(config);

      // Broadcast config_updated via WebSocket
      const message: WsMessage = {
        version: 1,
        type: 'config_updated',
        payload: {
          notifications: config.notifications,
          projectsRoot: config.projectsRoot,
          theme: config.theme,
          launchFlags: config.launchFlags ?? { autoMode: false, dangerouslySkipPermissions: false },
          aiProviders: config.aiProviders ?? { primary: 'claude', providers: { claude: { enabled: true } } },
          providerStatus: getAllProviderStatus(config),
        },
      };
      const data = JSON.stringify(message);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        notifications: config.notifications,
        projectsRoot: config.projectsRoot,
        theme: config.theme,
        launchFlags: config.launchFlags ?? { autoMode: false, dangerouslySkipPermissions: false },
        aiProviders: config.aiProviders ?? { primary: 'claude', providers: { claude: { enabled: true } } },
        providerStatus: getAllProviderStatus(config),
        nav: config.nav ?? {},
      }));
    } catch (err) {
      console.error(`[api] Error patching config:`, err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
  req.on('error', (err) => {
    console.error(`[api] Request error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

// --- Session Transcript Handler ---

function handleGetTranscript(sessionId: string, res: http.ServerResponse): void {
  const filePath = aggregator.getSessionFilePath(sessionId);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const messages: Array<{
      role: string;
      type: string;
      content: unknown;
      timestamp: string;
      model?: string;
      toolName?: string;
      toolId?: string;
    }> = [];

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (!entry.type || !entry.message) continue;

        const msg = entry.message;
        if (entry.type === 'user' && msg.role === 'user') {
          // User message - content can be string or array
          let text = '';
          if (typeof msg.content === 'string') {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            text = msg.content
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text: string }) => b.text)
              .join('\n');
          }
          // Skip system/warmup messages
          if (text === 'Warmup' || text.startsWith('<system-reminder>')) continue;
          messages.push({
            role: 'user',
            type: 'text',
            content: text,
            timestamp: entry.timestamp ?? '',
          });
        } else if (entry.type === 'assistant' && msg.role === 'assistant') {
          if (!Array.isArray(msg.content)) continue;
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              messages.push({
                role: 'assistant',
                type: 'text',
                content: block.text,
                timestamp: entry.timestamp ?? '',
                model: msg.model,
              });
            } else if (block.type === 'tool_use') {
              messages.push({
                role: 'assistant',
                type: 'tool_use',
                content: block.input,
                timestamp: entry.timestamp ?? '',
                toolName: block.name,
                toolId: block.id,
              });
            } else if (block.type === 'tool_result') {
              let resultText = '';
              if (typeof block.content === 'string') {
                resultText = block.content;
              } else if (Array.isArray(block.content)) {
                resultText = block.content
                  .filter((b: { type: string }) => b.type === 'text')
                  .map((b: { text: string }) => b.text)
                  .join('\n');
              }
              messages.push({
                role: 'tool',
                type: 'tool_result',
                content: resultText,
                timestamp: entry.timestamp ?? '',
                toolId: block.tool_use_id,
              });
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessionId, messages }));
  } catch (err) {
    console.error(`[api] Error reading transcript for ${sessionId}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to read session file' }));
  }
}

// --- Transcript Markdown Handler (for session handoff) ---

function handleGetTranscriptMarkdown(sessionId: string, res: http.ServerResponse): void {
  const filePath = aggregator.getSessionFilePath(sessionId);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines: string[] = [];
    let provider: ProviderId = 'claude';
    let project = '';

    // Determine provider from session state
    const sessions = aggregator.getState().sessions;
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      provider = session.provider ?? 'claude';
      project = session.project ?? '';
    }

    const providerObj = getProvider(provider);

    lines.push('# Session Transcript');
    lines.push(`**Provider:** ${providerObj.displayName}`);
    if (project) lines.push(`**Project:** ${project}`);
    lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
    lines.push('');

    if (provider === 'gemini') {
      // Gemini: single JSON file with messages array
      try {
        const geminiSession = JSON.parse(raw) as { messages?: Array<{ type: string; content?: string | Array<{ text?: string }>; toolCalls?: Array<{ name: string; args?: Record<string, unknown> }> }> };
        for (const msg of geminiSession.messages ?? []) {
          if (msg.type === 'user') {
            let text = '';
            if (typeof msg.content === 'string') {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              text = msg.content.map((p: { text?: string }) => p.text ?? '').filter(Boolean).join('\n');
            }
            if (text) {
              lines.push('## User');
              lines.push(text);
              lines.push('');
            }
          } else if (msg.type === 'gemini') {
            let text = '';
            if (typeof msg.content === 'string') {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              text = msg.content.map((p: { text?: string }) => p.text ?? '').filter(Boolean).join('\n');
            }
            if (text) {
              lines.push('## Assistant');
              lines.push(text);
              lines.push('');
            }
            // Include tool call info
            if (msg.toolCalls) {
              for (const tc of msg.toolCalls) {
                lines.push(`*Tool: ${tc.name}*`);
                lines.push('');
              }
            }
          }
        }
      } catch {
        lines.push('*Unable to parse Gemini session transcript*');
      }
    } else {
      // Claude/Codex: JSONL format (one JSON object per line)
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (!entry.type || !entry.message) continue;

          const msg = entry.message;
          if (entry.type === 'user' && msg.role === 'user') {
            let text = '';
            if (typeof msg.content === 'string') {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              text = msg.content
                .filter((b: { type: string }) => b.type === 'text')
                .map((b: { text: string }) => b.text)
                .join('\n');
            }
            if (text === 'Warmup' || text.startsWith('<system-reminder>')) continue;
            lines.push('## User');
            lines.push(text);
            lines.push('');
          } else if (entry.type === 'assistant' && msg.role === 'assistant') {
            if (!Array.isArray(msg.content)) continue;
            for (const block of msg.content) {
              if (block.type === 'text' && block.text) {
                lines.push('## Assistant');
                lines.push(block.text);
                lines.push('');
              }
            }
          }
        } catch { /* skip malformed lines */ }
      }
    }

    const markdown = lines.join('\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ markdown, provider, sessionId }));
  } catch (err) {
    console.error(`[api] Error reading transcript markdown for ${sessionId}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to read session file' }));
  }
}

function handleCreateTranscriptFile(sessionId: string, res: http.ServerResponse): void {
  // First get the markdown transcript
  const filePath = aggregator.getSessionFilePath(sessionId);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  try {
    // Build a fake response to capture the markdown
    let markdownContent = '';
    const fakeRes = {
      writeHead: () => {},
      end: (data: string) => {
        try {
          const parsed = JSON.parse(data);
          markdownContent = parsed.markdown ?? '';
        } catch { /* ignore */ }
      },
    } as unknown as http.ServerResponse;
    handleGetTranscriptMarkdown(sessionId, fakeRes);

    if (!markdownContent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Empty transcript' }));
      return;
    }

    // Save transcript inside the session's project directory so sandboxed CLIs
    // (Gemini, Codex) can read it. Falls back to os.tmpdir() if no cwd is available.
    const session = aggregator.getState().sessions.find(s => s.id === sessionId);
    const projectRoot = session?.cwd || session?.projectDir;
    const saveDir = projectRoot
      ? path.join(projectRoot, '.hive')
      : path.join(os.tmpdir(), 'hive-transcripts');
    fs.mkdirSync(saveDir, { recursive: true });

    // Auto-add .hive/ to the project's .gitignore if not already present
    if (projectRoot) {
      try {
        const gitignorePath = path.join(projectRoot, '.gitignore');
        const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
        if (!existing.split(/\r?\n/).some(line => line.trim() === '.hive' || line.trim() === '.hive/')) {
          const newline = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
          fs.appendFileSync(gitignorePath, `${newline}.hive/\n`);
        }
      } catch { /* non-critical */ }
    }

    const tmpFile = path.join(saveDir, `transcript-${sessionId.slice(0, 8)}-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, markdownContent, 'utf-8');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ filePath: tmpFile, size: markdownContent.length }));
  } catch (err) {
    console.error(`[api] Error creating transcript file for ${sessionId}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to create transcript file' }));
  }
}

// --- Insights Handlers ---

function handleInsightsStats(res: http.ServerResponse): void {
  // Claude Code's stats-cache.json is machine-wide; with project folders
  // configured, compute the same numbers from in-scope sessions only.
  if (hasProjectScope(config)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(computeScopedStats(config)));
    return;
  }
  const statsPath = path.join(config.claudeHome, 'stats-cache.json');
  try {
    const data = fs.readFileSync(statsPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(null));
  }
}

function handleInsightsHistory(res: http.ServerResponse): void {
  const entries: Array<{ display: string; timestamp: number; project: string; sessionId: string; provider?: string }> = [];

  // 1. Claude history from history.jsonl
  const historyPath = path.join(config.claudeHome, 'history.jsonl');
  try {
    const raw = fs.readFileSync(historyPath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        // Prompt text is the most sensitive thing on this page — never surface
        // it for an incognito project or session.
        if (isIncognitoProjectPath(parsed.project) || isIncognitoId(parsed.sessionId)) continue;
        if (!isPathInScope(config, parsed.project)) continue;
        entries.push({
          display: parsed.display,
          timestamp: parsed.timestamp,
          project: parsed.project,
          sessionId: parsed.sessionId,
          provider: 'claude',
        });
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file doesn't exist or unreadable */ }

  // 2. Non-Claude sessions from aggregator (Gemini, Codex, etc.)
  const state = aggregator.getState();
  for (const session of state.sessions) {
    if (!session.provider || session.provider === 'claude') continue;
    if (session.isSubagent) continue;
    if (!session.initialPrompt && !session.latestPrompt) continue;
    if (session.incognito) continue;
    entries.push({
      display: session.initialPrompt ?? session.latestPrompt ?? '',
      timestamp: new Date(session.lastActivity).getTime(),
      project: session.cwd ?? session.projectDir ?? session.project,
      sessionId: session.id,
      provider: session.provider,
    });
  }

  // Sort newest first
  entries.sort((a, b) => b.timestamp - a.timestamp);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(entries));
}

function handleInsightsPlans(res: http.ServerResponse): void {
  const plansDir = path.join(config.claudeHome, 'plans');
  try {
    // Plans live in one machine-wide folder; keep those written by sessions
    // in this install's project folders.
    const inScope = hasProjectScope(config) ? scopedPlanSlugs(config) : null;
    const files = fs.readdirSync(plansDir).filter((f) => f.endsWith('.md') && (!inScope || inScope.has(f.slice(0, -3))));
    const plans = files.map((filename) => {
      const filePath = path.join(plansDir, filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      const stat = fs.statSync(filePath);
      const slug = filename.replace(/\.md$/, '');
      // Extract title from first heading or use slug
      const titleMatch = content.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1].trim() : slug;
      return { slug, title, content, modifiedAt: stat.mtime.toISOString(), filePath };
    });
    // Sort by most recently modified
    plans.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(plans));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
  }
}

// --- Developer Insights ---

let developerStatsCache: { data: unknown; ts: number } | null = null;

function handleDeveloperStats(url: URL, res: http.ServerResponse): void {
  const period = url.searchParams.get('period') || '7d';

  // Cache for 60s
  if (developerStatsCache && Date.now() - developerStatsCache.ts < 60_000) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(developerStatsCache.data));
    return;
  }

  (async () => {
    try {
      const result = await buildDeveloperStats(period);
      developerStatsCache = { data: result, ts: Date.now() };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  })();
}

async function buildDeveloperStats(period: string) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const sinceArg = period === '30d' ? '30 days ago' : period === 'all' ? '365 days ago' : '7 days ago';

  // 1. Parse history.jsonl for project activity
  const historyPath = path.join(config.claudeHome, 'history.jsonl');
  let entries: { display: string; timestamp: number; project: string; sessionId: string }[] = [];
  try {
    const raw = fs.readFileSync(historyPath, 'utf-8');
    entries = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      // Incognito projects are absent from the leaderboard, the streaks, the
      // peak-hour histogram — from every number this endpoint produces.
      .filter((e) => !isIncognitoProjectPath(e.project) && !isIncognitoId(e.sessionId))
      .filter((e) => isPathInScope(config, e.project));
  } catch { /* no history */ }

  // Group by project
  const projectMap = new Map<string, { sessions: Set<string>; sessionsWeek: Set<string>; sessionsToday: Set<string>; lastActive: number; promptCount: number }>();
  const daySet = new Set<string>();

  for (const entry of entries) {
    const proj = entry.project || 'Unknown';
    const ts = entry.timestamp;
    const dateStr = new Date(ts).toISOString().slice(0, 10);
    daySet.add(dateStr);

    if (!projectMap.has(proj)) {
      projectMap.set(proj, { sessions: new Set(), sessionsWeek: new Set(), sessionsToday: new Set(), lastActive: 0, promptCount: 0 });
    }
    const p = projectMap.get(proj)!;
    p.sessions.add(entry.sessionId);
    p.promptCount++;
    if (ts > p.lastActive) p.lastActive = ts;
    if (new Date(ts) >= weekAgo) p.sessionsWeek.add(entry.sessionId);
    if (dateStr === todayStr) p.sessionsToday.add(entry.sessionId);
  }

  const projectActivity = Array.from(projectMap.entries())
    .map(([project, p]) => ({
      project,
      sessionsTotal: p.sessions.size,
      sessionsThisWeek: p.sessionsWeek.size,
      sessionsToday: p.sessionsToday.size,
      lastActive: new Date(p.lastActive).toISOString(),
      promptCount: p.promptCount,
    }))
    .sort((a, b) => b.sessionsTotal - a.sessionsTotal);

  // 2. Git stats per project from aggregator state
  const state = aggregator.getState();
  const gitStats: { project: string; projectDir: string; linesAdded: number; linesDeleted: number; commits: number; period: string }[] = [];
  const seenDirs = new Set<string>();

  for (const session of state.sessions) {
    if (!session.projectDir || seenDirs.has(session.projectDir)) continue;
    seenDirs.add(session.projectDir);

    // Resolve actual dir from encoded path
    let dir = session.projectDir;
    if (isWindows) {
      const decoded = decodeWindowsProjectDir(dir);
      if (decoded) dir = decoded;
    }

    if (isIncognitoProjectPath(dir, session.cwd)) continue;
    if (!fs.existsSync(path.join(dir, '.git'))) continue;

    try {
      const gitOut = execSync(
        `git log --shortstat --since="${sinceArg}" --format="" -- .`,
        { cwd: dir, timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );

      let added = 0, deleted = 0, commits = 0;
      for (const line of gitOut.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        commits++;
        const addMatch = trimmed.match(/(\d+) insertion/);
        const delMatch = trimmed.match(/(\d+) deletion/);
        if (addMatch) added += parseInt(addMatch[1], 10);
        if (delMatch) deleted += parseInt(delMatch[1], 10);
      }

      if (commits > 0) {
        gitStats.push({
          project: session.project,
          projectDir: dir,
          linesAdded: added,
          linesDeleted: deleted,
          commits,
          period: period === '30d' ? '30d' : '7d',
        });
      }
    } catch { /* git not available or error */ }
  }

  // 3. Ticket stats — populated by the tracker integration once connected.
  const ticketStats: { configured: boolean; activeTickets: number; completedThisSprint: number; inProgress: number; testing: number } | null = null;

  // 4. KB stats (if configured)
  let kbStats: { configured: boolean; totalEntries: number; recentEntries: { title: string; category: string; created_at: string }[]; categoryCounts: Record<string, number> } | null = null;
  try {
    const { loadKBConfig, getKBScopeOwner } = await import('./kb/env.js');
    const kbConfig = loadKBConfig();
    if (kbConfig) {
      const { KBClient } = await import('./kb/client.js');
      const client = new KBClient(kbConfig);
      const scopeOwner = getKBScopeOwner();
      const allEntries = await client.search('', undefined, undefined, scopeOwner);

      const categoryCounts: Record<string, number> = {};
      for (const entry of allEntries) {
        const cat = entry.category || 'Uncategorized';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }

      const recentEntries = allEntries
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
        .map((e: any) => ({ title: e.title, category: e.category || 'Uncategorized', created_at: e.created_at }));

      kbStats = { configured: true, totalEntries: allEntries.length, recentEntries, categoryCounts };
    }
  } catch { /* KB not configured */ }

  // 5. Streaks & highlights
  const sortedDays = Array.from(daySet).sort();
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  for (let i = sortedDays.length - 1; i >= 0; i--) {
    const dayDate = new Date(sortedDays[i]);
    const prevDate = i > 0 ? new Date(sortedDays[i - 1]) : null;

    if (i === sortedDays.length - 1) {
      // Check if most recent day is today or yesterday
      const diffFromToday = Math.floor((now.getTime() - dayDate.getTime()) / 86_400_000);
      if (diffFromToday <= 1) {
        tempStreak = 1;
      } else {
        break;
      }
    } else if (prevDate) {
      const diff = Math.floor((dayDate.getTime() - prevDate.getTime()) / 86_400_000);
      if (diff === 1) {
        tempStreak++;
      } else {
        break;
      }
    }
  }
  currentStreak = tempStreak;

  // Calculate longest streak
  tempStreak = 1;
  longestStreak = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    const diff = Math.floor((new Date(sortedDays[i]).getTime() - new Date(sortedDays[i - 1]).getTime()) / 86_400_000);
    if (diff === 1) {
      tempStreak++;
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    } else {
      tempStreak = 1;
    }
  }
  if (sortedDays.length === 0) { longestStreak = 0; currentStreak = 0; }

  // Most active project
  const mostActiveProject = projectActivity.length > 0 ? projectActivity[0].project : 'None';

  // Day of week distribution
  const dayCounts: Record<string, number> = {};
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const entry of entries) {
    const day = dayNames[new Date(entry.timestamp).getDay()];
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  }
  const mostActiveDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  // Peak hour
  const hourCounts: Record<number, number> = {};
  for (const entry of entries) {
    const hour = new Date(entry.timestamp).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }
  const peakHour = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([h]) => parseInt(h, 10))[0] ?? 14;

  return {
    projectActivity,
    gitStats,
    ticketStats,
    kbStats,
    currentStreak,
    longestStreak,
    mostActiveProject,
    mostActiveDay,
    peakHour,
    totalDaysActive: daySet.size,
  };
}

// --- Queue Route Handlers ---

// Re-use shared readBody
const readBody = sharedReadBody;

function ensureHookRegistered(
  hooks: Record<string, unknown>,
  hookName: 'Stop' | 'UserPromptSubmit',
  pathSuffix: string,
): boolean {
  const hookEntry = {
    type: 'http' as const,
    url: `http://localhost:${PORT}${pathSuffix}`,
    timeout: 5000,
  };

  if (Array.isArray(hooks[hookName])) {
    const existing = hooks[hookName] as Array<{ matcher: string; hooks: Array<unknown> }>;
    const alreadyExists = existing.some((entry) =>
      Array.isArray(entry.hooks) && entry.hooks.some((h: unknown) => {
        if (typeof h === 'string') return h.includes(pathSuffix);
        if (typeof h === 'object' && h !== null) return (h as Record<string, unknown>).url?.toString().includes(pathSuffix);
        return false;
      })
    );
    if (alreadyExists) return false;
    existing.push({ matcher: '', hooks: [hookEntry] });
  } else {
    hooks[hookName] = [{ matcher: '', hooks: [hookEntry] }];
  }
  return true;
}

function configureClaudeHooks(): { added: string[]; alreadyConfigured: boolean; error?: string } {
  const settingsPath = path.join(config.claudeHome, 'settings.json');
  try {
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }

    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {};
    }
    const hooks = settings.hooks as Record<string, unknown>;

    const stopAdded = ensureHookRegistered(hooks, 'Stop', '/api/hooks/stop');
    const promptAdded = ensureHookRegistered(hooks, 'UserPromptSubmit', '/api/hooks/user-prompt-submit');

    if (!stopAdded && !promptAdded) {
      return { added: [], alreadyConfigured: true };
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    const added: string[] = [];
    if (stopAdded) added.push('Stop');
    if (promptAdded) added.push('UserPromptSubmit');
    return { added, alreadyConfigured: false };
  } catch (err) {
    return { added: [], alreadyConfigured: false, error: (err as Error).message };
  }
}

function handleSetupHook(res: http.ServerResponse): void {
  const result = configureClaudeHooks();
  if (result.error) {
    console.error(`[hooks] Error setting up hook:`, result.error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Failed to configure hook' }));
    return;
  }
  if (result.alreadyConfigured) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Hooks already configured' }));
    return;
  }
  console.log(`[hooks] Configured ${result.added.join(', ')} in ${path.join(config.claudeHome, 'settings.json')}`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, message: `Configured: ${result.added.join(', ')}` }));
}

function handleUserPromptSubmitHook(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    res.writeHead(200);
    res.end();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return;
    }

    const sessionId =
      (typeof parsed.session_id === 'string' && parsed.session_id) ||
      (typeof parsed.SESSION_ID === 'string' && parsed.SESSION_ID) ||
      (typeof parsed.sessionId === 'string' && parsed.sessionId) ||
      null;
    if (!sessionId) return;

    const cwd =
      (typeof parsed.cwd === 'string' && parsed.cwd) ||
      (typeof parsed.CWD === 'string' && parsed.CWD) ||
      '';
    const project = cwd ? (cwd.split(/[\\/]/).pop() || cwd) : 'unknown';

    try {
      turnTracker.startTurn(sessionId, project, cwd || null);
    } catch (err) {
      console.error('[hooks] turnTracker.startTurn failed:', err);
    }
  }).catch((err) => {
    console.error('[api] UserPromptSubmit hook body read error:', err);
    if (!res.headersSent) {
      res.writeHead(200);
      res.end();
    }
  });
}

function handleStopHook(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Return empty 200 — don't block Claude even on bad input
      res.writeHead(200);
      res.end();
      return;
    }

    const payload = parseStopHookPayload(parsed);
    if (!payload) {
      // Return empty 200 — Claude Code treats non-2xx as hook failure
      console.log(`[hooks] Stop hook received but could not parse session_id`);
      res.writeHead(200);
      res.end();
      return;
    }

    // Respond immediately with empty 200 — Claude Code expects fast responses
    // and may report "hook failed" if the response takes too long or has unexpected JSON
    res.writeHead(200);
    res.end();

    // Process asynchronously after response is sent
    console.log(`[hooks] Stop hook fired for session ${payload.session_id}`);

    // Close the active turn so its duration lands in turn_blocks
    try {
      turnTracker.endTurn(payload.session_id);
    } catch (err) {
      console.error(`[hooks] turnTracker.endTurn failed:`, err);
    }

    try {
      const event = {
        id: crypto.randomUUID(),
        type: 'turn_end',
        sessionId: payload.session_id,
        timestamp: new Date().toISOString(),
        message: 'Claude finished responding',
        project: undefined,
      };
      insertEvent(event);
      aggregator.addEvent(event);

      // Feed the queue engine (completes current task, dispatches next)
      queueEngine.handleStopHook(payload);
    } catch (err) {
      console.error(`[hooks] Error processing stop hook:`, err);
    }

    // Scan transcript for architectural decisions (async, non-blocking)
    const transcriptPath = payload.transcript_path ?? aggregator.getSessionFilePath(payload.session_id);
    // Incognito sessions are never mined for shared Knowledge Base entries —
    // the auto-capture below embeds verbatim excerpts of the prompt and reply.
    if (transcriptPath && !isIncognitoSession(payload.session_id, payload.cwd)) {
      (async () => {
        try {
          const { loadKBConfig } = await import('./kb/env.js');
          const kbConfig = loadKBConfig();
          if (!kbConfig) return;

          const projectName = payload.cwd?.split(/[\\/]/).pop();

          // Cheap regex pass (always) + LLM pass (throttled, only if Azure
          // OpenAI is configured) — see hooks/knowledge-extractor.ts.
          const { extractKnowledge } = await import('./hooks/knowledge-extractor.js');
          const [regexEntries, llmEntries] = await Promise.all([
            Promise.resolve(scanTranscriptForDecisions(transcriptPath, payload.session_id, projectName)),
            extractKnowledge(transcriptPath, payload.session_id, projectName, Date.now()),
          ]);
          const entries = [...regexEntries, ...llmEntries];
          if (entries.length === 0) return;

          const { KBClient } = await import('./kb/client.js');
          const client = new KBClient(kbConfig);
          for (const entry of entries) {
            await client.create(entry);
            console.log(`[knowledge-capture] Saved ${entry.category}: ${entry.title}`);
          }
          await client.close();
        } catch (err) {
          console.error(`[knowledge-capture] Failed to save entries:`, err);
        }
      })();
    }
  }).catch((err) => {
    console.error(`[api] Stop hook body read error:`, err);
    // Still return 200 to avoid Claude Code reporting hook failure
    if (!res.headersSent) {
      res.writeHead(200);
      res.end();
    }
  });
}

function handleGetQueue(sessionId: string, res: http.ServerResponse): void {
  const queue = getTaskQueue(sessionId);
  if (!queue) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ queue: null, tasks: [] }));
    return;
  }
  const tasks = getQueueTasks(sessionId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ queue, tasks }));
}

function handleCreateQueue(sessionId: string, res: http.ServerResponse): void {
  const queue = upsertTaskQueue(sessionId);
  const tasks = getQueueTasks(sessionId);

  // Broadcast update
  const queuesState = queueEngine.getQueuesState();
  aggregator.refreshQueues(queuesState);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ queue, tasks }));
}

function handlePatchQueue(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { paused?: boolean };
      if (typeof parsed.paused !== 'boolean') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid paused field' }));
        return;
      }

      updateTaskQueuePaused(sessionId, parsed.paused);

      // Broadcast update
      const queuesState = queueEngine.getQueuesState();
      aggregator.refreshQueues(queuesState);

      // If unpausing, try to dispatch
      if (!parsed.paused) {
        queueEngine.tryDispatchIfIdle(sessionId);
      }

      const queue = getTaskQueue(sessionId);
      const tasks = getQueueTasks(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ queue, tasks }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch((err) => {
    console.error(`[api] Patch queue error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleAddQueueTask(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { prompt?: string };
      if (!parsed.prompt || typeof parsed.prompt !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid prompt' }));
        return;
      }

      const task = insertQueueTask(sessionId, parsed.prompt.trim());

      // Broadcast update
      const queuesState = queueEngine.getQueuesState();
      aggregator.refreshQueues(queuesState);

      // Try to dispatch if session is idle
      queueEngine.tryDispatchIfIdle(sessionId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch((err) => {
    console.error(`[api] Add queue task error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleReorderQueue(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { taskIds?: string[] };
      if (!Array.isArray(parsed.taskIds)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid taskIds array' }));
        return;
      }

      reorderQueueTasks(sessionId, parsed.taskIds);

      // Broadcast update
      const queuesState = queueEngine.getQueuesState();
      aggregator.refreshQueues(queuesState);

      const tasks = getQueueTasks(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tasks }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch((err) => {
    console.error(`[api] Reorder queue error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleClearCompleted(sessionId: string, res: http.ServerResponse): void {
  clearCompletedTasks(sessionId);

  // Broadcast update
  const queuesState = queueEngine.getQueuesState();
  aggregator.refreshQueues(queuesState);

  const tasks = getQueueTasks(sessionId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ tasks }));
}

function handleUpdateQueueTask(taskId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { prompt?: string; status?: string };

      const updates: Parameters<typeof updateQueueTask>[1] = {};
      if (typeof parsed.prompt === 'string') updates.prompt = parsed.prompt;
      if (typeof parsed.status === 'string') {
        updates.status = parsed.status as 'pending' | 'sending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
        if (parsed.status === 'completed' || parsed.status === 'failed' || parsed.status === 'skipped') {
          updates.completedAt = new Date().toISOString();
        }
      }

      updateQueueTask(taskId, updates);

      // Broadcast update
      const queuesState = queueEngine.getQueuesState();
      aggregator.refreshQueues(queuesState);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch((err) => {
    console.error(`[api] Update queue task error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleDeleteQueueTask(taskId: string, res: http.ServerResponse): void {
  const sessionId = deleteQueueTask(taskId);
  if (!sessionId) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Task not found' }));
    return;
  }

  // Broadcast update
  const queuesState = queueEngine.getQueuesState();
  aggregator.refreshQueues(queuesState);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// --- Projects API Handlers ---

function decodeProjectDirName(encoded: string): string {
  if (isWindows) return decodeWindowsProjectDir(encoded);
  // macOS/Linux: dashes become path separators, leading - becomes /
  return '/' + encoded.replace(/-/g, '/');
}

function getProjectMeta(projectPath: string, encodedDir?: string) {
  const instructionFiles: Record<string, boolean> = {};
  for (const [providerId, info] of Object.entries(INSTRUCTION_FILES)) {
    instructionFiles[providerId] = fs.existsSync(path.join(projectPath, info.filename)) ||
      (info.subdir ? fs.existsSync(path.join(projectPath, info.subdir, info.filename)) : false);
  }
  const hasCLAUDEmd = instructionFiles['claude'] ?? false; // backward compat
  const hasGit = fs.existsSync(path.join(projectPath, '.git'));

  let gitBranch: string | undefined;
  if (hasGit) {
    try {
      const headFile = path.join(projectPath, '.git', 'HEAD');
      const head = fs.readFileSync(headFile, 'utf-8').trim();
      const branchMatch = head.match(/ref: refs\/heads\/(.+)/);
      gitBranch = branchMatch ? branchMatch[1] : head.slice(0, 8);
    } catch { /* ignore */ }
  }

  // Count sessions from live aggregator state
  const state = aggregator.getState();
  const liveSessions = state.sessions.filter(
    (s) => s.cwd === projectPath || s.projectDir === projectPath
  );
  let sessionCount = liveSessions.length;

  // Also count JSONL files in the encoded project dir for total session history
  let totalSessions = sessionCount;
  if (encodedDir) {
    const claudeProjectDir = path.join(config.claudeHome, 'projects', encodedDir);
    try {
      const files = fs.readdirSync(claudeProjectDir);
      totalSessions = files.filter((f) => f.endsWith('.jsonl')).length;
    } catch { /* ignore */ }
  }

  // Find latest activity from live sessions or from file mtime
  let lastActivity: string | undefined;
  if (liveSessions.length > 0) {
    lastActivity = liveSessions.reduce((a, b) => a.lastActivity > b.lastActivity ? a : b).lastActivity;
  } else if (encodedDir) {
    // Fall back to most recent JSONL file mtime
    const claudeProjectDir = path.join(config.claudeHome, 'projects', encodedDir);
    try {
      const files = fs.readdirSync(claudeProjectDir).filter((f) => f.endsWith('.jsonl'));
      let latestMtime = 0;
      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(claudeProjectDir, f));
          if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
        } catch { /* ignore */ }
      }
      if (latestMtime > 0) lastActivity = new Date(latestMtime).toISOString();
    } catch { /* ignore */ }
  }

  return { hasCLAUDEmd, instructionFiles, hasGit, gitBranch, sessionCount, totalSessions, lastActivity };
}

function handleGetProjects(res: http.ServerResponse): void {
  const projectMap = new Map<string, {
    name: string;
    path: string;
    encodedDir?: string;
    hasCLAUDEmd: boolean;
    instructionFiles: Record<string, boolean>;
    hasGit: boolean;
    gitBranch?: string;
    sessionCount: number;
    totalSessions: number;
    lastActivity?: string;
  }>();

  // 1. Discover projects from ~/.claude/projects/ (encoded directory names)
  const claudeProjectsDir = path.join(config.claudeHome, 'projects');
  if (fs.existsSync(claudeProjectsDir)) {
    try {
      const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const decoded = decodeProjectDirName(entry.name);
        // Only include projects whose path actually exists on disk and that
        // live inside this install's configured project folders.
        if (!fs.existsSync(decoded)) continue;
        if (!isPathInScope(config, decoded)) continue;

        // Use the last path segment as the display name
        const name = path.basename(decoded);
        const meta = getProjectMeta(decoded, entry.name);

        // Deduplicate by normalized path
        const normPath = decoded.replace(/\\/g, '/').toLowerCase();
        if (!projectMap.has(normPath)) {
          projectMap.set(normPath, {
            name,
            path: decoded,
            encodedDir: entry.name,
            ...meta,
          });
        }
      }
    } catch (err) {
      console.error(`[api] Error scanning ~/.claude/projects:`, err);
    }
  }

  // 2. Also include projects from projectsRoot if configured
  const root = config.projectsRoot;
  if (root && fs.existsSync(root)) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const projectPath = path.join(root, entry.name);
        const normPath = projectPath.replace(/\\/g, '/').toLowerCase();
        if (projectMap.has(normPath)) continue; // already discovered from ~/.claude/projects

        const meta = getProjectMeta(projectPath);
        projectMap.set(normPath, {
          name: entry.name,
          path: projectPath,
          ...meta,
        });
      }
    } catch (err) {
      console.error(`[api] Error listing projectsRoot:`, err);
    }
  }

  const projects = Array.from(projectMap.values());

  // Sort by last activity (most recent first), then by name
  projects.sort((a, b) => {
    if (a.lastActivity && b.lastActivity) return b.lastActivity.localeCompare(a.lastActivity);
    if (a.lastActivity) return -1;
    if (b.lastActivity) return 1;
    return a.name.localeCompare(b.name);
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(projects));
}

function handleCreateProject(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as {
        name?: string;
        existingPath?: string;
        initGit?: boolean;
        claudeMdContent?: string;
      };

      let projectPath: string;
      const useExisting = typeof parsed.existingPath === 'string' && parsed.existingPath.trim().length > 0;

      if (useExisting) {
        const raw = parsed.existingPath!.trim();
        projectPath = path.resolve(raw);
        if (!fs.existsSync(projectPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Folder does not exist' }));
          return;
        }
        if (!fs.statSync(projectPath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path is not a directory' }));
          return;
        }
      } else {
        if (!parsed.name || typeof parsed.name !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing project name' }));
          return;
        }

        const root = config.projectsRoot;
        if (!root) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No projectsRoot configured. Set it in Settings.' }));
          return;
        }

        projectPath = path.join(root, parsed.name);
        if (fs.existsSync(projectPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project directory already exists' }));
          return;
        }

        fs.mkdirSync(projectPath, { recursive: true });
      }

      if (parsed.initGit && !fs.existsSync(path.join(projectPath, '.git'))) {
        try {
          execSync('git init', { cwd: projectPath, stdio: 'pipe' });
        } catch (err) {
          console.error(`[api] git init failed:`, err);
        }
      }

      if (parsed.claudeMdContent) {
        const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
        if (!useExisting || !fs.existsSync(claudeMdPath)) {
          fs.writeFileSync(claudeMdPath, parsed.claudeMdContent, 'utf-8');
        }
      }

      // Register the folder under ~/.claude/projects/ so it shows up in the project list,
      // even when the folder lives outside projectsRoot.
      if (useExisting) {
        try {
          const encoded = projectPath.replace(/\\/g, '-').replace(/\//g, '-').replace(/:/g, '-');
          const claudeProjectsDir = path.join(config.claudeHome, 'projects', encoded);
          fs.mkdirSync(claudeProjectsDir, { recursive: true });
        } catch (err) {
          console.error(`[api] Failed to register project in ~/.claude/projects:`, err);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: projectPath }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch((err) => {
    console.error(`[api] Create project error:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

// --- Instruction File API Handlers (provider-agnostic) ---

function handleGetInstructions(projectPath: string, provider: string, res: http.ServerResponse): void {
  const info = INSTRUCTION_FILES[provider];
  if (!info) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown provider: ${provider}` }));
    return;
  }

  // Build candidate paths: project root first, then subdir (if defined, e.g. .claude/)
  const candidates = [path.join(projectPath, info.filename)];
  if (info.subdir) {
    candidates.push(path.join(projectPath, info.subdir, info.filename));
  }

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content, exists: true, path: filePath, provider, filename: info.filename }));
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ content: '', exists: false, provider, filename: info.filename }));
}

function handlePutInstructions(projectPath: string, provider: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const info = INSTRUCTION_FILES[provider];
  if (!info) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown provider: ${provider}` }));
    return;
  }

  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { content: string };
      const filePath = path.join(projectPath, info.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, parsed.content, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleGetGlobalInstructions(provider: string, res: http.ServerResponse): void {
  const info = INSTRUCTION_FILES[provider];
  if (!info) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown provider: ${provider}` }));
    return;
  }

  const filePath = path.join(info.globalHome, info.filename);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content, exists: true, provider, filename: info.filename }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: '', exists: false, provider, filename: info.filename }));
  }
}

function handlePutGlobalInstructions(provider: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const info = INSTRUCTION_FILES[provider];
  if (!info) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown provider: ${provider}` }));
    return;
  }

  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { content: string };
      const filePath = path.join(info.globalHome, info.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, parsed.content, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleGetAllInstructions(projectPath: string, res: http.ServerResponse): void {
  const result: Record<string, { exists: boolean; filename: string }> = {};
  for (const [providerId, info] of Object.entries(INSTRUCTION_FILES)) {
    const exists = fs.existsSync(path.join(projectPath, info.filename)) ||
      (info.subdir ? fs.existsSync(path.join(projectPath, info.subdir, info.filename)) : false);
    result[providerId] = { exists, filename: info.filename };
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

/** Read instruction file content for a given provider from a project path. Returns null if not found. */
function readInstructionFile(projectPath: string, provider: string): string | null {
  const info = INSTRUCTION_FILES[provider];
  if (!info) return null;
  const candidates = [path.join(projectPath, info.filename)];
  if (info.subdir) candidates.push(path.join(projectPath, info.subdir, info.filename));
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

/** Copy one project's instruction file to all providers that don't have one yet. */
function handleCopyInstructionsToProviders(projectPath: string, sourceProvider: string, res: http.ServerResponse): void {
  const content = readInstructionFile(projectPath, sourceProvider);
  if (content === null) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `No instruction file found for ${sourceProvider}` }));
    return;
  }

  const created: string[] = [];
  for (const [providerId, info] of Object.entries(INSTRUCTION_FILES)) {
    if (providerId === sourceProvider) continue;
    const exists = fs.existsSync(path.join(projectPath, info.filename)) ||
      (info.subdir ? fs.existsSync(path.join(projectPath, info.subdir, info.filename)) : false);
    if (!exists) {
      const targetPath = path.join(projectPath, info.filename);
      fs.writeFileSync(targetPath, content, 'utf-8');
      created.push(info.filename);
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, source: sourceProvider, created }));
}

/** Bulk sync: for every known project, find the first existing instruction file and copy to missing providers. */
function handleSyncAllInstructions(res: http.ServerResponse): void {
  // Gather all known project paths from config + claude projects directory
  const projectPaths = new Set<string>();

  // From config.projects
  for (const p of config.projects) {
    if (fs.existsSync(p.path)) projectPaths.add(p.path);
  }

  // From projectsRoot subdirectories
  if (config.projectsRoot && fs.existsSync(config.projectsRoot)) {
    try {
      const dirs = fs.readdirSync(config.projectsRoot, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && !d.name.startsWith('.')) {
          projectPaths.add(path.join(config.projectsRoot, d.name));
        }
      }
    } catch { /* ignore */ }
  }

  // From ~/.claude/projects/ encoded directories (resolve back to real paths)
  const claudeProjectsDir = path.join(config.claudeHome, 'projects');
  if (fs.existsSync(claudeProjectsDir)) {
    try {
      const dirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        // Decode Windows-encoded path: C--Users-alice-project → C:\Users\alice\project
        const decoded = isWindows ? decodeWindowsProjectDir(d.name) : '/' + d.name.replace(/-/g, '/');
        if (decoded && fs.existsSync(decoded) && isPathInScope(config, decoded)) projectPaths.add(decoded);
      }
    } catch { /* ignore */ }
  }

  let projectsProcessed = 0;
  let filesCreated = 0;
  const details: Array<{ project: string; created: string[] }> = [];

  // Priority order for source: claude first, then gemini, then codex
  const providerPriority = ['claude', 'gemini', 'codex'];

  for (const projectPath of projectPaths) {
    // Find the first existing instruction file as source
    let sourceContent: string | null = null;
    let sourceProvider: string | null = null;
    for (const pid of providerPriority) {
      const content = readInstructionFile(projectPath, pid);
      if (content !== null) {
        sourceContent = content;
        sourceProvider = pid;
        break;
      }
    }
    if (!sourceContent || !sourceProvider) continue;

    // Copy to missing providers
    const created: string[] = [];
    for (const [providerId, info] of Object.entries(INSTRUCTION_FILES)) {
      if (providerId === sourceProvider) continue;
      const exists = fs.existsSync(path.join(projectPath, info.filename)) ||
        (info.subdir ? fs.existsSync(path.join(projectPath, info.subdir, info.filename)) : false);
      if (!exists) {
        const targetPath = path.join(projectPath, info.filename);
        try {
          fs.writeFileSync(targetPath, sourceContent, 'utf-8');
          created.push(info.filename);
          filesCreated++;
        } catch { /* skip projects we can't write to */ }
      }
    }

    if (created.length > 0) {
      const name = projectPath.split(/[\\/]/).pop() ?? projectPath;
      details.push({ project: name, created });
    }
    projectsProcessed++;
  }

  console.log(`[instructions-sync] Processed ${projectsProcessed} projects, created ${filesCreated} files`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ projectsProcessed, filesCreated, details }));
}

// --- Agents API Handlers ---

function resolveProviderHome(providerId?: ProviderId): string {
  if (providerId) {
    try {
      return getProvider(providerId).homeDir();
    } catch { /* fall through */ }
  }
  return config.claudeHome;
}

function handleGetAgents(res: http.ServerResponse, providerId?: ProviderId): void {
  const homeDir = resolveProviderHome(providerId);
  const agentsDir = path.join(homeDir, 'agents');
  const agents: Array<{ filename: string; name: string; description: string; lastModified: string; content: string }> = [];

  if (fs.existsSync(agentsDir)) {
    try {
      const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
      for (const filename of files) {
        const filePath = path.join(agentsDir, filename);
        const content = fs.readFileSync(filePath, 'utf-8');
        const stat = fs.statSync(filePath);

        // Extract name from first heading or filename
        const nameMatch = content.match(/^#\s+(.+)/m);
        const name = nameMatch ? nameMatch[1].trim() : filename.replace('.md', '');

        // Extract description from frontmatter or first paragraph
        let description = '';
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const descMatch = fmMatch[1].match(/description:\s*(.+)/);
          if (descMatch) description = descMatch[1].trim();
        }
        if (!description) {
          const firstPara = content.replace(/^#.+\n+/, '').replace(/^---[\s\S]*?---\n+/, '').trim().split('\n')[0];
          description = firstPara?.slice(0, 120) ?? '';
        }

        agents.push({ filename, name, description, lastModified: stat.mtime.toISOString(), content });
      }
    } catch (err) {
      console.error(`[api] Error listing agents:`, err);
    }
  }

  agents.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(agents));
}

function handleGetAgent(filename: string, res: http.ServerResponse, providerId?: ProviderId): void {
  const homeDir = resolveProviderHome(providerId);
  const filePath = path.join(homeDir, 'agents', filename);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Agent not found' }));
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ filename, content }));
}

function handlePutAgent(filename: string, req: http.IncomingMessage, res: http.ServerResponse, providerId?: ProviderId): void {
  const homeDir = resolveProviderHome(providerId);
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { content: string };
      const agentsDir = path.join(homeDir, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(path.join(agentsDir, filename), parsed.content, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleDeleteAgent(filename: string, res: http.ServerResponse, providerId?: ProviderId): void {
  const homeDir = resolveProviderHome(providerId);
  const filePath = path.join(homeDir, 'agents', filename);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Agent not found' }));
    return;
  }
  fs.unlinkSync(filePath);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// --- Bookmarks API Handlers ---

function handleGetBookmarks(res: http.ServerResponse): void {
  const db = getDb();
  // Create table if not exists
  db.exec(`CREATE TABLE IF NOT EXISTS bookmarks (session_id TEXT PRIMARY KEY, label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const rows = db.prepare('SELECT * FROM bookmarks ORDER BY created_at DESC').all() as Array<{ session_id: string; label: string; created_at: string }>;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(rows.map((r) => ({ sessionId: r.session_id, label: r.label, createdAt: r.created_at }))));
}

function handleCreateBookmark(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { sessionId: string; label?: string };
      if (!parsed.sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing sessionId' }));
        return;
      }
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS bookmarks (session_id TEXT PRIMARY KEY, label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
      db.prepare('INSERT OR REPLACE INTO bookmarks (session_id, label) VALUES (?, ?)').run(parsed.sessionId, parsed.label ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleDeleteBookmark(sessionId: string, res: http.ServerResponse): void {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS bookmarks (session_id TEXT PRIMARY KEY, label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.prepare('DELETE FROM bookmarks WHERE session_id = ?').run(sessionId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// --- Static file serving ---

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(pathname: string, distDir: string, res: http.ServerResponse): void {
  let filePath = path.join(distDir, pathname);

  // Default to index.html for SPA routing
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  const content = fs.readFileSync(filePath);

  // index.html must never be cached — it references hashed asset filenames
  // that change on every build. Assets themselves use content-hashed names
  // so they can be cached indefinitely.
  const isHtml = ext === '.html' || filePath.endsWith('index.html');
  const cacheControl = isHtml
    ? 'no-cache, no-store, must-revalidate'
    : 'public, max-age=31536000, immutable';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
  });
  res.end(content);
}

// --- Start Server ---
// Single-user (no login) installs listen on loopback only, so nothing else on
// the network can drive sessions. With login enabled — or HIVE_HOST set — the
// server can be exposed to other machines. HIVE_HOST may list several
// addresses (e.g. "127.0.0.1,100.x.y.z" for loopback plus a Tailscale IP); the
// first is the primary listener.
const HOSTS = (process.env.HIVE_HOST || (isAuthEnabled(config) ? '0.0.0.0' : '127.0.0.1'))
  .split(',').map((h) => h.trim()).filter(Boolean);
const HOST = HOSTS[0];
if (HOSTS.includes('127.0.0.1')) {
  // Some clients resolve "localhost" to ::1 first; answer there too. Best
  // effort — hosts without IPv6 just skip it.
  const server6 = http.createServer(requestListener);
  server6.on('upgrade', handleUpgrade);
  server6.on('error', (err) => console.warn(`[server] IPv6 loopback listener unavailable: ${(err as Error).message}`));
  server6.listen(PORT, '::1');
}
// Extra addresses are best effort: a VPN interface (e.g. Tailscale) may not be
// up yet at boot, so retry instead of failing the whole server.
for (const extraHost of HOSTS.slice(1)) {
  const listenExtra = () => {
    const extra = http.createServer(requestListener);
    extra.on('upgrade', handleUpgrade);
    extra.once('error', (err) => {
      console.warn(`[server] Cannot listen on ${extraHost}:${PORT} (${(err as Error).message}); retrying in 30s`);
      setTimeout(listenExtra, 30_000);
    });
    extra.listen(PORT, extraHost, () => console.log(`[server] Also listening on ${extraHost}:${PORT}`));
  };
  listenExtra();
}
// A failed bind is fatal — without this the crash guard above would keep a
// port-less zombie process alive.
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[server] Cannot listen on ${HOST}:${PORT}: ${err.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`\n  SI Hive server v${process.env.npm_package_version || '0.1.0'} running at http://localhost:${PORT} (listening on ${HOSTS.join(', ')})`);
  console.log(`  WebSocket available at ws://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/api/health`);
  console.log(`  Dashboard state: http://localhost:${PORT}/api/state\n`);
  if (config.projects.length > 0) {
    console.log(`  Watching ${config.projects.length} project(s):`);
    for (const p of config.projects) {
      console.log(`    - ${p.name}: ${p.path}`);
    }
  }
  console.log('');

  // Auto-register Claude hooks for time tracking, but only when running as the
  // installed service. Dev runs on alternate ports would otherwise overwrite
  // the user's production hook URLs.
  if (process.env.HIVE_SERVICE_USER) {
    const result = configureClaudeHooks();
    if (result.error) {
      console.warn(`[hooks] Auto-setup failed: ${result.error}`);
    } else if (result.alreadyConfigured) {
      console.log('[hooks] Claude hooks already configured');
    } else {
      console.log(`[hooks] Auto-registered: ${result.added.join(', ')}`);
    }
  }
});

// --- Skills API Handlers ---

function resolveSkillsDir(providerId?: ProviderId): string {
  if (providerId === 'gemini') return path.join(resolveProviderHome('gemini'), 'commands');
  if (providerId === 'codex') return path.join(resolveProviderHome('codex'), 'skills');
  return path.join(config.claudeHome, 'skills');
}

function handleGetSkills(res: http.ServerResponse, providerId?: ProviderId): void {
  const skillsDir = resolveSkillsDir(providerId);
  const skills: Array<{ name: string; description: string; triggers: string[]; lastModified: string; content: string }> = [];

  if (fs.existsSync(skillsDir)) {
    try {
      if (providerId === 'gemini') {
        // Gemini: flat TOML files in ~/.gemini/commands/
        const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.toml'));
        for (const file of files) {
          const filePath = path.join(skillsDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const stat = fs.statSync(filePath);
          const name = file.replace('.toml', '');
          const descMatch = content.match(/description\s*=\s*"([^"]*)"/);
          const description = descMatch ? descMatch[1] : '';
          skills.push({ name, description, triggers: [], lastModified: stat.mtime.toISOString(), content });
        }
      } else {
        // Claude/Codex: directory-based with skill.md / SKILL.md
        const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
        const skillFilename = providerId === 'codex' ? 'SKILL.md' : 'skill.md';
        for (const dir of dirs) {
          const skillPath = path.join(skillsDir, dir.name, skillFilename);
          if (!fs.existsSync(skillPath)) continue;
          const content = fs.readFileSync(skillPath, 'utf-8');
          const stat = fs.statSync(skillPath);

          let description = '';
          let triggers: string[] = [];
          const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fmMatch) {
            const descMatch = fmMatch[1].match(/description:\s*(.+)/);
            if (descMatch) description = descMatch[1].trim();
            const triggerMatch = fmMatch[1].match(/triggers:\s*\[([^\]]*)\]/);
            if (triggerMatch) {
              triggers = triggerMatch[1].split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean);
            }
          }
          if (!description) {
            const firstPara = content.replace(/^---[\s\S]*?---\n+/, '').replace(/^#.+\n+/, '').trim().split('\n')[0];
            description = firstPara?.slice(0, 120) ?? '';
          }

          skills.push({ name: dir.name, description, triggers, lastModified: stat.mtime.toISOString(), content });
        }
      }
    } catch (err) {
      console.error(`[api] Error listing skills:`, err);
    }
  }

  skills.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(skills));
}

function handleGetSkill(name: string, res: http.ServerResponse, providerId?: ProviderId): void {
  const homeDir = resolveProviderHome(providerId);
  const skillPath = providerId === 'gemini'
    ? path.join(homeDir, 'commands', `${name}.toml`)
    : path.join(homeDir, 'skills', name, providerId === 'codex' ? 'SKILL.md' : 'skill.md');
  if (!fs.existsSync(skillPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Skill not found' }));
    return;
  }
  const content = fs.readFileSync(skillPath, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ name, content }));
}

function handlePutSkill(name: string, req: http.IncomingMessage, res: http.ServerResponse, _providerId?: ProviderId): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { content: string };
      const skillDir = path.join(config.claudeHome, 'skills', name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'skill.md'), parsed.content, 'utf-8');
      // Sync to other enabled providers
      syncSkillToProviders(name, config.claudeHome, config.aiProviders!);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleDeleteSkill(name: string, res: http.ServerResponse, _providerId?: ProviderId): void {
  const skillDir = path.join(config.claudeHome, 'skills', name);
  if (!fs.existsSync(skillDir)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Skill not found' }));
    return;
  }
  fs.rmSync(skillDir, { recursive: true, force: true });
  // Remove from other enabled providers
  removeSkillFromProviders(name, config.aiProviders!);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// --- Scheduled Tasks API Handlers ---

function handleGetScheduledTasks(res: http.ServerResponse): void {
  const state = aggregator.getState();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(state.scheduledTasks));
}

function handleCreateScheduledTask(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { name: string; content: string };
      if (!parsed.name || !parsed.content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and content are required' }));
        return;
      }
      const taskDir = path.join(config.claudeHome, 'scheduled-tasks', parsed.name);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'SKILL.md'), parsed.content, 'utf-8');
      aggregator.refreshScheduledTasks();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleUpdateScheduledTask(name: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const skillPath = path.join(config.claudeHome, 'scheduled-tasks', name, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Scheduled task not found' }));
    return;
  }
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { content: string };
      fs.writeFileSync(skillPath, parsed.content, 'utf-8');
      aggregator.refreshScheduledTasks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleDeleteScheduledTask(name: string, res: http.ServerResponse): void {
  const taskDir = path.join(config.claudeHome, 'scheduled-tasks', name);
  if (!fs.existsSync(taskDir)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Scheduled task not found' }));
    return;
  }
  fs.rmSync(taskDir, { recursive: true, force: true });
  aggregator.refreshScheduledTasks();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// --- Schedules API Handlers (execution engine) ---

function handleGetSchedules(res: http.ServerResponse): void {
  const schedules = getAllSchedules();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(schedules));
}

function handleCreateSchedule(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as {
        name?: string; prompt?: string; cronExpression?: string;
        intervalMs?: number; projectPath?: string;
        launchFlags?: { dangerouslySkipPermissions?: boolean; autoMode?: boolean };
        maxRunsKept?: number;
        maxActivePrs?: number;
        type?: 'claude-prompt' | 'pr-review-pipeline';
      };
      if (!parsed.name || !parsed.prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and prompt are required' }));
        return;
      }
      const schedule = insertSchedule({
        name: parsed.name,
        prompt: parsed.prompt,
        cronExpression: parsed.cronExpression,
        intervalMs: parsed.intervalMs,
        projectPath: parsed.projectPath,
        launchFlags: parsed.launchFlags,
        maxRunsKept: parsed.maxRunsKept,
        maxActivePrs: parsed.maxActivePrs,
        type: parsed.type,
      });
      // Arm the schedule if it has a timer config
      if (schedule.enabled && (schedule.cronExpression || schedule.intervalMs)) {
        scheduler.armSchedule(schedule);
      }
      aggregator.refreshSchedules();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(schedule));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleUpdateSchedule(scheduleId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const existing = getSchedule(scheduleId);
      if (!existing) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Schedule not found' }));
        return;
      }
      const parsed = JSON.parse(body);
      const updates: Parameters<typeof updateSchedule>[1] = {};
      if (parsed.name !== undefined) updates.name = parsed.name;
      if (parsed.prompt !== undefined) updates.prompt = parsed.prompt;
      if ('cronExpression' in parsed) updates.cronExpression = parsed.cronExpression;
      if ('intervalMs' in parsed) updates.intervalMs = parsed.intervalMs;
      if ('projectPath' in parsed) updates.projectPath = parsed.projectPath;
      if ('launchFlags' in parsed) updates.launchFlags = parsed.launchFlags;
      if (parsed.maxRunsKept !== undefined) updates.maxRunsKept = parsed.maxRunsKept;
      if (parsed.maxActivePrs !== undefined) updates.maxActivePrs = parsed.maxActivePrs;
      if (parsed.enabled !== undefined) updates.enabled = parsed.enabled;

      updateSchedule(scheduleId, updates);

      // Re-arm schedule
      const fresh = getSchedule(scheduleId);
      if (fresh) {
        scheduler.disarmSchedule(scheduleId);
        if (fresh.enabled && (fresh.cronExpression || fresh.intervalMs)) {
          scheduler.armSchedule(fresh);
        }
      }

      aggregator.refreshSchedules();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fresh));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleDeleteSchedule(scheduleId: string, res: http.ServerResponse): void {
  const existing = getSchedule(scheduleId);
  if (!existing) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Schedule not found' }));
    return;
  }
  scheduler.disarmSchedule(scheduleId);
  deleteScheduleRuns(scheduleId);
  deleteSchedule(scheduleId);
  aggregator.refreshSchedules();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

function handleTriggerScheduleRun(scheduleId: string, res: http.ServerResponse): void {
  const existing = getSchedule(scheduleId);
  if (!existing) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Schedule not found' }));
    return;
  }
  scheduler.triggerRun(scheduleId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, message: 'Run triggered' }));
}

function handleToggleSchedule(scheduleId: string, res: http.ServerResponse): void {
  const existing = getSchedule(scheduleId);
  if (!existing) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Schedule not found' }));
    return;
  }
  const newEnabled = !existing.enabled;
  updateSchedule(scheduleId, { enabled: newEnabled });

  if (newEnabled && (existing.cronExpression || existing.intervalMs)) {
    const fresh = getSchedule(scheduleId)!;
    scheduler.armSchedule(fresh);
  } else {
    scheduler.disarmSchedule(scheduleId);
  }

  aggregator.refreshSchedules();
  const fresh = getSchedule(scheduleId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(fresh));
}

function handleGetScheduleRuns(scheduleId: string, url: URL, res: http.ServerResponse): void {
  const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const runs = getScheduleRuns(scheduleId, limit, offset);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(runs));
}

function handleGetSingleRun(runId: string, res: http.ServerResponse): void {
  const run = getScheduleRun(runId);
  if (!run) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Run not found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(run));
}

// --- Live Loops API Handlers ---

function handleGetLoops(url: URL, res: http.ServerResponse): void {
  const sessionId = url.searchParams.get('sessionId') ?? undefined;
  const loops = getLiveLoops(sessionId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(loops));
}

function handleCreateLoop(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { interval: string; prompt: string; source?: 'hive' | 'tracker'; ticketId?: string };
      if (!parsed.interval || !parsed.prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'interval and prompt are required' }));
        return;
      }

      // Send /loop command to the session
      const loopCommand = `/loop ${parsed.interval} ${parsed.prompt}`;
      const session = aggregator.getState().sessions.find((s) => s.id === sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      // Use send-input to send the /loop command to the session
      const inputReq: SendInputRequest = {
        paneId: session.paneId ?? sessionId,
        input: loopCommand,
        type: 'text',
      };

      sendInput(inputReq, aggregator)
        .then(() => {
          // Record in SQLite
          const loop = insertLiveLoop(sessionId, parsed.interval, parsed.prompt, parsed.source ?? 'hive', parsed.ticketId);
          aggregator.refreshLiveLoops();
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(loop));
        })
        .catch((err: Error) => {
          // Still record the loop even if send failed (best-effort)
          const loop = insertLiveLoop(sessionId, parsed.interval, parsed.prompt, parsed.source ?? 'hive', parsed.ticketId);
          aggregator.refreshLiveLoops();
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...loop, warning: `Loop recorded but send may have failed: ${err.message}` }));
        });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleStopLoop(loopId: string, res: http.ServerResponse): void {
  const loop = stopLiveLoop(loopId);
  if (!loop) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Loop not found' }));
    return;
  }
  aggregator.refreshLiveLoops();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(loop));
}

// --- Plugins API Handlers ---

function handleGetPlugins(res: http.ServerResponse, providerId?: ProviderId): void {
  const homeDir = resolveProviderHome(providerId);

  // Gemini uses "extensions" with gemini-extension.json manifests
  if (providerId === 'gemini') {
    const extDir = path.join(homeDir, 'extensions');
    const plugins: Array<{ id: string; name: string; marketplace: string; version: string; installedAt: string; description: string; path: string }> = [];
    if (fs.existsSync(extDir)) {
      try {
        const entries = fs.readdirSync(extDir, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const entry of entries) {
          const manifestPath = path.join(extDir, entry.name, 'gemini-extension.json');
          let name = entry.name;
          let description = '';
          let version = '';
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
              name = manifest.name ?? entry.name;
              description = manifest.description ?? '';
              version = manifest.version ?? '';
            } catch { /* ignore */ }
          }
          const stat = fs.statSync(path.join(extDir, entry.name));
          plugins.push({
            id: entry.name,
            name,
            marketplace: 'gemini',
            version,
            installedAt: stat.mtime.toISOString(),
            description,
            path: path.join(extDir, entry.name),
          });
        }
      } catch { /* ignore */ }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ plugins, enabledPlugins: {} }));
    return;
  }

  const pluginsFile = path.join(homeDir, 'plugins', 'installed_plugins.json');
  const settingsFile = path.join(homeDir, 'settings.json');

  const plugins: Array<{ id: string; name: string; marketplace: string; version: string; installedAt: string; description: string; path: string }> = [];
  let enabledPlugins: Record<string, boolean> = {};

  if (fs.existsSync(pluginsFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(pluginsFile, 'utf-8'));
      // Format: { version: 2, plugins: { "name@marketplace": [{ scope, installPath, version, installedAt, ... }] } }
      const pluginsObj = raw.plugins ?? raw;
      for (const [id, entries] of Object.entries(pluginsObj)) {
        const entryList = entries as Array<Record<string, string>>;
        if (!Array.isArray(entryList) || entryList.length === 0) continue;
        const entry = entryList[0];
        const [name, marketplace] = id.split('@');
        plugins.push({
          id,
          name: name ?? id,
          marketplace: marketplace ?? 'unknown',
          version: entry.version ?? 'unknown',
          installedAt: entry.installedAt ?? '',
          description: '',
          path: entry.installPath ?? '',
        });
      }
    } catch {
      // ignore
    }
  }

  if (fs.existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      enabledPlugins = settings.enabledPlugins ?? {};
    } catch {
      // ignore
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ plugins, enabledPlugins }));
}

function handleTogglePlugin(pluginId: string, res: http.ServerResponse): void {
  const settingsFile = path.join(config.claudeHome, 'settings.json');
  try {
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsFile)) {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    }
    const enabled: Record<string, boolean> = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    const currentState = enabled[pluginId] ?? false;
    enabled[pluginId] = !currentState;
    settings.enabledPlugins = enabled;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, enabled: !currentState }));
  } catch (err) {
    console.error(`[api] Error toggling plugin:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to toggle plugin' }));
  }
}

// --- Permissions API Handlers ---

function handleGetPermissions(res: http.ServerResponse): void {
  const settingsFile = path.join(config.claudeHome, 'settings.json');
  try {
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsFile)) {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    }
    const raw = (settings.permissions ?? {}) as Record<string, string[]>;
    const permissions = { allow: raw.allow ?? [], deny: raw.deny ?? [], ask: raw.ask ?? [] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ permissions }));
  } catch (err) {
    console.error(`[api] Error reading permissions:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to read permissions' }));
  }
}

function handlePatchPermissions(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { permissions: { allow: string[]; deny: string[]; ask: string[] } };
      const settingsFile = path.join(config.claudeHome, 'settings.json');
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsFile)) {
        settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      }
      settings.permissions = parsed.permissions;
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleGetPermissionProjects(res: http.ServerResponse): void {
  const projectsDir = path.join(config.claudeHome, 'projects');
  const projects: Array<{ path: string; name: string; encodedPath: string; hasPermissions: boolean }> = [];

  if (fs.existsSync(projectsDir)) {
    try {
      const dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const dir of dirs) {
        let projectPath = dir.name;
        if (isWindows) {
          projectPath = decodeWindowsProjectDir(dir.name);
        } else {
          projectPath = dir.name.replace(/-/g, '/');
        }
        if (!isPathInScope(config, projectPath)) continue;
        // Check if the actual project dir has .claude/settings.local.json
        const inRepoSettings = path.join(projectPath, '.claude', 'settings.local.json');
        const hasPermissions = fs.existsSync(inRepoSettings);
        projects.push({ path: projectPath, name: path.basename(projectPath), encodedPath: dir.name, hasPermissions });
      }
    } catch (err) {
      console.error(`[api] Error listing permission projects:`, err);
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ projects }));
}

function handleGetProjectPermissions(encodedPath: string, res: http.ServerResponse): void {
  // Decode the project path and read from in-repo .claude/settings.local.json
  let projectPath = encodedPath;
  if (isWindows) {
    projectPath = decodeWindowsProjectDir(encodedPath);
  } else {
    projectPath = encodedPath.replace(/-/g, '/');
  }
  const settingsFile = path.join(projectPath, '.claude', 'settings.local.json');
  try {
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsFile)) {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    }
    const raw = (settings.permissions ?? {}) as Record<string, string[]>;
    const permissions = { allow: raw.allow ?? [], deny: raw.deny ?? [], ask: raw.ask ?? [] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ permissions }));
  } catch (err) {
    console.error(`[api] Error reading project permissions:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to read permissions' }));
  }
}

function handlePatchProjectPermissions(encodedPath: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then((body) => {
    try {
      const parsed = JSON.parse(body) as { permissions: { allow: string[]; deny: string[]; ask: string[] } };
      // Decode the project path and write to in-repo .claude/settings.local.json
      let projectPath = encodedPath;
      if (isWindows) {
        projectPath = decodeWindowsProjectDir(encodedPath);
      } else {
        projectPath = encodedPath.replace(/-/g, '/');
      }
      const settingsFile = path.join(projectPath, '.claude', 'settings.local.json');
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsFile)) {
        settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      }
      // Only include non-empty arrays to match Claude Code's format
      const perms: Record<string, string[]> = {};
      if (parsed.permissions.allow?.length) perms.allow = parsed.permissions.allow;
      if (parsed.permissions.deny?.length) perms.deny = parsed.permissions.deny;
      if (parsed.permissions.ask?.length) perms.ask = parsed.permissions.ask;
      settings.permissions = perms;
      const dir = path.dirname(settingsFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

// --- Community API Handlers ---

interface CommunityItem {
  name: string;
  description: string;
  source: string;
  sourceUrl: string;
  downloadUrl?: string;
  author?: string;
  category?: string;
}

const COMMUNITY_CACHE_DIR = hivePath('cache', 'community');

const COMMUNITY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCachedCommunity(type: string): CommunityItem[] | null {
  const cacheFile = path.join(COMMUNITY_CACHE_DIR, `${type}.json`);
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs > COMMUNITY_CACHE_TTL) return null;
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  } catch {
    return null;
  }
}

function setCachedCommunity(type: string, items: CommunityItem[]): void {
  fs.mkdirSync(COMMUNITY_CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(COMMUNITY_CACHE_DIR, `${type}.json`), JSON.stringify(items, null, 2), 'utf-8');
}

async function fetchGitHubReadme(owner: string, repo: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
  const response = await fetch(url);
  if (!response.ok) {
    const response2 = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`);
    if (!response2.ok) throw new Error(`Failed to fetch README from ${owner}/${repo}`);
    return response2.text();
  }
  return response.text();
}

function parseAwesomeListItems(readme: string, source: string, repoUrl: string): CommunityItem[] {
  const items: CommunityItem[] = [];
  // Match patterns like:
  //   - [name](url) - Description
  //   - **[name](url)** - Description
  //   - **name** - Description with [link](url)
  const linkRegex = /[-*]\s*\*{0,2}\[([^\]]+)\]\(([^)]+)\)\*{0,2}\s*[-–:]*\s*(.*?)(?:\n|$)/g;
  let match;
  while ((match = linkRegex.exec(readme)) !== null) {
    // Strip markdown bold/italic from name
    const name = match[1].trim().replace(/\*+/g, '');
    const itemUrl = match[2].trim();
    const description = match[3].trim().replace(/\*+/g, '').replace(/\|?\s*$/, '').trim();
    if (name && description && !itemUrl.includes('#') && description.length > 5) {
      // Make URLs absolute
      const absoluteUrl = itemUrl.startsWith('http') ? itemUrl : `${repoUrl}/blob/main/${itemUrl.replace(/^\.\//, '')}`;
      // For raw download, convert GitHub blob URLs to raw
      let downloadUrl: string | undefined;
      if (itemUrl.endsWith('.md')) {
        if (itemUrl.startsWith('http') && itemUrl.includes('github.com')) {
          downloadUrl = itemUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/').replace('/tree/', '/');
        } else if (!itemUrl.startsWith('http')) {
          const cleanPath = itemUrl.replace(/^\.\//, '');
          downloadUrl = `https://raw.githubusercontent.com/${source}/main/${cleanPath}`;
        }
      }
      items.push({
        name,
        description: description.slice(0, 200),
        source,
        sourceUrl: absoluteUrl,
        downloadUrl,
        author: source,
      });
    }
  }
  return items;
}

/**
 * Parse a markdown table of hooks (e.g. rohitg00/awesome-claude-code-toolkit's "## Hooks"
 * section, formatted as | Script | Trigger | Purpose |) into CommunityItems. The hooks
 * ecosystem doesn't use the `- [name](url) - desc` awesome-list shape, so this is separate
 * from parseAwesomeListItems.
 */
function parseHooksTable(readme: string, source: string, repoUrl: string): CommunityItem[] {
  const items: CommunityItem[] = [];
  const heading = readme.match(/^##\s+.*Hooks\s*$/m);
  if (!heading || heading.index === undefined) return items;
  const rest = readme.slice(heading.index + heading[0].length);
  const nextIdx = rest.search(/^##\s+/m);
  const section = nextIdx === -1 ? rest : rest.slice(0, nextIdx);

  const stripMd = (s: string) => s.replace(/`/g, '').replace(/\*+/g, '').trim();

  for (const line of section.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (/^script$/i.test(stripMd(cells[0]))) continue;        // header row
    if (/^:?-{2,}:?$/.test(cells[0])) continue;               // separator row
    const link = cells[0].match(/\[`?([^`\]]+?)`?\]\(([^)]+)\)/);
    const name = link ? stripMd(link[1]) : stripMd(cells[0]);
    if (!name) continue;
    const sourceUrl = link ? link[2] : repoUrl;
    const trigger = stripMd(cells[1]);
    const purpose = stripMd(cells[2]);
    items.push({
      name,
      description: `${trigger}: ${purpose}`.slice(0, 200),
      source,
      sourceUrl,
      author: source,
    });
  }
  return items;
}

/** Hand-curated, well-known standalone hook projects (verified real repos). */
const CURATED_HOOKS: CommunityItem[] = [
  {
    name: 'claude-code-hooks-mastery',
    description: 'Reference implementation of all hook lifecycle events with logging, TTS, and safety blocks',
    source: 'disler/claude-code-hooks-mastery',
    sourceUrl: 'https://github.com/disler/claude-code-hooks-mastery',
    author: 'disler',
  },
  {
    name: 'cchooks',
    description: 'Python SDK for writing Claude Code hooks with typed event payloads',
    source: 'GowayLee/cchooks',
    sourceUrl: 'https://github.com/GowayLee/cchooks',
    author: 'GowayLee',
  },
  {
    name: 'claude-code-hooks (TS SDK)',
    description: 'TypeScript SDK with defineHook(), typed events for all hook types, zero dependencies',
    source: 'Payshak/claude-code-hooks',
    sourceUrl: 'https://github.com/Payshak/claude-code-hooks',
    author: 'Payshak',
  },
  {
    name: 'CCNotify',
    description: 'Desktop notifications on Stop / Notification events so you know when Claude needs you',
    source: 'dazuiba/CCNotify',
    sourceUrl: 'https://github.com/dazuiba/CCNotify',
    author: 'dazuiba',
  },
  {
    name: 'claude-hook-comms (HCOM)',
    description: 'Hook-based comms channel for coordinating multiple Claude Code sessions',
    source: 'aannoo/claude-hook-comms',
    sourceUrl: 'https://github.com/aannoo/claude-hook-comms',
    author: 'aannoo',
  },
  {
    name: 'Sound Notifications',
    description: 'Cross-platform Notification / Stop / SubagentStop hooks that play audio alerts',
    source: 'pascalporedda/awesome-claude-code',
    sourceUrl: 'https://github.com/pascalporedda/awesome-claude-code',
    author: 'pascalporedda',
  },
  {
    name: 'Hooks reference (official docs)',
    description: 'Anthropic’s official Claude Code hooks reference — events, JSON schema, matchers, examples',
    source: 'docs.claude.com',
    sourceUrl: 'https://code.claude.com/docs/en/hooks',
    author: 'Anthropic',
  },
];

async function fetchCommunityAgents(): Promise<CommunityItem[]> {
  const items: CommunityItem[] = [];
  try {
    const readme = await fetchGitHubReadme('VoltAgent', 'awesome-claude-code-subagents');
    items.push(...parseAwesomeListItems(readme, 'VoltAgent/awesome-claude-code-subagents', 'https://github.com/VoltAgent/awesome-claude-code-subagents'));
  } catch (err) {
    console.error('[community] Error fetching VoltAgent agents:', err);
  }
  try {
    const readme = await fetchGitHubReadme('wshobson', 'agents');
    items.push(...parseAwesomeListItems(readme, 'wshobson/agents', 'https://github.com/wshobson/agents'));
  } catch (err) {
    console.error('[community] Error fetching wshobson agents:', err);
  }
  return items;
}

async function fetchCommunitySkills(): Promise<CommunityItem[]> {
  const items: CommunityItem[] = [];
  try {
    const readme = await fetchGitHubReadme('travisvn', 'awesome-claude-skills');
    items.push(...parseAwesomeListItems(readme, 'travisvn/awesome-claude-skills', 'https://github.com/travisvn/awesome-claude-skills'));
  } catch (err) {
    console.error('[community] Error fetching travisvn skills:', err);
  }
  try {
    const readme = await fetchGitHubReadme('hesreallyhim', 'awesome-claude-code');
    items.push(...parseAwesomeListItems(readme, 'hesreallyhim/awesome-claude-code', 'https://github.com/hesreallyhim/awesome-claude-code'));
  } catch (err) {
    console.error('[community] Error fetching hesreallyhim skills:', err);
  }
  return items;
}

async function fetchCommunityPlugins(): Promise<CommunityItem[]> {
  const items: CommunityItem[] = [];
  try {
    const readme = await fetchGitHubReadme('punkpeye', 'awesome-mcp-servers');
    items.push(...parseAwesomeListItems(readme, 'punkpeye/awesome-mcp-servers', 'https://github.com/punkpeye/awesome-mcp-servers'));
  } catch (err) {
    console.error('[community] Error fetching MCP plugins:', err);
  }
  return items;
}

async function fetchCommunityHooks(): Promise<CommunityItem[]> {
  // Community hooks are config snippets / scripts, not standalone installable files, so these
  // entries surface a "View" link to the source (install is disabled for hooks in the browser).
  // The hooks ecosystem isn't in awesome-list bullet format, so we parse a known hooks table
  // (rohitg00 toolkit) and merge a curated set of well-known standalone hook projects.
  const items: CommunityItem[] = [];
  try {
    const readme = await fetchGitHubReadme('rohitg00', 'awesome-claude-code-toolkit');
    items.push(...parseHooksTable(readme, 'rohitg00/awesome-claude-code-toolkit', 'https://github.com/rohitg00/awesome-claude-code-toolkit'));
  } catch (err) {
    console.error('[community] Error fetching rohitg00 hooks:', err);
  }
  items.push(...CURATED_HOOKS);

  // De-dupe by name (curated entries win ties since they're appended after the scrape).
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function handleGetCommunity(type: 'agents' | 'skills' | 'plugins' | 'hooks', res: http.ServerResponse): void {
  const cached = getCachedCommunity(type);
  if (cached) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cached));
    return;
  }

  const fetchFn = type === 'agents' ? fetchCommunityAgents
    : type === 'skills' ? fetchCommunitySkills
    : type === 'hooks' ? fetchCommunityHooks
    : fetchCommunityPlugins;

  fetchFn().then((items) => {
    setCachedCommunity(type, items);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items));
  }).catch((err) => {
    console.error(`[community] Error fetching ${type}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Failed to fetch community ${type}` }));
  });
}

function handleInstallAgent(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then(async (body) => {
    try {
      const parsed = JSON.parse(body) as { name: string; url: string };
      if (!parsed.name || !parsed.url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and url are required' }));
        return;
      }
      const response = await fetch(parsed.url);
      if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
      const content = await response.text();
      const agentsDir = path.join(config.claudeHome, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      const filename = parsed.name.endsWith('.md') ? parsed.name : `${parsed.name}.md`;
      fs.writeFileSync(path.join(agentsDir, filename), content, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, filename }));
    } catch (err) {
      console.error('[api] Error installing agent:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to install agent' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

function handleInstallSkill(req: http.IncomingMessage, res: http.ServerResponse): void {
  readBody(req).then(async (body) => {
    try {
      const parsed = JSON.parse(body) as { name: string; url: string };
      if (!parsed.name || !parsed.url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and url are required' }));
        return;
      }
      const response = await fetch(parsed.url);
      if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
      const content = await response.text();
      const skillDir = path.join(config.claudeHome, 'skills', parsed.name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'skill.md'), content, 'utf-8');
      // Sync to other enabled providers
      syncSkillToProviders(parsed.name, config.claudeHome, config.aiProviders!);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: parsed.name }));
    } catch (err) {
      console.error('[api] Error installing skill:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to install skill' }));
    }
  }).catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  });
}

// --- Graceful shutdown ---
function shutdown(): void {
  console.log('\n[shutdown] Shutting down...');

  // Stop scheduler
  scheduler.stop();

  // Destroy queue engine timers
  queueEngine.destroy();

  // Destroy all PTY sessions
  destroyAllPtys();

  // Stop notifier
  notifier.stop();

  // Close watchers
  claudeWatcher.stop().catch(console.error);
  sessionWatcher.stop().catch(console.error);

  // Destroy aggregator (cleans up timers)
  aggregator.destroy();

  // Close WebSocket connections
  for (const client of wss.clients) {
    client.close();
  }

  // Close HTTP server
  server.close(() => {
    closeDb();
    console.log('[shutdown] Server closed');
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Windows-specific: handle Ctrl+C and process exit events
if (process.platform === 'win32') {
  process.on('SIGHUP', shutdown);
}
