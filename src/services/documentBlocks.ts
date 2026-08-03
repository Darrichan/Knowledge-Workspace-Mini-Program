export type BlockType = 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock' | 'horizontalRule' | 'image' | 'mindMapBlock' | 'link'

export type DocumentBlock = {
  id: string
  type: BlockType
  text?: string
  level?: number
  language?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  url?: string
  src?: string
  thumbnail?: string
  alt?: string
  mapId?: string
  title?: string
  nodeCount?: number
  previewLabels?: string[]
  checkedLines?: boolean[]
}

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function createBlock(type: BlockType = 'paragraph'): DocumentBlock {
  if (type === 'heading') return { id: makeId(), type, text: '', level: 2 }
  if (type === 'codeBlock') return { id: makeId(), type, text: '', language: 'plaintext' }
  if (type === 'taskList') return { id: makeId(), type, text: '待办事项', checkedLines: [false] }
  if (type === 'horizontalRule') return { id: makeId(), type }
  return { id: makeId(), type, text: '' }
}

function textOf(node: any): string {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  return Array.isArray(node.content) ? node.content.map(textOf).join('') : ''
}

const stringValue = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback

function styleOf(node: any) {
  const leaf = Array.isArray(node?.content) ? node.content.find((item: any) => item?.type === 'text') : null
  const marks = leaf?.marks || []
  const color = marks.find((mark: any) => mark?.type === 'textStyle')?.attrs?.color
  const href = marks.find((mark: any) => mark?.type === 'link')?.attrs?.href
  return {
    bold: marks.some((mark: any) => mark.type === 'bold'),
    italic: marks.some((mark: any) => mark.type === 'italic'),
    underline: marks.some((mark: any) => mark.type === 'underline'),
    color: stringValue(color) || undefined,
    url: stringValue(href) || undefined
  }
}

function listLines(node: any) {
  return (node.content || []).map((item: any) => textOf(item)).join('\n')
}

