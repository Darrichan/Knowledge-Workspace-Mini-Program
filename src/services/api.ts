import Taro from '@tarojs/taro'
import type { AuthResponse, DocumentItem, DocumentType, User, WechatBindingStatus, Workspace } from '../types/domain'

const API_BASE = (process.env.TARO_APP_API_BASE || 'http://127.0.0.1:18000/api/v1').replace(/\/$/, '')
const API_MODE = process.env.TARO_APP_API_MODE || 'direct'
const CLOUD_FUNCTION = process.env.TARO_APP_CLOUD_FUNCTION || 'apiGateway'
const TOKEN_KEY = 'kw_mini_token'

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  data?: Record<string, any>
  loading?: boolean
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
  create: (workspaceId: string, type: DocumentType, title: string, parentId: string | null = null) => request<DocumentItem>('/documents', {
    method: 'POST',
    data: { workspace_id: workspaceId, parent_id: parentId, type, title }
  }),
  update: (id: string, baseVersion: number, title: string, content: Record<string, any>, reason = 'interval') => request<DocumentItem>(`/documents/${id}`, {
    method: 'PATCH',
    data: { base_version: baseVersion, title, content, reason }
  })
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
