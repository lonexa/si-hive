export type KBScope = 'shared' | 'user';

export interface KBEntry {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string;          // comma-separated
  scope: KBScope;
  scope_owner: string;   // username when scope='user', empty when scope='shared'
  source: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface KBEntryInput {
  title: string;
  content: string;
  category?: string;
  tags?: string;
  scope?: KBScope;
  scope_owner?: string;
  source?: string;
  created_by?: string;
}

/**
 * Where the KB lives. The KB is stored in the shared database (see
 * ./storage), so this is descriptive only — kept so callers that pass a
 * config to `new KBClient(config)` keep compiling.
 */
export interface KBConnectionConfig {
  dialect: 'sqlite' | 'postgres' | 'mssql';
  /** Host for postgres/mssql; empty for sqlite. */
  server: string;
  /** Database name for postgres/mssql; file path for sqlite. */
  database: string;
  /** Always empty — tables are unqualified in the shared database. */
  schema: string;
}
