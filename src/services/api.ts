import Taro from '@tarojs/taro'
import type { AuthResponse, DocumentItem, DocumentShare, DocumentType, DocumentVersion, MindMapItem, MindMapVersion, User, WechatBindingStatus, Workspace } from '../types/domain'

const API_BASE = (process.env.TARO_APP_API_BASE || 'http://127.0.0.1:18000/api/v1').replace(/\/$/, '')
const API_MODE = process.env.TARO_APP_API_MODE || 'direct'
const CLOUD_FUNCTION = process.env.TARO_APP_CLOUD_FUNCTION || 'apiGateway'
const TOKEN_KEY = 'kw_mini_token'

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  data?: Record<string, any>
  loading?: boolean
}

type UploadedAsset = {
  url: string
  thumbnail_url: string
  name: string
  size: number
  mime_type: string
}

export async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = Taro.getStorageSync<string>(TOKEN_KEY)

  try {
    const response = API_MODE === 'cloud'
      ? await requestThroughCloud<T>(path, options, token)
      : await requestDirect<T>(path, options, token)

    if (response.statusCode === 401) {
      Taro.removeStorageSync(TOKEN_KEY)
      await Taro.showToast({ title: '登录已过期', icon: 'none' })
      await Taro.reLaunch({ url: '/pages/login/index' })
      throw new Error('登录状态已过期')
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const payload = response.data as any
      throw new Error(payload?.error?.message || payload?.message || payload?.detail || '请求失败，请稍后重试')
    }

    return response.data as T
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('网络连接失败，请检查本地服务')
  }
}

