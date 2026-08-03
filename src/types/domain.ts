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
}
