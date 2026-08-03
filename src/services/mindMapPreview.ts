import Taro from '@tarojs/taro'
import type { MindMapItem } from '../types/domain'

const WIDTH = 720
const HEIGHT = 360
const PALETTE = ['#e46b61', '#d99535', '#83a64d', '#4ba180', '#557fd1', '#8268cf']
const previewCache = new Map<string, string>()

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

const u32 = (value: number) => new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255])
const joinBytes = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  parts.forEach(part => { output.set(part, offset); offset += part.length })
  return output
}
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const pngChunk = (name: string, data: Uint8Array) => {
  const type = new Uint8Array(Array.from(name).map(char => char.charCodeAt(0)))
  return joinBytes(u32(data.length), type, data, u32(crc32(joinBytes(type, data))))
}
const adler32 = (bytes: Uint8Array) => {
  let a = 1; let b = 0
  for (const value of bytes) { a = (a + value) % 65521; b = (b + a) % 65521 }
  return ((b << 16) | a) >>> 0
}

/** 仅使用无压缩 DEFLATE，换取开发者工具与真机一致且稳定的 PNG 导出。 */
function encodePng(imageData: Uint8ClampedArray, width: number, height: number) {
  const scanline = width * 4 + 1
  const raw = new Uint8Array(scanline * height)
  for (let row = 0; row < height; row += 1) raw.set(imageData.subarray(row * width * 4, (row + 1) * width * 4), row * scanline + 1)
  const blockCount = Math.ceil(raw.length / 65535)
  const deflate = new Uint8Array(2 + raw.length + blockCount * 5 + 4)
  deflate[0] = 0x78; deflate[1] = 0x01
  let input = 0; let output = 2
  while (input < raw.length) {
    const size = Math.min(65535, raw.length - input)
    deflate[output++] = input + size >= raw.length ? 1 : 0
    deflate[output++] = size & 255; deflate[output++] = (size >>> 8) & 255
    const inverted = 0xffff ^ size
    deflate[output++] = inverted & 255; deflate[output++] = (inverted >>> 8) & 255
    deflate.set(raw.subarray(input, input + size), output)
    input += size; output += size
  }
  deflate.set(u32(adler32(raw)), output)
  const header = new Uint8Array(13)
  header.set(u32(width), 0); header.set(u32(height), 4)
  header.set([8, 6, 0, 0, 0], 8)
  return joinBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflate), pngChunk('IEND', new Uint8Array()))
}

const labelOf = (node: any) => String(node?.data?.label || node?.label || '新主题')
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function roundedRect(ctx: any, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function shorten(ctx: any, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let output = text
  while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1)
  return `${output}…`
}

