import fs from 'node:fs';
import path from 'node:path';
import { complete } from '../ai/llm.js';

export type DocType = 'api' | 'schema' | 'readme' | 'onboarding';

export interface GenerateDocsRequest {
  filePaths: string[];
  docType: DocType;
  projectRoot?: string;
  additionalContext?: string;
}

export interface GenerateDocsResponse {
  markdown: string;
  docType: DocType;
  filesProcessed: number;
  generatedAt: string;
}


function readFilesSafe(filePaths: string[], projectRoot?: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const MAX_FILE_SIZE = 50_000; // 50KB max per file

  for (const fp of filePaths) {
    // Resolve path relative to projectRoot if provided
    const resolved = projectRoot ? path.resolve(projectRoot, fp) : path.resolve(fp);

    // Security: prevent directory traversal outside projectRoot
    if (projectRoot) {
      const resolvedRoot = path.resolve(projectRoot);
      if (!resolved.startsWith(resolvedRoot)) {
        console.warn(`[docs] Skipping file outside project root: ${fp}`);
        continue;
      }
    }

    try {
      const stat = fs.statSync(resolved);
      if (stat.size > MAX_FILE_SIZE) {
        // Read first 50KB only
        const fd = fs.openSync(resolved, 'r');
        const buffer = Buffer.alloc(MAX_FILE_SIZE);
        fs.readSync(fd, buffer, 0, MAX_FILE_SIZE, 0);
        fs.closeSync(fd);
        files.push({ path: fp, content: buffer.toString('utf-8') + '\n... (truncated)' });
      } else {
        const content = fs.readFileSync(resolved, 'utf-8');
        files.push({ path: fp, content });
      }
    } catch (err) {
      console.warn(`[docs] Could not read file ${fp}:`, err);
    }
  }

  return files;
}

const DOC_TYPE_PROMPTS: Record<DocType, { system: string; buildUserPrompt: (files: Array<{ path: string; content: string }>, additionalContext?: string) => string }> = {
  api: {
    system: `You are a technical documentation generator. Generate comprehensive API endpoint documentation in Markdown format.
For each controller/route handler found:
- Document the HTTP method, URL pattern, request parameters, request body schema, response schema
- Include example requests and responses
- Note authentication requirements
- Document error responses
Output clean Markdown with proper headings, tables, and code blocks.`,
    buildUserPrompt: (files, ctx) => {
      const fileContents = files.map((f) => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
      return `Generate API documentation for these source files:\n\n${fileContents}${ctx ? `\n\nAdditional context: ${ctx}` : ''}`;
    },
  },
  schema: {
    system: `You are a database documentation generator. Generate comprehensive database schema documentation in Markdown format.
For each table/entity found:
- Document table name, description, columns with data types
- Note primary keys, foreign keys, indexes
- Document relationships between tables
- Include an entity-relationship summary
Output clean Markdown with proper headings and tables.`,
    buildUserPrompt: (files, ctx) => {
      const fileContents = files.map((f) => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
      return `Generate database schema documentation from these files:\n\n${fileContents}${ctx ? `\n\nAdditional context: ${ctx}` : ''}`;
    },
  },
  readme: {
    system: `You are a project documentation generator. Generate a comprehensive README.md in Markdown format.
Include:
- Project title and description
- Prerequisites and installation steps
- Configuration
- Usage examples
- Project structure overview
- Contributing guidelines
Output clean, professional Markdown.`,
    buildUserPrompt: (files, ctx) => {
      const fileContents = files.map((f) => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
      return `Generate a README based on these project files:\n\n${fileContents}${ctx ? `\n\nAdditional context: ${ctx}` : ''}`;
    },
  },
  onboarding: {
    system: `You are an onboarding documentation generator. Generate a comprehensive onboarding guide for new developers in Markdown format.
Include:
- Getting started (environment setup, prerequisites)
- Architecture overview
- Key concepts and terminology
- Development workflow
- Common tasks and how-tos
- Troubleshooting tips
- Team conventions and best practices
Output clean, welcoming, and thorough Markdown.`,
    buildUserPrompt: (files, ctx) => {
      const fileContents = files.map((f) => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
      return `Generate an onboarding guide based on these project files:\n\n${fileContents}${ctx ? `\n\nAdditional context: ${ctx}` : ''}`;
    },
  },
};

export async function generateDocs(
  request: GenerateDocsRequest
): Promise<GenerateDocsResponse> {
  const files = readFilesSafe(request.filePaths, request.projectRoot);

  if (files.length === 0) {
    throw new Error('No files could be read from the provided paths');
  }

  // Truncate total content to avoid exceeding token limits
  const MAX_TOTAL_CHARS = 100_000;
  let totalChars = 0;
  const truncatedFiles: Array<{ path: string; content: string }> = [];
  for (const f of files) {
    if (totalChars + f.content.length > MAX_TOTAL_CHARS) {
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (remaining > 500) {
        truncatedFiles.push({ path: f.path, content: f.content.substring(0, remaining) + '\n... (truncated)' });
      }
      break;
    }
    truncatedFiles.push(f);
    totalChars += f.content.length;
  }

  const promptConfig = DOC_TYPE_PROMPTS[request.docType];
  const userPrompt = promptConfig.buildUserPrompt(truncatedFiles, request.additionalContext);

  const markdown = await complete(promptConfig.system, userPrompt, { maxTokens: 4000 });

  return {
    markdown,
    docType: request.docType,
    filesProcessed: truncatedFiles.length,
    generatedAt: new Date().toISOString(),
  };
}

/** List files in a directory tree (for the frontend file picker) */
export function listProjectFiles(
  projectRoot: string,
  options: { extensions?: string[]; maxDepth?: number; maxFiles?: number } = {}
): Array<{ path: string; size: number; isDirectory: boolean }> {
  const extensions = options.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.cs', '.py', '.sql', '.json', '.md'];
  const maxDepth = options.maxDepth ?? 5;
  const maxFiles = options.maxFiles ?? 500;
  const results: Array<{ path: string; size: number; isDirectory: boolean }> = [];

  function walk(dir: string, depth: number) {
    if (depth > maxDepth || results.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Skip common non-source directories
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'bin', 'obj', '.vs', '.idea', '__pycache__', '.next', 'coverage']);

    for (const entry of entries) {
      if (results.length >= maxFiles) return;

      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
        results.push({ path: relPath, size: 0, isDirectory: true });
        walk(fullPath, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.includes(ext)) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
        try {
          const stat = fs.statSync(fullPath);
          results.push({ path: relPath, size: stat.size, isDirectory: false });
        } catch {
          results.push({ path: relPath, size: 0, isDirectory: false });
        }
      }
    }
  }

  walk(projectRoot, 0);
  return results;
}
