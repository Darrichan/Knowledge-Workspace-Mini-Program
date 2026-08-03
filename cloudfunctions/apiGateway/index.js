const https = require('https')

const API_BASE = (process.env.KW_API_BASE || 'https://kw.darrichan.top/api/v1').replace(/\/$/, '')
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024

function proxyRequest({ path, method, data, token, binaryBase64, contentType, fileName }) {
  return new Promise((resolve) => {
    const binaryBody = typeof binaryBase64 === 'string' && binaryBase64 ? Buffer.from(binaryBase64, 'base64') : null
    const body = binaryBody || (method === 'GET' || data == null ? null : JSON.stringify(data))
    const request = https.request(`${API_BASE}${path}`, {
      method,
      timeout: 15000,
      headers: {
        accept: 'application/json',
        'content-type': binaryBody ? (contentType || 'application/octet-stream') : 'application/json',
        ...(binaryBody ? { 'x-file-name': encodeURIComponent(String(fileName || 'image.jpg').slice(0, 240)) } : {}),
        'user-agent': 'KW-WeChat-Cloud-Gateway/1.0',
        ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    }, (response) => {
      const chunks = []
      let size = 0

      response.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('API response is too large'))
          return
        }
        chunks.push(chunk)
      })

      response.on('end', () => {
        const responseBuffer = Buffer.concat(chunks)
        const responseType = String(response.headers['content-type'] || '').split(';', 1)[0].toLowerCase()
        if (responseType.startsWith('image/')) {
          resolve({
            statusCode: response.statusCode || 502,
            data: {
              binaryBase64: responseBuffer.toString('base64'),
              contentType: responseType
            }
          })
          return
        }
        const raw = responseBuffer.toString('utf8')
        let payload = null
        if (raw) {
          try {
            payload = JSON.parse(raw)
          } catch {
            payload = { message: '服务返回了无法识别的数据' }
          }
        }
        resolve({
          statusCode: response.statusCode || 502,
          data: payload
        })
      })
    })

    request.on('timeout', () => request.destroy(new Error('API request timed out')))
    request.on('error', () => resolve({
      statusCode: 502,
      data: { error: { message: '云函数暂时无法连接 KW 服务' } }
    }))
    if (body) request.write(body)
    request.end()
  })
}

exports.main = async (event = {}) => {
  const path = typeof event.path === 'string' ? event.path : ''
  const method = String(event.method || 'GET').toUpperCase()
  const token = typeof event.token === 'string' ? event.token : ''

  if (!path.startsWith('/') || path.includes('://') || path.includes('..')) {
    return { statusCode: 400, data: { error: { message: '请求路径无效' } } }
  }
  if (!ALLOWED_METHODS.has(method)) {
    return { statusCode: 405, data: { error: { message: '请求方法不受支持' } } }
  }

  return proxyRequest({ path, method, data: event.data, token, binaryBase64: event.binaryBase64, contentType: event.contentType, fileName: event.fileName })
}
