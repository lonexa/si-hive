import fs from 'node:fs';
import path from 'node:path';

export interface SecretFinding {
  file: string;
  line: number;
  column: number;
  type: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  match: string; // redacted match preview
}

export interface SecretsReport {
  projectPath: string;
  scanDate: string;
  totalFindings: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  findings: SecretFinding[];
  filesScanned: number;
  filesSkipped: number;
  errors: string[];
}

interface PatternDef {
  name: string;
  regex: RegExp;
  severity: 'high' | 'medium' | 'low';
  description: string;
}

const PATTERNS: PatternDef[] = [
  // AWS
  {
    name: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/,
    severity: 'high',
    description: 'AWS Access Key ID detected',
  },
  {
    name: 'AWS Secret Key',
    regex: /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/i,
    severity: 'high',
    description: 'AWS Secret Access Key detected',
  },
  // Azure
  {
    name: 'Azure Connection String',
    regex: /AccountKey=[A-Za-z0-9+/=]{44,}/,
    severity: 'high',
    description: 'Azure Storage Account Key in connection string',
  },
  // Generic API keys
  {
    name: 'API Key Assignment',
    regex: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"]([A-Za-z0-9_\-]{20,})['"](?!\s*[;,]?\s*(?:\/\/|#|\/\*)\s*(?:placeholder|example|your|replace|todo|fixme|xxx))/i,
    severity: 'high',
    description: 'API key assignment detected',
  },
  // Tokens
  {
    name: 'Bearer Token',
    regex: /['"]Bearer\s+[A-Za-z0-9\-_.~+/]{20,}['"]/,
    severity: 'high',
    description: 'Hardcoded Bearer token detected',
  },
  {
    name: 'GitHub Token',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    severity: 'high',
    description: 'GitHub personal access token detected',
  },
  {
    name: 'Slack Token',
    regex: /xox[bporas]-[0-9]{10,}-[A-Za-z0-9]{10,}/,
    severity: 'high',
    description: 'Slack token detected',
  },
  // Passwords in config
  {
    name: 'Password in Config',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{4,})['"](?!\s*[;,]?\s*(?:\/\/|#|\/\*)\s*(?:placeholder|example|your|replace|todo|fixme|xxx))/i,
    severity: 'high',
    description: 'Password value in configuration',
  },
  // Connection strings with credentials
  {
    name: 'SQL Connection String',
    regex: /(?:Server|Data Source)=[^;]+;.*(?:Password|Pwd)=[^;]+/i,
    severity: 'high',
    description: 'SQL connection string with embedded password',
  },
  {
    name: 'MongoDB URI with Password',
    regex: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/i,
    severity: 'high',
    description: 'MongoDB URI with embedded credentials',
  },
  // Private keys
  {
    name: 'Private Key',
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
    severity: 'high',
    description: 'Private key detected',
  },
  // JWT secrets
  {
    name: 'JWT Secret',
    regex: /(?:jwt[_-]?secret|jwt[_-]?key)\s*[:=]\s*['"]([^'"]{8,})['"]/i,
    severity: 'high',
    description: 'JWT secret value detected',
  },
  // Generic secrets in env-like contexts
  {
    name: 'Secret Assignment',
    regex: /(?:secret|token|auth[_-]?key|client[_-]?secret)\s*[:=]\s*['"]([A-Za-z0-9_\-]{16,})['"](?!\s*[;,]?\s*(?:\/\/|#|\/\*)\s*(?:placeholder|example|your|replace|todo|fixme|xxx))/i,
    severity: 'medium',
    description: 'Secret or token value assignment',
  },
  // .env file patterns (non-empty values for sensitive keys)
  {
    name: 'Env Secret Variable',
    regex: /^(?:DATABASE_URL|DB_PASSWORD|SECRET_KEY|API_KEY|PRIVATE_KEY|ACCESS_TOKEN|AUTH_TOKEN|ENCRYPTION_KEY)\s*=\s*[^\s#].+/m,
    severity: 'medium',
    description: 'Sensitive environment variable with value',
  },
  // Hardcoded IP addresses with ports (could be internal services)
  {
    name: 'Hardcoded Internal URL',
    regex: /['"]https?:\/\/(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)\d+\.\d+(?::\d+)?['"]/,
    severity: 'low',
    description: 'Hardcoded internal IP address',
  },
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.cache',
  'coverage', '.nyc_output', '__pycache__', '.venv', 'venv',
  'bin', 'obj', '.vs', '.idea', 'packages', 'bower_components',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.ttf', '.woff', '.woff2', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.lock', '.map',
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.toml',
  '.env', '.cfg', '.conf', '.config', '.ini', '.properties',
  '.py', '.cs', '.java', '.go', '.rs', '.rb', '.php',
  '.xml', '.html', '.md', '.txt', '.sh', '.bash', '.ps1',
  '.tf', '.tfvars', '.hcl', '.dockerfile',
  '',  // files with no extension (like Dockerfile, Makefile, etc.)
]);

const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512KB

function redactSecret(match: string): string {
  if (match.length <= 8) return '***';
  const visible = Math.min(4, Math.floor(match.length / 4));
  return match.substring(0, visible) + '***' + match.substring(match.length - visible);
}

export class SecretsClient {
  scanProject(projectPath: string): SecretsReport {
    const resolvedPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Project path is not a directory: ${resolvedPath}`);
    }

    const findings: SecretFinding[] = [];
    const errors: string[] = [];
    let filesScanned = 0;
    let filesSkipped = 0;

    this.walkDirectory(resolvedPath, resolvedPath, (filePath, stats) => {
      const ext = path.extname(filePath).toLowerCase();
      const basename = path.basename(filePath).toLowerCase();

      // Skip binary files
      if (BINARY_EXTENSIONS.has(ext)) {
        filesSkipped++;
        return;
      }

      // Skip files that are too large
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        filesSkipped++;
        return;
      }

      // Only scan files with known scannable extensions, or specific filenames
      const isSpecialFile = ['dockerfile', 'makefile', '.env', '.gitignore', '.dockerignore'].includes(basename)
        || basename.startsWith('.env');
      if (!isSpecialFile && !SCANNABLE_EXTENSIONS.has(ext)) {
        filesSkipped++;
        return;
      }

      filesScanned++;
      const relPath = path.relative(resolvedPath, filePath).replace(/\\/g, '/');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Skip comment-only lines (basic heuristic)
          const trimmed = line.trim();
          if (trimmed.startsWith('//') && !trimmed.includes('password') && !trimmed.includes('secret')) continue;

          for (const pattern of PATTERNS) {
            const match = line.match(pattern.regex);
            if (match) {
              // Check for false positives: skip if it looks like a placeholder or env var reference
              const matchText = match[0];
              if (this.isFalsePositive(matchText, line)) continue;

              findings.push({
                file: relPath,
                line: i + 1,
                column: (match.index ?? 0) + 1,
                type: pattern.name,
                severity: pattern.severity,
                description: pattern.description,
                match: redactSecret(match[1] || match[0]),
              });
              break; // One finding per line to avoid duplicates
            }
          }
        }
      } catch {
        // Skip files that can't be read as UTF-8
      }
    }, errors);

    const highCount = findings.filter(f => f.severity === 'high').length;
    const mediumCount = findings.filter(f => f.severity === 'medium').length;
    const lowCount = findings.filter(f => f.severity === 'low').length;

    return {
      projectPath: resolvedPath,
      scanDate: new Date().toISOString(),
      totalFindings: findings.length,
      highCount,
      mediumCount,
      lowCount,
      findings: findings.slice(0, 500), // Limit to 500 findings
      filesScanned,
      filesSkipped,
      errors,
    };
  }

  private isFalsePositive(matchText: string, line: string): boolean {
    const lower = matchText.toLowerCase();
    const lineLower = line.toLowerCase();

    // Placeholder values
    const placeholders = [
      'your_', 'replace_', 'changeme', 'placeholder', 'example',
      'todo', 'fixme', 'xxx', 'xxxxxxxx', 'your-', '<your',
      'insert_', 'put_your', 'enter_your', 'sample', 'test123',
      'dummy', 'fake', 'mock',
    ];
    if (placeholders.some(p => lower.includes(p))) return true;

    // Environment variable references (e.g., process.env.API_KEY)
    if (lineLower.includes('process.env') || lineLower.includes('os.environ') || lineLower.includes('${')) return true;

    // Configuration schema / type definitions
    if (lineLower.includes('interface ') || lineLower.includes('type ') || lineLower.includes('@param')) return true;

    return false;
  }

  private walkDirectory(
    dir: string,
    rootDir: string,
    callback: (filePath: string, stats: fs.Stats) => void,
    errors: string[],
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          this.walkDirectory(fullPath, rootDir, callback, errors);
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          callback(fullPath, stats);
        }
      } catch (err) {
        errors.push(`Cannot access: ${path.relative(rootDir, fullPath)}`);
      }
    }
  }
}
