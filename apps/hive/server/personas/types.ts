export type PersonaScope = 'shared' | 'user';

export interface Persona {
  id: number;
  name: string;
  description: string;
  content: string;
  tags: string;          // comma-separated
  scope: PersonaScope;
  scope_owner: string;   // username when scope='user', empty when scope='shared'
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PersonaInput {
  name: string;
  content: string;
  description?: string;
  tags?: string;
  scope?: PersonaScope;
  scope_owner?: string;
  created_by?: string;
}

export interface PersonaAssignment {
  id: number;
  persona_id: number;
  project_path: string;
  user_id: string;
  assigned_at: string;
}
