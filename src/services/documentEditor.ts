import type { DocumentBlock } from './documentBlocks'

export type EditorOp = {
  insert: string | { image?: string; divider?: boolean }
  attributes?: Record<string, any>
}

export type EditorDelta = { ops: EditorOp[] }

export type EditorImageSource = {
  kind?: 'image' | 'mindMap'
  src: string
  thumbnail?: string
  alt?: string
  mapId?: string
  title?: string
  nodeCount?: number
  previewLabels?: string[]
}

export type EditorImageLookup = Record<string, EditorImageSource>

const inlineAttributes = (block: DocumentBlock) => ({
  ...(block.bold ? { bold: true } : {}),
  ...(block.italic ? { italic: true } : {}),
  ...(block.underline ? { underline: true } : {}),
  ...(block.color ? { color: block.color } : {}),
  ...(block.type === 'link' && block.url ? { link: block.url } : {})
})

const lineAttributes = (block: DocumentBlock, checked = false) => {
  if (block.type === 'heading') return { header: Math.min(6, Math.max(1, block.level || 2)) }
  if (block.type === 'bulletList') return { list: 'bullet' }
  if (block.type === 'orderedList') return { list: 'ordered' }
  if (block.type === 'taskList') return { list: 'check', checked }
  if (block.type === 'blockquote') return { blockquote: true }
  if (block.type === 'codeBlock') return { 'code-block': block.language || true }
  return {}
}

export async function blocksToEditorDelta(
  blocks: DocumentBlock[],
  resolveImage: (block: DocumentBlock) => Promise<string>,
  resolveMindMapPreview?: (block: DocumentBlock) => Promise<string>
): Promise<{ delta: EditorDelta; imageLookup: EditorImageLookup }> {
  const ops: EditorOp[] = []
  const imageLookup: EditorImageLookup = {}

  for (const block of blocks) {
    if (block.type === 'image') {
      const localSrc = await resolveImage(block)
      if (localSrc) {
        imageLookup[localSrc] = { src: block.src || block.thumbnail || localSrc, thumbnail: block.thumbnail, alt: block.alt }
        ops.push({ insert: { image: localSrc }, attributes: { alt: block.alt || '图片', 'data-local': localSrc } })
        ops.push({ insert: '\n' })
      }
      continue
    }
    if (block.type === 'horizontalRule') {
      ops.push({ insert: { divider: true } })
      ops.push({ insert: '\n' })
      continue
    }
    if (block.type === 'mindMapBlock') {
      const localSrc = resolveMindMapPreview ? await resolveMindMapPreview(block) : ''
      if (localSrc) {
        imageLookup[localSrc] = {
          kind: 'mindMap', src: localSrc, alt: `思维导图：${block.title || '未命名思维导图'}`,
          mapId: block.mapId, title: block.title, nodeCount: block.nodeCount, previewLabels: block.previewLabels
        }
        ops.push({ insert: { image: localSrc }, attributes: { alt: `思维导图：${block.title || '未命名思维导图'}`, 'data-local': localSrc } })
      } else {
        ops.push({ insert: `思维导图 · ${block.title || '未命名思维导图'}`, attributes: { bold: true, color: '#5377ba', link: `kw-mindmap://${block.mapId || ''}` } })
      }
      ops.push({ insert: '\n' })
      continue
    }

    const lines = (block.text || '').split('\n')
    lines.forEach((line, index) => {
      if (line) ops.push({ insert: line, attributes: inlineAttributes(block) })
      ops.push({ insert: '\n', attributes: lineAttributes(block, Boolean(block.checkedLines?.[index])) })
    })
  }

  if (!ops.length) ops.push({ insert: '\n' })
  return { delta: { ops }, imageLookup }
}

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function blockFromLine(text: string, inline: Record<string, any>, line: Record<string, any>): DocumentBlock {
  const base: DocumentBlock = {
    id: makeId(),
    type: 'paragraph',
    text,
    ...(inline.bold ? { bold: true } : {}),
    ...(inline.italic ? { italic: true } : {}),
    ...(inline.underline ? { underline: true } : {}),
    ...(inline.color ? { color: inline.color } : {})
  }
  if (typeof inline.link === 'string' && inline.link.startsWith('kw-mindmap://')) {
    return { id: base.id, type: 'mindMapBlock', mapId: inline.link.slice('kw-mindmap://'.length), title: text.replace(/^↗\s*思维导图\s*·\s*/, '') || '未命名思维导图', nodeCount: 1 }
  }
  if (line.header) return { ...base, type: 'heading', level: Number(String(line.header).replace(/\D/g, '')) || 2 }
  if (line.list === 'bullet') return { ...base, type: 'bulletList' }
  if (line.list === 'ordered') return { ...base, type: 'orderedList' }
  if (line.list === 'check') return { ...base, type: 'taskList', checkedLines: [Boolean(line.checked)] }
  if (line.blockquote) return { ...base, type: 'blockquote' }
  if (line['code-block']) return { ...base, type: 'codeBlock', language: typeof line['code-block'] === 'string' ? line['code-block'] : 'plaintext' }
  if (inline.link) return { ...base, type: 'link', url: inline.link }
  return base
}

export function editorDeltaToBlocks(delta: EditorDelta | undefined, imageLookup: EditorImageLookup): DocumentBlock[] {
  const blocks: DocumentBlock[] = []
  let lineText = ''
  let firstInline: Record<string, any> = {}

  const flushLine = (lineAttributes: Record<string, any> = {}) => {
    blocks.push(blockFromLine(lineText, firstInline, lineAttributes))
    lineText = ''
    firstInline = {}
  }

  for (const op of delta?.ops || []) {
    if (typeof op.insert === 'object') {
      if (op.insert.image) {
        if (lineText) flushLine()
        const local = op.insert.image
        const source = imageLookup[local] || imageLookup[String(op.attributes?.['data-local'] || '')]
        if (source?.kind === 'mindMap') {
          blocks.push({
            id: makeId(), type: 'mindMapBlock', mapId: source.mapId || '', title: source.title || '未命名思维导图',
            nodeCount: source.nodeCount || 1, previewLabels: source.previewLabels || []
          })
          continue
        }
        blocks.push({
          id: makeId(),
          type: 'image',
          src: source?.src || local,
          thumbnail: source?.thumbnail || source?.src || local,
          alt: source?.alt || op.attributes?.alt || '图片'
        })
      } else if (op.insert.divider) {
        if (lineText) flushLine()
        blocks.push({ id: makeId(), type: 'horizontalRule' })
      }
      continue
    }

    const pieces = String(op.insert).split('\n')
    pieces.forEach((piece, index) => {
      if (piece) {
        if (!lineText) firstInline = { ...(op.attributes || {}) }
        lineText += piece
      }
      if (index < pieces.length - 1) flushLine(op.attributes || {})
    })
  }
  if (lineText) flushLine()

  while (blocks.length > 1 && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].text) blocks.pop()
  return blocks.length ? blocks : [{ id: makeId(), type: 'paragraph', text: '' }]
}
