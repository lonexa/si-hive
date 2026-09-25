// Contextual prompt builders for "Open in AI" buttons across all pages.
// Each function takes domain data and returns a ready-to-use prompt string.

// ─── DELIVERY ─────────────────────────────────────────────────────────────────

export function codeReview(prId: number, title: string, repo: string, sourceBranch: string, targetBranch: string, author: string, reviewers: string) {
  return `You are reviewing Pull Request #${prId}: "${title}"
Repository: ${repo}
Branch: ${sourceBranch} → ${targetBranch}
Author: ${author}
${reviewers ? `Reviewers: ${reviewers}` : ''}

CRITICAL REVIEW INSTRUCTIONS:
1. First, run: git diff ${targetBranch}...${sourceBranch} to see exactly what this PR changes relative to the target branch.
2. Check if any changes in this PR would REVERT or UNDO work that already exists on the ${targetBranch} branch. This is a common and serious issue — flag it immediately.
3. Compare the PR branch state against what ${targetBranch} currently has — if the PR removes or overwrites recent ${targetBranch} changes, this is CRITICAL.
4. IMPORTANT: Check OTHER OPEN pull requests in this repository for overlapping file changes. List the other open PRs (e.g. with the git host CLI, such as "gh pr list"), then compare changed files. If another open PR modifies the same files, flag it as a potential merge conflict. Identical changes across PRs should be flagged as CRITICAL — one PR should be closed or coordinated to avoid conflicts at merge time.

Perform a thorough code review: check for bugs, security issues, logic errors, reverted changes, overlapping PRs, performance, and code quality.`;
}

// ─── PROJECTS ───────────────────────────────────────────────────────────────

export function projectGeneral(name: string, path: string) {
  return `Open a session for the **${name}** project.

Project path: ${path}

What would you like to work on?`;
}

export function gitFileChange(projectPath: string, branch: string, filePath: string, status: string) {
  return `Review this file change:

Project: ${projectPath}
Branch: ${branch}
File: ${filePath}
Status: ${status}

Review the changes in this file and provide feedback.`;
}

export function gitBranchAnalysis(projectPath: string, branch: string, aheadBehind: string, changedFiles: number) {
  return `Analyze branch status:

Project: ${projectPath}
Branch: ${branch}
Ahead/Behind: ${aheadBehind}
Changed files: ${changedFiles}

Review the branch state and suggest next steps (merge, rebase, cleanup, etc.).`;
}

// ─── DASHBOARD ──────────────────────────────────────────────────────────────

export function sessionAttention(sessionId: string, project: string, status: string, lastError: string) {
  return `Fix this session that needs attention:

Session: ${sessionId}
Project: ${project}
Status: ${status}

${lastError ? `Last error:\n\`\`\`\n${lastError}\n\`\`\`` : ''}

Investigate and resolve the issue.`;
}

export function calendarEvent(title: string, date: string, description: string) {
  return `Prepare for this event:

Event: ${title}
Date: ${date}
Description: ${description}

Help me prepare materials, talking points, or action items for this event.`;
}

// ─── KNOWLEDGE BASE ────────────────────────────────────────────────────────

export function kbEntry(title: string, content: string, tags: string) {
  return `Research further on this knowledge base entry:

Title: ${title}
Tags: ${tags}

Content:
${content}

Expand on this topic with additional research, examples, and best practices.`;
}

export function snippet(title: string, language: string, code: string) {
  return `Improve this code snippet:

Title: ${title}
Language: ${language}

\`\`\`${language}
${code}
\`\`\`

Review for correctness, performance, and best practices. Suggest improvements.`;
}

export function decisionRecord(title: string, status: string, context: string, decision: string, consequences: string) {
  return `Analyze this architectural decision:

Title: ${title}
Status: ${status}

Context: ${context}

Decision: ${decision}

Consequences: ${consequences}

Evaluate whether this decision is still appropriate given current context. Identify any risks or alternatives.`;
}

// ─── AI STUDIO ──────────────────────────────────────────────────────────────

export function agentEdit(name: string, description: string, type: string) {
  return `Edit the **${name}** agent:

Type: ${type}
Description: ${description}

Help me improve this agent's configuration, instructions, or capabilities.`;
}

export function skillEdit(name: string, content: string) {
  return `Edit the **${name}** skill:

Current content:
\`\`\`
${content}
\`\`\`

Help me improve this skill's instructions and effectiveness.`;
}

export function scannerTodo(filePath: string, line: number, todoText: string) {
  return `Resolve this TODO:

File: ${filePath}:${line}
TODO: ${todoText}

Implement what the TODO describes or explain why it should be removed.`;
}

export function scannerFixme(filePath: string, line: number, fixmeText: string, severity: string) {
  return `Fix this issue:

File: ${filePath}:${line}
FIXME: ${fixmeText}
Severity: ${severity}

Implement the fix described in this FIXME comment.`;
}

export function scannerOutdatedDep(packageName: string, currentVersion: string, latestVersion: string) {
  return `Upgrade this dependency:

Package: ${packageName}
Current: ${currentVersion}
Latest: ${latestVersion}

Review the changelog for breaking changes and upgrade the package safely.`;
}

export function scannerLargeFile(filePath: string, size: string, lines: number) {
  return `Refactor this large file:

File: ${filePath}
Size: ${size}
Lines: ${lines}

This file is too large. Analyze its structure and suggest how to break it into smaller, focused modules.`;
}

export function docsGenerate(projectRoot: string, docType: string, context: string) {
  return `Generate ${docType} documentation:

Project: ${projectRoot}
Context: ${context}

Create comprehensive, well-structured documentation.`;
}

// ─── ANALYTICS ──────────────────────────────────────────────────────────────

export function metricInvestigation(developerName: string, metric: string, value: string, trend: string) {
  return `Investigate developer metrics:

Developer: ${developerName}
Metric: ${metric}
Value: ${value}
Trend: ${trend}

Analyze this metric and suggest improvements or identify concerns.`;
}

// ─── SESSIONS ───────────────────────────────────────────────────────────────

export function promptRun(_title: string, content: string, _category: string) {
  return `${content}`;
}

export function replayEntry(sessionId: string, entryType: string, content: string) {
  return `Continue work from session ${sessionId}:

Previous ${entryType}:
${content}

Continue where this left off.`;
}

// ─── SETTINGS ───────────────────────────────────────────────────────────────

export function scheduleDebug(name: string, cronExpression: string, lastError: string) {
  return `Debug this schedule:

Schedule: ${name}
Cron: ${cronExpression}

${lastError ? `Last error:\n\`\`\`\n${lastError}\n\`\`\`` : 'No recent errors.'}

Review the schedule configuration and fix any issues.`;
}

// ─── CONSULT / SECOND OPINION ────────────────────────────────────────────────

export function consultReview(transcript: string) {
  return `I'm sharing a transcript from an active coding session with another AI provider. Please review the approach taken and provide your perspective:

1. Are there any bugs, logic errors, or security concerns?
2. Are there better approaches or patterns that could be used?
3. Any suggestions for improvement?

Do NOT make changes to any files — analysis and recommendations only.

=== TRANSCRIPT ===
${transcript}
=== END TRANSCRIPT ===`;
}
