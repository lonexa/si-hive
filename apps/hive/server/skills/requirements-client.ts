/**
 * Client for the `skill_requirements` table in the shared database (see
 * ./migrations.ts).
 *
 * Maps a repo (by normalized git origin URL) or a topic (by keywords scanned in
 * a user's prompts) to the team-approved skill that should be installed there.
 * Lives alongside the Sharing feature's tables, so requirements are shared by
 * everyone on the same shared database.
 */

import { sql } from 'kysely';
import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  nowIso,
  affectedRows,
} from '../../../../packages/shared/src/server/storage/index.js';
import type { KBConnectionConfig } from '../kb/client.js';

const TABLE = 'skill_requirements';

export type SkillRequirementContextType = 'repo' | 'topic';

export interface SkillRequirement {
  id: number;
  contextType: SkillRequirementContextType;
  contextKey: string;        // repo: normalized origin URL; topic: slug
  contextLabel: string | null;
  keywords: string | null;   // topic: comma-separated trigger keywords
  skillName: string;
  required: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface CreateSkillRequirementInput {
  contextType: SkillRequirementContextType;
  contextKey: string;
  contextLabel?: string | null;
  keywords?: string | null;
  skillName: string;
  required?: boolean;
  createdBy?: string | null;
}

/**
 * Normalize a git remote URL to a stable host/org/repo identity so a
 * requirement matches any clone regardless of protocol, credentials, .git
 * suffix, or local folder name.
 *   https://user@dev.azure.com/Org/Proj/_git/Repo.git -> dev.azure.com/org/proj/_git/repo
 *   git@github.com:org/repo.git                        -> github.com/org/repo
 */
export function normalizeRemoteUrl(raw: string): string {
  let u = (raw || '').trim();
  if (!u) return '';
  const scp = u.match(/^[a-z0-9._-]+@([^:/]+):(.+)$/i); // scp-style git@host:path
  if (scp) {
    u = `${scp[1]}/${scp[2]}`;
  } else {
    u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // strip scheme
    u = u.replace(/^[^@/]+@/, '');                  // strip user[:pass]@ credentials
  }
  return u.toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
}

/** Make a URL/keyword-safe slug from a topic label. */
export function slugify(label: string): string {
  return (label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'topic';
}

export class SkillRequirementsClient {
  /** The config argument is ignored — kept for API compatibility. */
  constructor(_config?: KBConnectionConfig | null) {
    /* shared DB connection is process-wide */
  }

  private static normalize(row: Record<string, unknown>): SkillRequirement {
    return { ...(row as unknown as SkillRequirement), id: Number(row.id), required: !!row.required };
  }

  /** All requirements — for the admin config page. */
  async list(): Promise<SkillRequirement[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom(TABLE).selectAll()
      .orderBy('contextType')
      // NULL labels sort first on every dialect
      .orderBy(sql`coalesce(${sql.ref('contextLabel')}, '')`)
      .orderBy('skillName')
      .execute();
    return rows.map(SkillRequirementsClient.normalize);
  }

  /** Requirements of one type — used by the banner's repo/topic matching. */
  async listByType(type: SkillRequirementContextType): Promise<SkillRequirement[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom(TABLE).selectAll().where('contextType', '=', type).execute();
    return rows.map(SkillRequirementsClient.normalize);
  }

  async create(input: CreateSkillRequirementInput): Promise<SkillRequirement> {
    const db = await getSharedDb();
    try {
      const row = await insertReturning(db, getSharedDialect(), TABLE, {
        contextType: input.contextType,
        contextKey: input.contextKey,
        contextLabel: input.contextLabel ?? null,
        keywords: input.keywords ?? null,
        skillName: input.skillName,
        required: input.required === false ? 0 : 1,
        createdBy: input.createdBy ?? null,
        createdAt: nowIso(),
      });
      return SkillRequirementsClient.normalize(row);
    } catch (err: unknown) {
      // Unique-violation wording differs per dialect; normalize it so callers
      // can match on UQ_skillreq / "duplicate".
      const msg = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate|UQ_skillreq/i.test(msg)) {
        throw new Error(`duplicate skill requirement (UQ_skillreq): ${msg}`);
      }
      throw err;
    }
  }

  async delete(id: number): Promise<boolean> {
    const db = await getSharedDb();
    return affectedRows(await db.deleteFrom(TABLE).where('id', '=', id).executeTakeFirst()) > 0;
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}
