import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  nowIso,
} from '../../../../packages/shared/src/server/storage/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoTimeRow {
  Username: string;
  ProjectPath: string | null;
  TotalSeconds: number;
  EntryDate: string;
}

export interface ManualTimeRow {
  Id: number;
  Username: string;
  ProjectPath: string | null;
  WorkItemId: number | null;
  Hours: number;
  Description: string | null;
  Source: string;
  EntryDate: string;
  CreatedAt: string;
}

/** Tracker-reported time. Not collected by this client — always empty. */
export interface DevOpsTimeRow {
  id: number;
  title: string;
  completedWork: number | null;
  remainingWork: number | null;
  assignedTo: string | null;
  state: string;
}

export interface ManualTimeEntry {
  username: string;
  projectPath: string;
  workItemId: number | null;
  hours: number;
  description: string;
  /** YYYY-MM-DD */
  entryDate: string;
}

export interface TimeData {
  autoTime: AutoTimeRow[];
  manualTime: ManualTimeRow[];
  devOpsTime: DevOpsTimeRow[];
  warnings: string[];
}

interface TimeEntryRow {
  id: number;
  username: string;
  project_path: string | null;
  work_item_id: number | null;
  hours: number;
  description: string | null;
  source: string;
  entry_date: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Client — manual time entries in the shared time_entries table. Auto time
// comes from the local turn tracker (see turn-time-tracker.ts).
// ---------------------------------------------------------------------------

export class TimeClient {
  async getManualTime(days: number = 30): Promise<ManualTimeRow[]> {
    const db = await getSharedDb();
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = await db.selectFrom('time_entries').selectAll()
      .where('entry_date', '>=', since)
      .orderBy('entry_date', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map((r) => toManualTimeRow(r as TimeEntryRow));
  }

  async insertManualTime(entry: ManualTimeEntry): Promise<ManualTimeRow> {
    const db = await getSharedDb();
    const row = await insertReturning<TimeEntryRow>(db, getSharedDialect(), 'time_entries', {
      username: entry.username,
      project_path: entry.projectPath,
      work_item_id: entry.workItemId,
      hours: entry.hours,
      description: entry.description,
      source: 'manual',
      entry_date: entry.entryDate,
      created_at: nowIso(),
    });
    return toManualTimeRow(row);
  }

  async getTimeData(days: number = 30): Promise<TimeData> {
    return {
      autoTime: [],
      manualTime: await this.getManualTime(days),
      devOpsTime: [],
      warnings: [],
    };
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}

function toManualTimeRow(r: TimeEntryRow): ManualTimeRow {
  return {
    Id: Number(r.id),
    Username: r.username,
    ProjectPath: r.project_path ?? null,
    WorkItemId: r.work_item_id == null ? null : Number(r.work_item_id),
    Hours: Number(r.hours),
    Description: r.description ?? null,
    Source: r.source,
    EntryDate: r.entry_date,
    CreatedAt: r.created_at,
  };
}
