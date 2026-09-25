import fs from 'node:fs';
import path from 'node:path';

// --- Types ---

export interface Dependency {
  name: string;
  version: string;
  type: 'runtime' | 'dev' | 'build' | 'test';
}

export interface DependencyFile {
  filePath: string;        // relative to project root
  ecosystem: string;       // 'nuget' | 'npm' | 'python' | 'dotnet-tool' | etc.
  framework?: string;      // e.g. 'net8.0', 'node 20', etc.
  dependencies: Dependency[];
}

export interface DatabaseDependency {
  name: string;
  connectionType: string;  // 'SQL Server', 'SQLite', 'PostgreSQL', etc.
  source: string;          // file where it was found
}

export interface ProjectDependencies {
  projectType: string;     // 'C#/.NET', 'Node.js', 'Python', 'Mixed', 'Unknown'
  files: DependencyFile[];
  databases: DatabaseDependency[];
  summary: {
    totalPackages: number;
    ecosystems: string[];
    frameworks: string[];
  };
}

// --- File discovery patterns ---

const DEPENDENCY_PATTERNS: Array<{
  glob: string;
  ecosystem: string;
  parser: (content: string, filePath: string) => DependencyFile;
}> = [
  { glob: '*.csproj', ecosystem: 'nuget', parser: parseCsproj },
  { glob: 'packages.config', ecosystem: 'nuget', parser: parsePackagesConfig },
  { glob: 'package.json', ecosystem: 'npm', parser: parsePackageJson },
  { glob: 'requirements.txt', ecosystem: 'python', parser: parseRequirementsTxt },
  { glob: 'pyproject.toml', ecosystem: 'python', parser: parsePyprojectToml },
  { glob: '*.fsproj', ecosystem: 'nuget', parser: parseCsproj },
  { glob: '*.vbproj', ecosystem: 'nuget', parser: parseCsproj },
];

// Directories to skip during scanning
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'bin', 'obj', 'dist', 'build', '.vs',
  '.vscode', '__pycache__', '.mypy_cache', 'venv', '.venv', 'env',
  'packages', '.nuget', 'TestResults', 'artifacts',
]);

export class DependenciesClient {
  /**
   * Scan a project directory and return all discovered dependencies.
   */
  scan(projectPath: string): ProjectDependencies {
    if (!fs.existsSync(projectPath)) {
      return emptyResult('Unknown');
    }

    const files: DependencyFile[] = [];
    const databases: DatabaseDependency[] = [];

    // Recursively find dependency files (max depth 5)
    this.walkDir(projectPath, projectPath, 0, 5, files);

    // Scan for database connection strings
    this.scanForDatabases(projectPath, projectPath, 0, 3, databases);

    // Determine project type
    const ecosystems = [...new Set(files.map(f => f.ecosystem))];
    let projectType = 'Unknown';
    if (ecosystems.includes('nuget')) projectType = 'C#/.NET';
    else if (ecosystems.includes('npm')) projectType = 'Node.js';
    else if (ecosystems.includes('python')) projectType = 'Python';
    if (ecosystems.length > 1) projectType = `Mixed (${ecosystems.join(', ')})`;

    const frameworks = [...new Set(files.map(f => f.framework).filter(Boolean) as string[])];
    const totalPackages = files.reduce((sum, f) => sum + f.dependencies.length, 0);

    return {
      projectType,
      files,
      databases,
      summary: {
        totalPackages,
        ecosystems,
        frameworks,
      },
    };
  }

