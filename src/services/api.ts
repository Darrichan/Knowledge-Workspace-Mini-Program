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

// 云函数单次调用的 event 有体积硬上限，超了会抛 "data exceed max size"。
// 这个上限的确切数值不要去猜——猜低了白白降质，猜高了照样报错。做法是：
// 先用一个保守的预闸门挡掉明显过大的图，然后真的去调用；一旦命中体积错误，
// 就压得更小重试。不管真实上限是多少，这个循环都会自己收敛。
const CLOUD_UPLOAD_PREGATE_BASE64 = 320 * 1024
// 逐级降尺寸。注意 compressImage 的 quality 只对 JPG 生效，PNG/截图只能靠缩放减重。
const CLOUD_UPLOAD_WIDTHS = [1440, 1080, 820, 640, 480]

const readBase64 = (filePath: string) => new Promise<string>((resolve, reject) => {
  Taro.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: result => resolve(String(result.data)), fail: reject })
})

const contentTypeOf = (path: string, fallback: string) => {
  const extension = path.split('?')[0].split('.').pop()?.toLowerCase() || ''
  const mimeTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' }
  return mimeTypes[extension] || fallback
}

const isSizeLimitError = (error: any) =>
  /exceed max size|data too large|request too large/i.test(String(error?.errMsg || error?.message || ''))

/** 按尺寸从大到小生成候选上传体，第一个候选是原图。 */
async function cloudImageCandidates(filePath: string, fallbackType: string) {
  const candidates: { base64: string; contentType: string }[] = []
  const original = await readBase64(filePath)
  if (original.length <= CLOUD_UPLOAD_PREGATE_BASE64) {
    candidates.push({ base64: original, contentType: contentTypeOf(filePath, fallbackType) })
  }

  let naturalWidth = 0
  try { naturalWidth = Number((await Taro.getImageInfo({ src: filePath })).width) || 0 } catch {}

  let smallest = original.length
  for (const cap of CLOUD_UPLOAD_WIDTHS) {
    // 只缩不放：原图本来就比这一档窄就跳过，放大既无意义又会变重。
    if (naturalWidth && naturalWidth <= cap) continue
    try {
      const compressed = await Taro.compressImage({ src: filePath, compressedWidth: naturalWidth ? Math.min(naturalWidth, cap) : cap, quality: 60 })
      const base64 = await readBase64(compressed.tempFilePath)
      // 某些格式下缩放反而变大，这种档次直接丢掉。
      if (base64.length >= smallest) continue
      smallest = base64.length
      candidates.push({ base64, contentType: contentTypeOf(compressed.tempFilePath, fallbackType) })
    } catch {
      // 这一档压不动（PNG 常见）就试更小的尺寸，不要提前退出。
    }
  }
  // 一档都没压成功时至少还得有东西可传。
  if (!candidates.length) candidates.push({ base64: original, contentType: contentTypeOf(filePath, fallbackType) })
  return candidates
}

async function uploadDocumentImage(documentId: string, filePath: string, name: string): Promise<UploadedAsset> {
  const token = Taro.getStorageSync<string>(TOKEN_KEY)
  const extension = name.split('.').pop()?.toLowerCase() || 'jpg'
  const mimeTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' }
  const contentType = mimeTypes[extension] || 'image/jpeg'
  if (API_MODE === 'cloud') {
    const candidates = await cloudImageCandidates(filePath, contentType)
    let sizeError: any = null
    for (const candidate of candidates) {
      try {
        const cloudResult = await Taro.cloud.callFunction({ name: CLOUD_FUNCTION, data: { path: `/documents/${documentId}/assets`, method: 'POST', token, binaryBase64: candidate.base64, contentType: candidate.contentType, fileName: name } })
        const result = cloudResult.result as { statusCode?: number; data?: UploadedAsset; error?: { message?: string } } | undefined
        if (!result || result.statusCode !== 201 || !result.data) throw new Error((result?.data as any)?.error?.message || result?.error?.message || '图片上传失败')
        return result.data
      } catch (error) {
        // 只有体积超限才值得压小重试；其它错误（鉴权、服务端拒绝）直接抛出。
        if (!isSizeLimitError(error)) throw error
        sizeError = error
      }
    }
    throw new Error(sizeError ? '图片过大，压缩到最小档仍超出微信云函数单次调用上限，请裁剪后再试' : '图片上传失败')
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

function cloudAssetPath(path: string) {
  if (path.startsWith('/api/v1/')) return path.slice('/api/v1'.length)
  if (path.startsWith('/')) return path
  const marker = '/api/v1/'
  const markerIndex = path.indexOf(marker)
  return markerIndex >= 0 ? path.slice(markerIndex + '/api/v1'.length) : ''
}

function imageExtension(contentType: string) {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif'
  }
  return extensions[contentType.toLowerCase()] || 'img'
}

export async function downloadAssetFile(path?: string) {
  const url = resolveAssetUrl(path)
  if (!url || /^(cloud:|wxfile:)/.test(url)) return url
  const token = Taro.getStorageSync<string>(TOKEN_KEY)
  const proxyPath = cloudAssetPath(url)
  if (API_MODE === 'cloud' && proxyPath) {
    const cloudResult = await Taro.cloud.callFunction({
      name: CLOUD_FUNCTION,
      data: { path: proxyPath, method: 'GET', token: token || null }
    })
    const result = cloudResult.result as {
      statusCode?: number
      data?: { binaryBase64?: string; contentType?: string; error?: { message?: string }; message?: string }
      error?: { message?: string }
    } | undefined
    if (result?.statusCode === 401) {
      Taro.removeStorageSync(TOKEN_KEY)
      await Taro.showToast({ title: '登录已过期', icon: 'none' })
      await Taro.reLaunch({ url: '/pages/login/index' })
      throw new Error('登录状态已过期')
    }
    const base64 = result?.data?.binaryBase64
    if (result?.statusCode !== 200 || !base64) {
      throw new Error(result?.data?.error?.message || result?.data?.message || result?.error?.message || '图片加载失败')
    }
    const extension = imageExtension(result.data?.contentType || '')
    const filePath = `${Taro.env.USER_DATA_PATH}/kw-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
    await new Promise<void>((resolve, reject) => {
      Taro.getFileSystemManager().writeFile({
        filePath,
        data: base64,
        encoding: 'base64',
        success: () => resolve(),
        fail: reject
      })
    })
    return filePath
  }
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
