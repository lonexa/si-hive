export interface LoopTemplateConfigField {
  key: string;
  label: string;
  type: 'text' | 'directory';
  placeholder?: string;
}

export interface LoopTemplate {
  id: string;
  name: string;
  description: string;
  defaultInterval: string;
  promptTemplate: string;
  configFields: LoopTemplateConfigField[];
  scheduleType?: 'claude-prompt' | 'pr-review-pipeline';
}

// Shared workflow instructions appended to all PR-creating templates
const PR_WORKFLOW = `

Follow this exact workflow:
1. BEFORE making any changes, check for existing open/active pull requests in this repository. List them using the appropriate CLI tool (gh pr list --state open, az repos pr list --status active, etc.) and note which files they modify. If an existing open PR already makes the same or very similar changes you are about to make, STOP and output a message explaining the overlap instead of creating a duplicate PR.
2. Create a new branch from the current branch with a descriptive name (e.g., fix/bug-description)
3. Make your changes and verify they work (build, run tests if available)
4. Before committing, compare your changed files against the files modified in other open PRs. If there is overlap, ensure your changes are complementary (not duplicated) and note the overlap in your PR description.
5. Stage and commit your changes with a clear commit message
6. Push the branch to the remote
7. Create a pull request using the appropriate CLI tool (gh pr create, az repos pr create, etc.). In the PR description, list any overlapping open PRs you found.
8. Output the PR URL when done

IMPORTANT: You MUST complete all steps through creating the PR. Do not stop after just analyzing or describing the changes. But DO stop if step 1 reveals that an existing PR already addresses the same issue — do not create duplicate PRs.`;

export const LOOP_TEMPLATES: LoopTemplate[] = [
  {
    id: 'bug-hunter',
    name: 'Bug Hunter',
    description: 'Find and fix a random bug, then create a PR',
    defaultInterval: '8h',
    promptTemplate: `Scan this project for bugs, code smells, edge cases, TODO/FIXME items, and error-prone patterns. Pick ONE issue at random to keep changes small and reviewable. Implement the fix, write tests if appropriate. Do not pick issues that are purely cosmetic or style-related — focus on functional correctness and robustness.${PR_WORKFLOW}`,
    configFields: [
      { key: 'projectPath', label: 'Project path', type: 'directory' },
    ],
  },
  {
    id: 'code-review',
    name: 'Code Reviewer',
    description: 'Review recent commits and leave feedback',
    defaultInterval: '4h',
    promptTemplate: `Review the last few commits in this project. For each commit, check for bugs, security issues, performance problems, and style inconsistencies. If you find issues, create an issue in the project's issue tracker (GitHub Issues, Azure DevOps work items, etc.) describing the problem and suggesting a fix. Be constructive and specific. Output links to any issues you created.

IMPORTANT: You MUST actually create the issues, not just describe them. Use the appropriate CLI tool (gh issue create, az boards work-item create, etc.).`,
    configFields: [
      { key: 'projectPath', label: 'Project path', type: 'directory' },
    ],
  },
  {
    id: 'dep-updater',
    name: 'Dependency Updater',
    description: 'Check for outdated dependencies and update them',
    defaultInterval: '24h',
    promptTemplate: `Check this project for outdated dependencies. Pick ONE dependency to update. Verify compatibility by checking changelogs and running tests. If everything passes, include a summary of what changed in the dependency.${PR_WORKFLOW}`,
    configFields: [
      { key: 'projectPath', label: 'Project path', type: 'directory' },
    ],
  },
  {
    id: 'test-writer',
    name: 'Test Writer',
    description: 'Find untested code and write tests for it',
    defaultInterval: '6h',
    promptTemplate: `Analyze this project's test coverage. Find a function, module, or code path that lacks tests. Write thorough tests for it, including edge cases and error scenarios.${PR_WORKFLOW}`,
    configFields: [
      { key: 'projectPath', label: 'Project path', type: 'directory' },
    ],
  },
  {
    id: 'warning-fixer',
    name: 'Warning Fixer',
    description: 'Find and fix build warnings',
    defaultInterval: '8h',
    promptTemplate: `Run the build for this project and examine any warnings produced. Pick up to 5 warnings to fix in this run. For each warning, implement the proper fix (don't just suppress it). Run the build again to verify the warnings are resolved and no new ones were introduced.${PR_WORKFLOW}`,
    configFields: [
      { key: 'projectPath', label: 'Project path', type: 'directory' },
    ],
  },
  {
    id: 'doc-writer',
    name: 'Documentation Writer',
    description: 'Find undocumented code and add documentation',
    defaultInterval: '12h',
    promptTemplate: `Analyze this project for areas lacking documentation — functions without JSDoc/docstrings, missing README sections, undocumented APIs, or complex logic without explanatory comments. Pick ONE area to document thoroughly.${PR_WORKFLOW}`,
    configFields: [
      { key: 'projectPath', label: 'Project path', type: 'directory' },
    ],
  },
  {
    id: 'pr-review-pipeline',
    name: 'PR Review Pipeline',
    description: 'Automatically review unreviewed PRs, post comments to ADO, and auto-merge safe PRs',
    defaultInterval: '30m',
    scheduleType: 'pr-review-pipeline',
    promptTemplate: '',
    configFields: [{ key: 'projectPath', label: 'Project path', type: 'directory' }],
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Run any prompt on a schedule',
    defaultInterval: '10m',
    promptTemplate: '',
    configFields: [],
  },
];
