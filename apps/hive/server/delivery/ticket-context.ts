/**
 * "Start a session from a ticket": write the ticket (details + comments) as
 * markdown into the project so the agent can read it, and build the opening
 * prompt that points at it.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Issue, IssueComment, TrackerProvider } from '../integrations/types.js';

/** Folder (inside the project) where ticket context files are written. */
export const TICKET_CONTEXT_DIR = path.join('.hive', 'tickets');

function stripHtml(text: string): string {
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatTicketMarkdown(issue: Issue, comments: IssueComment[]): string {
  const lines: string[] = [];
  lines.push(`# ${issue.type ?? 'Ticket'} ${issue.key}: ${issue.title}`, '');
  lines.push(`**State:** ${issue.state}`);
  if (issue.assignee) lines.push(`**Assigned to:** ${issue.assignee.name}`);
  if (issue.priority) lines.push(`**Priority:** ${issue.priority}`);
  if (issue.iteration) lines.push(`**Iteration:** ${issue.iteration}`);
  if (issue.labels.length) lines.push(`**Labels:** ${issue.labels.join(', ')}`);
  if (issue.createdAt) lines.push(`**Created:** ${issue.createdAt}`);
  if (issue.updatedAt) lines.push(`**Updated:** ${issue.updatedAt}`);
  lines.push(`**Link:** ${issue.url}`, '');

  if (issue.description?.trim()) {
    lines.push('## Description', '', stripHtml(issue.description), '');
  }
  if (comments.length) {
    lines.push('## Comments', '');
    for (const c of comments) {
      lines.push(`### ${c.author?.name ?? 'Unknown'} (${new Date(c.createdAt).toLocaleString()})`, '', stripHtml(c.body), '');
    }
  }
  return lines.join('\n');
}

function safeFileKey(key: string): string {
  return key.replace(/[^\w.-]+/g, '_');
}

/**
 * Write `<project>/.hive/tickets/<key>.md` and make sure `.hive/` is
 * git-ignored in that project. Returns the file path and a starter prompt.
 */
export async function writeTicketContext(
  tracker: TrackerProvider,
  key: string,
  projectPath: string,
): Promise<{ file: string; relativeFile: string; prompt: string; issue: Issue }> {
  const issue = await tracker.getIssue(key);
  if (!issue) throw new Error(`Ticket ${key} not found`);
  const comments = await tracker.listComments(key).catch(() => []);

  const dir = path.join(projectPath, TICKET_CONTEXT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const relativeFile = path.join(TICKET_CONTEXT_DIR, `${safeFileKey(issue.key)}.md`);
  const file = path.join(projectPath, relativeFile);
  fs.writeFileSync(file, formatTicketMarkdown(issue, comments), 'utf-8');

  const gitignore = path.join(projectPath, '.gitignore');
  try {
    const existing = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf-8') : '';
    if (fs.existsSync(path.join(projectPath, '.git')) && !existing.split(/\r?\n/).some((l) => ['.hive', '.hive/'].includes(l.trim()))) {
      fs.appendFileSync(gitignore, `${existing && !existing.endsWith('\n') ? '\n' : ''}.hive/\n`);
    }
  } catch { /* best effort */ }

  const prompt = [
    `Work on ticket ${issue.key}: "${issue.title}".`,
    `The full ticket (description and discussion) is in ${relativeFile.replace(/\\/g, '/')} — read it first.`,
    'Start by summarizing the task and proposing a plan before changing code.',
  ].join('\n');

  return { file, relativeFile, prompt, issue };
}