  private walkDir(
    rootPath: string,
    dirPath: string,
    depth: number,
    maxDepth: number,
    results: DependencyFile[]
  ): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          this.walkDir(rootPath, fullPath, depth + 1, maxDepth, results);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      for (const pattern of DEPENDENCY_PATTERNS) {
        if (matchGlob(entry.name, pattern.glob)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
            const parsed = pattern.parser(content, relativePath);
            if (parsed.dependencies.length > 0 || parsed.framework) {
              results.push(parsed);
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    }
  }

  private scanForDatabases(
    rootPath: string,
    dirPath: string,
    depth: number,
    maxDepth: number,
    results: DatabaseDependency[]
  ): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    const dbFilePatterns = [
      'appsettings.json', 'appsettings.Development.json', 'appsettings.Production.json',
      'web.config', 'app.config', 'Web.config', 'App.config',
      '.env', '.env.local', '.env.development',
    ];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          this.scanForDatabases(rootPath, fullPath, depth + 1, maxDepth, results);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (!dbFilePatterns.includes(entry.name)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
        this.extractConnectionStrings(content, relativePath, results);
      } catch {
        // skip
      }
    }
  }

  private extractConnectionStrings(
    content: string,
    source: string,
    results: DatabaseDependency[]
  ): void {
    // SQL Server connection strings
    const sqlServerPattern = /(?:Data Source|Server)\s*=\s*([^;"\n]+)/gi;
    let match: RegExpExecArray | null;
    const seen = new Set<string>();

    while ((match = sqlServerPattern.exec(content)) !== null) {
      const server = match[1].trim();
      // Extract database name if present
      const dbMatch = content.substring(Math.max(0, match.index - 200), match.index + 500)
        .match(/(?:Initial Catalog|Database)\s*=\s*([^;"\n]+)/i);
      const dbName = dbMatch ? dbMatch[1].trim() : server;
      const key = `sqlserver:${dbName}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ name: dbName, connectionType: 'SQL Server', source });
      }
    }

    // SQLite
    const sqlitePattern = /(?:Data Source|Filename)\s*=\s*([^;"\n]*\.(?:db|sqlite|sqlite3))/gi;
    while ((match = sqlitePattern.exec(content)) !== null) {
      const dbFile = match[1].trim();
      const key = `sqlite:${dbFile}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ name: path.basename(dbFile), connectionType: 'SQLite', source });
      }
    }

    // PostgreSQL URLs
    const pgPattern = /postgres(?:ql)?:\/\/[^\s"']+/gi;
    while ((match = pgPattern.exec(content)) !== null) {
      const url = match[0];
      const key = `pg:${url}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Extract db name from URL
        const parts = url.split('/');
        const dbName = parts[parts.length - 1]?.split('?')[0] || 'PostgreSQL';
        results.push({ name: dbName, connectionType: 'PostgreSQL', source });
      }
    }

    // MongoDB URLs
    const mongoPattern = /mongodb(?:\+srv)?:\/\/[^\s"']+/gi;
    while ((match = mongoPattern.exec(content)) !== null) {
      const url = match[0];
      const key = `mongo:${url}`;
      if (!seen.has(key)) {
        seen.add(key);
        const parts = url.split('/');
        const dbName = parts[parts.length - 1]?.split('?')[0] || 'MongoDB';
        results.push({ name: dbName, connectionType: 'MongoDB', source });
      }
    }
  }
}

// --- Parsers ---

function parseCsproj(content: string, filePath: string): DependencyFile {
  const deps: Dependency[] = [];
  let framework: string | undefined;

  // Extract target framework
  const tfMatch = content.match(/<TargetFramework(?:s)?>(.*?)<\/TargetFramework(?:s)?>/i);
  if (tfMatch) {
    framework = tfMatch[1].split(';')[0]; // take first if multiple
  }

  // PackageReference elements
  const pkgPattern = /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]*)")?[^>]*(?:\/>|>(?:[\s\S]*?<\/PackageReference>))/gi;
  let match: RegExpExecArray | null;
  while ((match = pkgPattern.exec(content)) !== null) {
    const name = match[1];
    let version = match[2] || '';
    // Check for Version as child element
    if (!version) {
      const innerMatch = match[0].match(/<Version>(.*?)<\/Version>/i);
      if (innerMatch) version = innerMatch[1];
    }
    // Determine type from common conventions
    const lowerName = name.toLowerCase();
    let type: Dependency['type'] = 'runtime';
    if (lowerName.includes('.test') || lowerName.includes('xunit') || lowerName.includes('nunit') || lowerName.includes('mstest')) {
      type = 'test';
    } else if (lowerName.includes('.analyzers') || lowerName.includes('.codegen') || lowerName.includes('.sourcegenerat')) {
      type = 'build';
    }
    deps.push({ name, version, type });
  }

  // DotNetCliToolReference
  const toolPattern = /<DotNetCliToolReference\s+Include="([^"]+)"(?:\s+Version="([^"]*)")?/gi;
  while ((match = toolPattern.exec(content)) !== null) {
    deps.push({ name: match[1], version: match[2] || '', type: 'build' });
  }

  // ProjectReference (show as dependencies too)
  const projRefPattern = /<ProjectReference\s+Include="([^"]+)"/gi;
  while ((match = projRefPattern.exec(content)) !== null) {
    const refPath = match[1].replace(/\\/g, '/');
    const refName = path.basename(refPath, path.extname(refPath));
    deps.push({ name: `[Project] ${refName}`, version: 'local', type: 'runtime' });
  }

  return { filePath, ecosystem: 'nuget', framework, dependencies: deps };
}

function parsePackagesConfig(content: string, filePath: string): DependencyFile {
  const deps: Dependency[] = [];
  const pattern = /<package\s+id="([^"]+)"\s+version="([^"]+)"(?:\s+targetFramework="([^"]*)")?/gi;
  let match: RegExpExecArray | null;
  let framework: string | undefined;

  while ((match = pattern.exec(content)) !== null) {
    if (!framework && match[3]) framework = match[3];
    deps.push({ name: match[1], version: match[2], type: 'runtime' });
  }

  return { filePath, ecosystem: 'nuget', framework, dependencies: deps };
}

function parsePackageJson(content: string, filePath: string): DependencyFile {
  const deps: Dependency[] = [];
  let framework: string | undefined;

  try {
    const pkg = JSON.parse(content);

    // Engine info
    if (pkg.engines?.node) framework = `node ${pkg.engines.node}`;

    // Regular dependencies
    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        deps.push({ name, version: String(version), type: 'runtime' });
      }
    }

    // Dev dependencies
    if (pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        const lowerName = name.toLowerCase();
        let type: Dependency['type'] = 'dev';
        if (lowerName.includes('jest') || lowerName.includes('mocha') || lowerName.includes('vitest') || lowerName.includes('testing')) {
          type = 'test';
        }
        deps.push({ name, version: String(version), type });
      }
    }
  } catch {
    // invalid JSON
  }

  return { filePath, ecosystem: 'npm', framework, dependencies: deps };
}

function parseRequirementsTxt(content: string, filePath: string): DependencyFile {
  const deps: Dependency[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;

    // Handle: package==1.0, package>=1.0, package~=1.0, package
    const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*(?:([=<>!~]+)\s*(.+))?/);
    if (match) {
      const version = match[3] ? `${match[2]}${match[3]}` : '*';
      deps.push({ name: match[1], version, type: 'runtime' });
    }
  }

  return { filePath, ecosystem: 'python', dependencies: deps };
}

function parsePyprojectToml(content: string, filePath: string): DependencyFile {
  const deps: Dependency[] = [];
  let framework: string | undefined;

  // Extract python version requirement
  const pyMatch = content.match(/requires-python\s*=\s*"([^"]+)"/);
  if (pyMatch) framework = `python ${pyMatch[1]}`;

  // Extract dependencies from [project.dependencies] or [tool.poetry.dependencies]
  // Simple TOML parsing for dependency arrays
  const depsMatch = content.match(/\[(?:project|tool\.poetry)\.dependencies\]([\s\S]*?)(?=\n\[|\n$)/);
  if (depsMatch) {
    const section = depsMatch[1];
    // Array style: dependencies = ["package>=1.0", ...]
    const arrayMatch = section.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (arrayMatch) {
      const items = arrayMatch[1].match(/"([^"]+)"/g);
      if (items) {
        for (const item of items) {
          const cleaned = item.replace(/"/g, '');
          const m = cleaned.match(/^([a-zA-Z0-9_.-]+)\s*(.*)/);
          if (m) deps.push({ name: m[1], version: m[2] || '*', type: 'runtime' });
        }
      }
    }
    // TOML table style: package = "^1.0" or package = {version = "^1.0"}
    for (const line of section.split('\n')) {
      const tableMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (tableMatch && tableMatch[1] !== 'python') {
        deps.push({ name: tableMatch[1], version: tableMatch[2], type: 'runtime' });
      }
    }
  }

  // Dev dependencies
  const devMatch = content.match(/\[tool\.poetry\.(?:group\.)?dev(?:-dependencies|\.dependencies)\]([\s\S]*?)(?=\n\[|\n$)/);
  if (devMatch) {
    for (const line of devMatch[1].split('\n')) {
      const m = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (m) deps.push({ name: m[1], version: m[2], type: 'dev' });
    }
  }

  return { filePath, ecosystem: 'python', framework, dependencies: deps };
}

// --- Helpers ---

function matchGlob(filename: string, pattern: string): boolean {
  if (pattern.startsWith('*')) {
    return filename.endsWith(pattern.substring(1));
  }
  return filename === pattern;
}

function emptyResult(projectType: string): ProjectDependencies {
  return {
    projectType,
    files: [],
    databases: [],
    summary: { totalPackages: 0, ecosystems: [], frameworks: [] },
  };
}

// Singleton
export const dependenciesClient = new DependenciesClient();
