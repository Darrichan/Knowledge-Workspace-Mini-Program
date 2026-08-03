export type User = {
  id: string
  public_id: string
  email: string
  display_name: string
}

export type Workspace = {
  id: string
  name: string
  slug: string
}

export type DocumentType = 'document' | 'folder' | 'mindmap' | 'gantt' | 'spreadsheet'

export type DocumentItem = {
  id: string
  workspace_id: string
  parent_id: string | null
  type: DocumentType
  title: string
  content: Record<string, any>
  plain_text: string
  version: number
  updated_at: string
  access_role?: string
  owner_name?: string | null
  published_at?: string | null
}

export type AuthResponse = {
  access_token: string
  token_type: string
  user: User
}

export type WechatBindingStatus = {
  bound: boolean
  nickname: string | null
  avatar_url: string | null
}

export type MindMapNode = {
  id: string
  label: string
  color: string
  parent_id?: string | null
  priority?: number | null
  marker?: string | null
  fontSize?: number
}

export type DocumentVersion = {
  id: string
  document_id: string
  version: number
  title: string
  content: Record<string, any>
  created_by: string
  actor_name?: string | null
  reason: string
  created_at: string
}

export type DocumentShare = {
  id: string
  user_id: string
  email: string
  display_name: string
  permission: 'viewer' | 'editor'
  created_at: string
}

export type MindMapItem = {
  id: string
  document_id: string
  title: string
  graph: Record<string, any>
  theme?: string
  layout?: string
  version: number
  created_at: string
  updated_at: string
}

export type MindMapVersion = {
  id: string
  mind_map_id: string
  version: number
  title: string
  graph: Record<string, any>
  created_by: string
  actor_name?: string | null
  reason: string
  created_at: string
}

export type GanttTask = {
  id: string
  name: string
  start: string
  end: string
  progress: number
}

export type SheetFormat = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  background?: string
  align?: 'left' | 'center' | 'right'
}