export function contentToBlocks(content?: Record<string, any>): DocumentBlock[] {
  if (!Array.isArray(content?.content)) return [createBlock()]
  const blocks = content.content.map((node: any): DocumentBlock | null => {
    const base = { id: makeId(), ...styleOf(node) }
    if (node.type === 'paragraph') {
      const style = styleOf(node)
      const text = textOf(node)
      const markdownHeading = text.match(/^(#{1,6})\s+(.+)$/)
      if (markdownHeading) return { ...base, type: 'heading', text: markdownHeading[2], level: markdownHeading[1].length }
      const bullet = text.match(/^[-*+]\s+(.+)$/)
      if (bullet) return { ...base, type: 'bulletList', text: bullet[1] }
      const ordered = text.match(/^\d+[.)]\s+(.+)$/)
      if (ordered) return { ...base, type: 'orderedList', text: ordered[1] }
      if (typeof style.url === 'string' && style.url.startsWith('kw-mindmap://')) {
        return {
          ...base,
          type: 'mindMapBlock',
          mapId: style.url.slice('kw-mindmap://'.length),
          title: text.replace(/^↗?\s*思维导图\s*·\s*/, '') || '未命名思维导图',
          nodeCount: 1
        }
      }
      return { ...base, type: style.url ? 'link' : 'paragraph', text, url: style.url }
    }
    if (node.type === 'heading') return { ...base, type: 'heading', text: textOf(node), level: Number(node.attrs?.level || 2) }
    if (node.type === 'blockquote') return { ...base, type: 'blockquote', text: textOf(node) }
    if (node.type === 'codeBlock') return { ...base, type: 'codeBlock', text: textOf(node), language: stringValue(node.attrs?.language, 'plaintext') }
    if (node.type === 'horizontalRule') return { ...base, type: 'horizontalRule' }
    if (node.type === 'bulletList' || node.type === 'orderedList') return { ...base, type: node.type, text: listLines(node) }
    if (node.type === 'taskList') return { ...base, type: 'taskList', text: listLines(node), checkedLines: (node.content || []).map((item: any) => Boolean(item.attrs?.checked)) }
    if (node.type === 'image') {
      const originalSrc = stringValue(node.attrs?.['data-original-src'])
      const thumbnail = stringValue(node.attrs?.src)
      return { ...base, type: 'image', src: originalSrc || thumbnail, thumbnail, alt: stringValue(node.attrs?.alt, '图片') }
    }
    if (node.type === 'mindMapBlock') return {
      ...base,
      type: 'mindMapBlock',
      mapId: String(node.attrs?.mapId || ''),
      title: stringValue(node.attrs?.title, '未命名思维导图'),
      nodeCount: Number(node.attrs?.nodeCount || 1),
      previewLabels: Array.isArray(node.attrs?.previewLabels) ? node.attrs.previewLabels.map((item: unknown) => String(item)) : []
    }
    if (node.type === 'listItem' || node.type === 'taskItem') return { ...base, type: node.type === 'taskItem' ? 'taskList' : 'bulletList', text: textOf(node), checkedLines: node.type === 'taskItem' ? [Boolean(node.attrs?.checked)] : undefined }
    return { ...base, type: 'paragraph', text: textOf(node) }
  }).filter(Boolean) as DocumentBlock[]
  const compact = blocks.reduce<DocumentBlock[]>((result, block) => {
    const text = (block.text || '').trim()
    const isLegacyEmptyMarker = (block.type === 'paragraph' || block.type === 'bulletList') && /^[-*+]?\s*$/.test(text)
    const previous = result[result.length - 1]
    const previousEmpty = previous && (previous.type === 'paragraph' || previous.type === 'bulletList') && !(previous.text || '').trim()
    if (isLegacyEmptyMarker) {
      if (!previousEmpty) result.push({ ...createBlock(), id: block.id })
      return result
    }
    result.push(block)
    return result
  }, [])
  return compact.length ? compact : [createBlock()]
}

function textContent(block: DocumentBlock, text = block.text || '', link = false) {
  if (!text) return []
  const marks: any[] = []
  if (block.bold) marks.push({ type: 'bold' })
  if (block.italic) marks.push({ type: 'italic' })
  if (block.underline) marks.push({ type: 'underline' })
  if (block.color) marks.push({ type: 'textStyle', attrs: { color: block.color } })
  if (link && block.url) marks.push({ type: 'link', attrs: { href: block.url, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } })
  return [{ type: 'text', text, ...(marks.length ? { marks } : {}) }]
}

function listNode(block: DocumentBlock, ordered = false) {
  const lines = (block.text || '').split('\n').filter((line, index, items) => line || index < items.length - 1)
  return {
    type: ordered ? 'orderedList' : 'bulletList',
    ...(ordered ? { attrs: { start: 1, type: null } } : {}),
    content: (lines.length ? lines : ['']).map(line => ({ type: 'listItem', content: [{ type: 'paragraph', content: textContent(block, line) }] }))
  }
}

export function blocksToContent(blocks: DocumentBlock[]) {
  return {
    type: 'doc',
    content: blocks.map(block => {
      if (block.type === 'heading') return { type: 'heading', attrs: { textAlign: null, level: block.level || 2 }, content: textContent(block) }
      if (block.type === 'blockquote') return { type: 'blockquote', content: [{ type: 'paragraph', content: textContent(block) }] }
      if (block.type === 'codeBlock') return { type: 'codeBlock', attrs: { language: block.language || 'plaintext' }, content: textContent({ ...block, bold: false, italic: false, underline: false, color: undefined }) }
      if (block.type === 'horizontalRule') return { type: 'horizontalRule' }
      if (block.type === 'bulletList') return listNode(block)
      if (block.type === 'orderedList') return listNode(block, true)
      if (block.type === 'taskList') {
        const lines = (block.text || '').split('\n')
        return { type: 'taskList', content: lines.map((line, index) => ({ type: 'taskItem', attrs: { checked: Boolean(block.checkedLines?.[index]) }, content: [{ type: 'paragraph', content: textContent(block, line) }] })) }
      }
      if (block.type === 'image') return { type: 'image', attrs: { src: block.thumbnail || block.src, alt: block.alt || '图片', title: null, width: null, height: null, 'data-original-src': block.src || block.thumbnail } }
      if (block.type === 'mindMapBlock') return { type: 'mindMapBlock', attrs: { mapId: block.mapId, title: block.title, nodeCount: block.nodeCount || 1, previewLabels: block.previewLabels || [] } }
      return { type: 'paragraph', attrs: { textAlign: null }, content: textContent(block, block.text || '', block.type === 'link') }
    })
  }
}

export function plainTextFromBlocks(blocks: DocumentBlock[]) {
  return blocks.map(block => block.text || block.title || block.alt || '').filter(Boolean).join('\n')
}