async function requestDirect<T>(path: string, options: ApiOptions, token: string) {
  return Taro.request<T>({
    url: `${API_BASE}${path}`,
    method: options.method || 'GET',
    data: options.data,
    timeout: 12000,
    header: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
}

async function requestThroughCloud<T>(path: string, options: ApiOptions, token: string) {
  const cloudResult = await Taro.cloud.callFunction({
    name: CLOUD_FUNCTION,
    data: {
      path,
      method: options.method || 'GET',
      data: options.data || null,
      token: token || null
    }
  })
  const result = cloudResult.result as { statusCode?: number; data?: T; error?: { message?: string } } | undefined
  if (!result || typeof result.statusCode !== 'number') {
    throw new Error(result?.error?.message || '云函数返回异常，请稍后重试')
  }
  return {
    statusCode: result.statusCode,
    data: result.data as T
  }
}

export const authApi = {
  challenge: () => request<{ challenge_token: string; target: number }>('/auth/captcha/challenge'),
  verifyCaptcha: (challengeToken: string, answer: number) => request<{ captcha_ticket: string }>('/auth/captcha/verify', {
    method: 'POST',
    data: { challenge_token: challengeToken, answer }
  }),
  login: (email: string, password: string, captchaTicket: string) => request<AuthResponse>('/auth/login', {
    method: 'POST',
    data: { email, password, captcha_ticket: captchaTicket }
  }),
  register: (email: string, displayName: string, password: string, inviteCode: string, captchaTicket: string) => request<AuthResponse>('/auth/register', {
    method: 'POST',
    data: { email, display_name: displayName, password, invite_code: inviteCode, captcha_ticket: captchaTicket }
  }),
  wechatLogin: (code: string) => request<AuthResponse>('/auth/wechat/mini/login', {
    method: 'POST',
    data: { code }
  }),
  me: () => request<User>('/auth/me'),
  wechatBinding: () => request<WechatBindingStatus>('/auth/wechat/binding'),
  bindWechat: (code: string) => request<WechatBindingStatus>('/auth/wechat/mini/bind', {
    method: 'POST',
    data: { code }
  }),
  confirmPcScan: (ticket: string, code: string) => request<{ status: 'confirmed'; user: User }>('/auth/wechat/mini/scan-confirm', {
    method: 'POST',
    data: { ticket, code }
  }),
  saveSession: (result: AuthResponse) => {
    Taro.setStorageSync(TOKEN_KEY, result.access_token)
    Taro.setStorageSync('kw_mini_user', result.user)
  },
  logout: () => {
    Taro.removeStorageSync(TOKEN_KEY)
    Taro.removeStorageSync('kw_mini_user')
  },
  hasToken: () => Boolean(Taro.getStorageSync(TOKEN_KEY))
}

export const workspaceApi = {
  list: () => request<Workspace[]>('/workspaces'),
  create: (name: string) => request<Workspace>('/workspaces', { method: 'POST', data: { name } }),
  documents: (workspaceId: string) => request<DocumentItem[]>(`/workspaces/${workspaceId}/documents`),
  shared: () => request<DocumentItem[]>('/documents/shared'),
  recent: () => request<DocumentItem[]>('/documents/recent')
}

export const documentApi = {
  get: (id: string) => request<DocumentItem>(`/documents/${id}`),
  create: (workspaceId: string, type: DocumentType, title: string, parentId: string | null = null, content?: Record<string, any>) => request<DocumentItem>('/documents', {
    method: 'POST',
    data: { workspace_id: workspaceId, parent_id: parentId, type, title, ...(content ? { content } : {}) }
  }),
  update: (id: string, baseVersion: number, title: string, content: Record<string, any>, reason = 'interval') => request<DocumentItem>(`/documents/${id}`, {
    method: 'PATCH',
    data: { base_version: baseVersion, title, content, reason }
  }),
  remove: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  versions: (id: string) => request<DocumentVersion[]>(`/documents/${id}/versions`),
  restoreVersion: (id: string, versionId: string) => request<DocumentItem>(`/documents/${id}/versions/${versionId}/restore`, { method: 'POST' }),
  deleteVersion: (id: string, versionId: string) => request<void>(`/documents/${id}/versions/${versionId}`, { method: 'DELETE' }),
  shares: (id: string) => request<DocumentShare[]>(`/documents/${id}/shares`),
  share: (id: string, email: string, permission: 'viewer' | 'editor') => request<DocumentShare>(`/documents/${id}/shares`, { method: 'POST', data: { email, permission } }),
  updateShare: (id: string, shareId: string, permission: 'viewer' | 'editor') => request<DocumentShare>(`/documents/${id}/shares/${shareId}`, { method: 'PATCH', data: { permission } }),
  deleteShare: (id: string, shareId: string) => request<void>(`/documents/${id}/shares/${shareId}`, { method: 'DELETE' }),
  publish: (id: string) => request<DocumentItem>(`/documents/${id}/publish`, { method: 'POST' }),
  unpublish: (id: string) => request<DocumentItem>(`/documents/${id}/publish`, { method: 'DELETE' }),
  uploadImage: (id: string, filePath: string, name = 'image.jpg') => uploadDocumentImage(id, filePath, name)
}

export const mindMapApi = {
  list: (documentId: string) => request<MindMapItem[]>(`/documents/${documentId}/mind-maps`),
  create: (documentId: string, title: string, graph: Record<string, any>) => request<MindMapItem>(`/documents/${documentId}/mind-maps`, { method: 'POST', data: { title, graph, theme: 'colorful', layout: 'right' } }),
  get: (documentId: string, mapId: string) => request<MindMapItem>(`/documents/${documentId}/mind-maps/${mapId}`),
  update: (documentId: string, mapId: string, item: MindMapItem, reason = 'interval') => request<MindMapItem>(`/documents/${documentId}/mind-maps/${mapId}`, { method: 'PUT', data: { base_version: item.version, title: item.title, graph: item.graph, reason } }),
  remove: (documentId: string, mapId: string) => request<void>(`/documents/${documentId}/mind-maps/${mapId}`, { method: 'DELETE' }),
  versions: (documentId: string, mapId: string) => request<MindMapVersion[]>(`/documents/${documentId}/mind-maps/${mapId}/versions`),
  restoreVersion: (documentId: string, mapId: string, versionId: string) => request<MindMapItem>(`/documents/${documentId}/mind-maps/${mapId}/versions/${versionId}/restore`, { method: 'POST' }),
  deleteVersion: (documentId: string, mapId: string, versionId: string) => request<void>(`/documents/${documentId}/mind-maps/${mapId}/versions/${versionId}`, { method: 'DELETE' })
}

async function uploadDocumentImage(documentId: string, filePath: string, name: string): Promise<UploadedAsset> {
  const token = Taro.getStorageSync<string>(TOKEN_KEY)
  const extension = name.split('.').pop()?.toLowerCase() || 'jpg'
  const mimeTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' }
  const contentType = mimeTypes[extension] || 'image/jpeg'
  if (API_MODE === 'cloud') {
    const base64 = await new Promise<string>((resolve, reject) => {
      Taro.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: result => resolve(String(result.data)), fail: reject })
    })
    const cloudResult = await Taro.cloud.callFunction({ name: CLOUD_FUNCTION, data: { path: `/documents/${documentId}/assets`, method: 'POST', token, binaryBase64: base64, contentType, fileName: name } })
    const result = cloudResult.result as { statusCode?: number; data?: UploadedAsset; error?: { message?: string } } | undefined
    if (!result || result.statusCode !== 201 || !result.data) throw new Error((result?.data as any)?.error?.message || result?.error?.message || '图片上传失败')
    return result.data
  }
  const binary = await new Promise<ArrayBuffer>((resolve, reject) => {
    Taro.getFileSystemManager().readFile({ filePath, success: result => resolve(result.data as ArrayBuffer), fail: reject })
  })
  const response = await Taro.request<UploadedAsset>({ url: `${API_BASE}/documents/${documentId}/assets`, method: 'POST', data: binary, header: { 'content-type': contentType, 'x-file-name': encodeURIComponent(name), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  if (response.statusCode !== 201) throw new Error((response.data as any)?.error?.message || '图片上传失败')
  return response.data
}

export function resolveAssetUrl(path?: string) {
  if (!path) return ''
  if (/^(https?:|cloud:|wxfile:)/.test(path)) return path
  const origin = API_BASE.replace(/\/api\/v1$/, '')
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`
}

export async function downloadAssetFile(path?: string) {
  const url = resolveAssetUrl(path)
  if (!url || /^(cloud:|wxfile:)/.test(url)) return url
  const token = Taro.getStorageSync<string>(TOKEN_KEY)
  const result = await Taro.downloadFile({
    url,
    timeout: 15000,
    header: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (result.statusCode === 401) {
    Taro.removeStorageSync(TOKEN_KEY)
    await Taro.showToast({ title: '登录已过期', icon: 'none' })
    await Taro.reLaunch({ url: '/pages/login/index' })
    throw new Error('登录状态已过期')
  }
  if (result.statusCode < 200 || result.statusCode >= 300) throw new Error('图片加载失败')
  return result.tempFilePath
}

export function textToContent(text: string) {
  return {
    type: 'doc',
    content: text.split(/\n+/).map(line => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : []
    }))
  }
}

export function contentToText(content?: Record<string, any>) {
  const lines: string[] = []
  const walk = (node?: Record<string, any>) => {
    if (!node) return
    if (node.text) lines.push(node.text)
    node.content?.forEach(walk)
  }
  walk(content)
  return lines.join('\n')
}

export const apiConfig = { baseUrl: API_BASE, mode: API_MODE, cloudFunction: CLOUD_FUNCTION }
