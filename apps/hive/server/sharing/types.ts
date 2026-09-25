export type SharedItemType = 'skill' | 'agent' | 'plugin_config' | 'settings_template' | 'snippet' | 'plan' | 'hook';
export type SharedScope = 'shared' | 'user';

export interface SharedItem {
  id: number;
  name: string;
  item_type: SharedItemType;
  description: string;
  tags: string;
  version: number;
  scope: SharedScope;
  scope_owner: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SharedItemFile {
  id: number;
  item_id: number;
  file_path: string;
  content: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface SharedItemWithFiles extends SharedItem {
  files: SharedItemFile[];
}

export interface PublishItemInput {
  name: string;
  item_type: SharedItemType;
  description?: string;
  tags?: string;
  scope?: SharedScope;
  scope_owner?: string;
  created_by?: string;
  files: { file_path: string; content: string; is_primary?: boolean }[];
}

export interface UpdateItemInput {
  name?: string;
  description?: string;
  tags?: string;
  scope?: SharedScope;
  scope_owner?: string;
  files?: { file_path: string; content: string; is_primary?: boolean }[];
}