/** 从真实导图节点与连线生成可嵌入小程序原生 Editor 的概览图。 */
export async function renderMindMapPreview(item: MindMapItem, canvasNode?: any): Promise<string> {
  const cacheKey = `${item.id}:${item.version}`
  const cached = previewCache.get(cacheKey)
  if (cached) return cached

  const canvas: any = canvasNode || Taro.createOffscreenCanvas({ type: '2d', width: WIDTH, height: HEIGHT })
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx: any = canvas.getContext('2d')
  if (!ctx) throw new Error('当前微信版本不支持导图概览')

  ctx.fillStyle = '#f8faff'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.fillStyle = '#dfe7f2'
  for (let x = 20; x < WIDTH; x += 28) for (let y = 70; y < HEIGHT - 20; y += 28) ctx.fillRect(x, y, 2, 2)

  const graphNodes = Array.isArray(item.graph?.nodes) ? item.graph.nodes : []
  ctx.fillStyle = '#24344a'
  ctx.font = '700 30px sans-serif'
  ctx.fillText('思维导图', 28, 39)
  ctx.fillStyle = '#8090a6'
  ctx.font = '22px sans-serif'
  ctx.fillText(`${graphNodes.length || 1} 个主题 · 点击“导图”进入编辑`, 172, 38)

  const rawNodes = graphNodes.length ? graphNodes : [{ id: 'root', type: 'root', position: { x: 0, y: 0 }, data: { label: item.title || '中心主题' } }]
  const xs = rawNodes.map((node: any) => Number(node.position?.x) || 0)
  const ys = rawNodes.map((node: any) => Number(node.position?.y) || 0)
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...ys); const maxY = Math.max(...ys)
  // 预览图顶部预留独立标题区，节点绝不与“思维导图”标题重叠。
  const contentX = 38; const contentY = 112; const contentWidth = WIDTH - 76; const contentHeight = HEIGHT - 142
  const scale = Math.min(1, contentWidth / Math.max(300, maxX - minX + 250), contentHeight / Math.max(180, maxY - minY + 90))
  const positions: Record<string, { x: number; y: number; root: boolean; color: string }> = {}

  rawNodes.slice(0, 28).forEach((node: any, index: number) => {
    const root = node.type === 'root' || node.data?.type === 'root' || index === 0
    positions[String(node.id)] = {
      x: contentX + ((Number(node.position?.x) || 0) - minX) * scale,
      y: contentY + ((Number(node.position?.y) || 0) - minY) * scale,
      root,
      color: node.data?.color || PALETTE[index % PALETTE.length]
    }
  })

  ctx.lineWidth = 3
  ;(Array.isArray(item.graph?.edges) ? item.graph.edges : []).slice(0, 40).forEach((edge: any, index: number) => {
    const source = positions[String(edge.source)]
    const target = positions[String(edge.target)]
    if (!source || !target) return
    const sourceWidth = source.root ? 176 : 116
    const sourceY = source.y + (source.root ? 38 : 24)
    const targetY = target.y + (target.root ? 38 : 24)
    const middle = (source.x + sourceWidth + target.x) / 2
    ctx.strokeStyle = target.color || PALETTE[index % PALETTE.length]
    ctx.beginPath()
    ctx.moveTo(source.x + sourceWidth, sourceY)
    ctx.bezierCurveTo(middle, sourceY, middle, targetY, target.x, targetY)
    ctx.stroke()
  })

  rawNodes.slice(0, 28).forEach((node: any) => {
    const position = positions[String(node.id)]
    if (!position) return
    const text = labelOf(node)
    const width = position.root ? 196 : clamp(72 + Array.from(text).length * 18, 132, 228)
    const height = position.root ? 82 : 56
    roundedRect(ctx, position.x, position.y, width, height, position.root ? 18 : 11)
    ctx.fillStyle = position.root ? '#607fd0' : 'rgba(255,255,255,.96)'
    ctx.fill()
    ctx.lineWidth = position.root ? 4 : 2
    ctx.strokeStyle = position.root ? '#344258' : position.color
    ctx.stroke()
    if (!position.root) {
      ctx.fillStyle = position.color
      ctx.fillRect(position.x + 12, position.y + height - 5, width - 24, 4)
    }
    ctx.fillStyle = position.root ? '#fff' : '#26364b'
    ctx.font = position.root ? '700 28px sans-serif' : '600 22px sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText(shorten(ctx, text, width - 24), position.x + 12, position.y + height / 2)
  })

  // 真机需要等待一帧，确保 2D Canvas 已完成提交后再导出。
  await new Promise(resolve => setTimeout(resolve, 32))

  let source = ''
  // 微信 Editor 只接受文件路径；直接读取像素并写入本地 PNG，避免各基础库导出 API 差异。
  if (Taro.env.USER_DATA_PATH && typeof ctx.getImageData === 'function') {
    try {
      const pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT).data as Uint8ClampedArray
      const safeId = String(item.id || 'map').replace(/[^a-z0-9_-]/gi, '').slice(0, 32)
      const filePath = `${Taro.env.USER_DATA_PATH}/kw-mindmap-${safeId}-${item.version || 1}.png`
      const png = encodePng(pixels, WIDTH, HEIGHT)
      Taro.getFileSystemManager().writeFileSync(filePath, png.buffer)
      source = filePath
    } catch {}
  }
  // 部分基础库没有 toDataURL，再回退到微信原生导出接口。
  if (!source && canvasNode) {
    try {
      source = await Promise.race([
        new Promise<string>((resolve, reject) => Taro.canvasToTempFilePath({
          canvas, width: WIDTH, height: HEIGHT, destWidth: WIDTH, destHeight: HEIGHT, fileType: 'png', quality: .86,
          success: result => resolve(result.tempFilePath), fail: reject
        })),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('导图预览导出超时')), 1600))
      ])
    } catch {}
  }
  if (!source) throw new Error('导图概览生成失败')
  previewCache.set(cacheKey, source)
  return source
}
