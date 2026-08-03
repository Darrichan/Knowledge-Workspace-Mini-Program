import { Canvas, Editor, Image, Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useLoad, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import DocumentPanels from '../../components/DocumentPanels'
import { documentApi, downloadAssetFile, mindMapApi } from '../../services/api'
import { blocksToContent, contentToBlocks } from '../../services/documentBlocks'
import type { BlockType, DocumentBlock } from '../../services/documentBlocks'
import { blocksToEditorDelta, editorDeltaToBlocks } from '../../services/documentEditor'
import type { EditorDelta, EditorImageLookup } from '../../services/documentEditor'
import { renderMindMapPreview } from '../../services/mindMapPreview'
import type { DocumentItem } from '../../types/domain'
import './index.scss'

const INSERT_TYPES: { label: string; type: BlockType }[] = [
  { label: '正文', type: 'paragraph' }, { label: '一级标题', type: 'heading' }, { label: '无序列表', type: 'bulletList' },
  { label: '有序列表', type: 'orderedList' }, { label: '待办', type: 'taskList' }, { label: '引用', type: 'blockquote' },
  { label: '代码块', type: 'codeBlock' }, { label: '外链', type: 'link' }, { label: '分割线', type: 'horizontalRule' }
]
const COLORS = ['#1d2b3e', '#61728a', '#c84f58', '#d87932', '#b89116', '#358863', '#2f83aa', '#5579c2', '#7657b8', '#a94d7f']
const COLOR_GROUPS = [
  ['#1d2b3e', '#4a586b', '#7c899b', '#b4bdc9', '#ffffff'],
  ['#b4232f', '#e05260', '#ed8690', '#c85b2a', '#ed8b4a'],
  ['#8e6d08', '#d3a20d', '#e8c34b', '#23764e', '#45a779'],
  ['#176b91', '#2f83aa', '#69b7d5', '#345ca8', '#5579c2'],
  ['#6142a0', '#7657b8', '#9a82d0', '#943e6c', '#c86498']
]

type DocumentFlowItem =
  | { kind: 'editor'; key: string; start: number; count: number; blocks: DocumentBlock[] }
  | { kind: 'task'; key: string; index: number; block: DocumentBlock }
  | { kind: 'mindmap'; key: string; index: number; block: DocumentBlock }

const documentFlow = (blocks: DocumentBlock[]): DocumentFlowItem[] => {
  const output: DocumentFlowItem[] = []
  let segmentStart = 0
  let segmentBlocks: DocumentBlock[] = []
  let segmentIndex = 0
  const flush = () => {
    if (!segmentBlocks.length) return
    output.push({ kind: 'editor', key: `editor-${segmentIndex++}`, start: segmentStart, count: segmentBlocks.length, blocks: segmentBlocks })
    segmentBlocks = []
  }
  blocks.forEach((block, index) => {
    if (block.type === 'taskList' || block.type === 'mindMapBlock') {
      flush()
      output.push({ kind: block.type === 'taskList' ? 'task' : 'mindmap', key: `${block.type}-${block.id}`, index, block } as DocumentFlowItem)
      segmentStart = index + 1
    } else {
      if (!segmentBlocks.length) segmentStart = index
      segmentBlocks.push(block)
    }
  })
  flush()
  if (!output.some(item => item.kind === 'editor')) output.push({ kind: 'editor', key: `editor-${segmentIndex}`, start: blocks.length, count: 0, blocks: [] })
  return output
}

export default function DocumentPage() {
  const id = useRouter().params.id || ''
  const [document, setDocument] = useState<DocumentItem | null>(null)
  const [title, setTitle] = useState('')
  const [blocks, setBlocks] = useState<DocumentBlock[]>([])
  const [status, setStatus] = useState('正在加载')
  const [insertOpen, setInsertOpen] = useState(false)
  const [panel, setPanel] = useState<'history' | 'share' | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [, setEditorActive] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const [formats, setFormats] = useState<Record<string, any>>({})
  const [uploading, setUploading] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [customColor, setCustomColor] = useState('#5579c2')
  const [recentColors, setRecentColors] = useState<string[]>([])
  const [mapPreviews, setMapPreviews] = useState<Record<string, string>>({})
  const hydrated = useRef(false)
  const versionRef = useRef(1)
  const documentRef = useRef<DocumentItem | null>(null)
  const titleRef = useRef('')
  const blocksRef = useRef<DocumentBlock[]>([])
  const editorRef = useRef<Taro.EditorContext | null>(null)
  const editorRefs = useRef<Record<string, Taro.EditorContext>>({})
  const activeInsertionIndexRef = useRef(0)
  const imageLookupRef = useRef<EditorImageLookup>({})
  const settingEditorRef = useRef(false)
  const savingRef = useRef(false)
  const queuedRef = useRef(false)
  const previewCanvasRef = useRef<any>(null)
  const pixelRatioRef = useRef(Math.max(1, Taro.getWindowInfo().pixelRatio || 1))

  const getPreviewCanvas = async () => {
    if (previewCanvasRef.current) return previewCanvasRef.current
    return new Promise<any>((resolve, reject) => {
      Taro.createSelectorQuery().select('#kw-mindmap-preview-canvas').fields({ node: true, size: true }, result => {
        if (result?.node) { previewCanvasRef.current = result.node; resolve(result.node) } else reject(new Error('导图预览画布未就绪'))
      }).exec()
    })
  }

  const loadBlocksIntoEditor = async (context: Taro.EditorContext, nextBlocks: DocumentBlock[]) => {
    settingEditorRef.current = true
    try {
      const prepared = await blocksToEditorDelta(nextBlocks, async block => {
        try { return await downloadAssetFile(block.thumbnail || block.src) } catch { return block.thumbnail || block.src || '' }
      })
      imageLookupRef.current = { ...imageLookupRef.current, ...prepared.imageLookup }
      context.setContents({
        delta: prepared.delta,
        complete: () => setTimeout(() => { settingEditorRef.current = false }, 80)
      })
    } catch {
      settingEditorRef.current = false
      Taro.showToast({ title: '文档内容加载失败', icon: 'none' })
    }
  }

  const hydrate = (result: DocumentItem) => {
    setDocument(result); documentRef.current = result
    setTitle(result.title); titleRef.current = result.title
    const nextBlocks = contentToBlocks(result.content)
    setBlocks(nextBlocks); blocksRef.current = nextBlocks
    versionRef.current = result.version
    setStatus(`版本 ${result.version}`)
  }

  useLoad(async () => {
    if (!id) return Taro.showToast({ title: '缺少内容 ID', icon: 'none' })
    try {
      const result = await documentApi.get(id)
      hydrate(result)
      setTimeout(() => { hydrated.current = true }, 0)
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  })

  const saveNow = async (reason = 'interval') => {
    if (!documentRef.current || savingRef.current) { queuedRef.current = true; return }
    savingRef.current = true
    queuedRef.current = false
    const snapshotTitle = titleRef.current
    const snapshotBlocks = blocksRef.current
    try {
      setStatus('保存中…')
      const updated = await documentApi.update(documentRef.current.id, versionRef.current, snapshotTitle.trim() || '无标题文档', blocksToContent(snapshotBlocks), reason)
      versionRef.current = updated.version
      documentRef.current = updated
      setDocument(updated)
      setStatus(`已自动保存 · 版本 ${updated.version}`)
    } catch (error) {
      setStatus('保存失败')
      Taro.showToast({ title: (error as Error).message, icon: 'none' })
    } finally {
      savingRef.current = false
      if (queuedRef.current || snapshotTitle !== titleRef.current || snapshotBlocks !== blocksRef.current) setTimeout(() => saveNow(), 0)
    }
  }

  useEffect(() => {
    titleRef.current = title; blocksRef.current = blocks
    if (!hydrated.current) return
    setStatus('有未保存更改')
    const timer = setTimeout(() => saveNow(), 1200)
    return () => clearTimeout(timer)
  }, [title, blocks])

  useEffect(() => {
    const listener = ({ height }: { height: number }) => setKeyboardHeight(Math.max(0, height || 0))
    Taro.onKeyboardHeightChange(listener)
    return () => Taro.offKeyboardHeightChange(listener)
  }, [])

  const mapSignature = blocks.filter(block => block.type === 'mindMapBlock').map(block => block.mapId || block.id).join('|')
  useEffect(() => {
    if (!documentRef.current || !mapSignature) return
    let cancelled = false
    const load = async () => {
      for (const block of blocksRef.current.filter(item => item.type === 'mindMapBlock' && item.mapId)) {
        const key = block.mapId || block.id
        if (mapPreviews[key]) continue
        try {
          const item = await mindMapApi.get(documentRef.current!.id, block.mapId!)
          const source = await renderMindMapPreview(item, await getPreviewCanvas())
          if (!cancelled) setMapPreviews(current => ({ ...current, [key]: source }))
        } catch (error) { console.error('KW_MINDMAP_PREVIEW', error) }
      }
    }
    const timer = setTimeout(() => void load(), 30)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [document?.id, mapSignature])

  const editorReady = (key: string, segmentBlocks: DocumentBlock[]) => {
    Taro.createSelectorQuery().select(`#kw-document-${key}`).context(result => {
      const context = result.context as Taro.EditorContext
      editorRefs.current[key] = context
      if (!editorRef.current) editorRef.current = context
      void loadBlocksIntoEditor(context, segmentBlocks)
    }).exec()
  }

  const onEditorInput = (start: number, count: number, event: any) => {
    if (settingEditorRef.current) return
    const segment = editorDeltaToBlocks(event.detail.delta as EditorDelta, imageLookupRef.current)
    const next = [...blocksRef.current]
    next.splice(start, count, ...segment)
    blocksRef.current = next
    setBlocks(next)
  }

  const applyFormat = (name: string, value?: string) => {
    if (!editorRef.current) return
    editorRef.current.format(name, value)
    setEditorActive(true)
  }

  const applyTextColor = (color: string) => {
    const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#5579c2'
    applyFormat('color', normalized)
    setCustomColor(normalized)
    setRecentColors(current => [normalized, ...current.filter(item => item !== normalized)].slice(0, 5))
    setColorOpen(false)
  }

  const setLineType = (type: BlockType, level = 2) => {
    if (type === 'taskList') {
      const next = [...blocksRef.current]
      const index = Math.min(next.length, Math.max(0, activeInsertionIndexRef.current))
      next.splice(index, 0, { id: `${Date.now()}-task`, type: 'taskList', text: '待办事项', checkedLines: [false] })
      blocksRef.current = next
      setBlocks(next)
      setInsertOpen(false)
      return
    }
    if (!editorRef.current) return
    if (type === 'paragraph') {
      editorRef.current.format('header', '')
      editorRef.current.format('list', '')
      editorRef.current.format('blockquote', '')
    } else if (type === 'heading') editorRef.current.format('header', `H${level}`)
    else if (type === 'bulletList') {
      editorRef.current.format('list', '')
      setTimeout(() => editorRef.current?.format('list', 'bullet'), 0)
    } else if (type === 'orderedList') {
      editorRef.current.format('list', '')
      setTimeout(() => editorRef.current?.format('list', 'ordered'), 0)
    } else if (type === 'blockquote') editorRef.current.format('blockquote', 'true')
    else if (type === 'codeBlock') {
      editorRef.current.format('fontFamily', 'monospace')
      editorRef.current.format('backgroundColor', '#eef2f7')
    }
    setInsertOpen(false)
    setEditorActive(true)
  }

  const insertLink = async () => {
    try {
      const answer = await Taro.showModal({ title: '插入链接', content: '请输入完整的 https 地址', editable: true, placeholderText: 'https://example.com' } as any) as any
      if (answer.confirm && answer.content) applyFormat('link', answer.content.trim())
    } catch {}
    setInsertOpen(false)
  }

  const insertContent = (type: BlockType) => {
    if (type === 'taskList') return setLineType(type)
    if (!editorRef.current) return
    if (type === 'horizontalRule') editorRef.current.insertDivider()
    else if (type === 'link') void insertLink()
    else setLineType(type, type === 'heading' ? 1 : 2)
    setInsertOpen(false)
  }

  const chooseImage = async () => {
    if (uploading) return
    try {
      const result = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] })
      const media = result.tempFiles[0]
      if (!media || !documentRef.current || !editorRef.current) return
      setUploading(true)
      Taro.showLoading({ title: '上传图片', mask: true })
      let localPath = media.tempFilePath
      try { localPath = (await Taro.compressImage({ src: localPath, quality: 68 })).tempFilePath } catch {}
      const asset = await documentApi.uploadImage(documentRef.current.id, localPath, localPath.split('/').pop() || 'image.jpg')
      imageLookupRef.current[localPath] = { src: asset.url, thumbnail: asset.thumbnail_url, alt: asset.name }
      editorRef.current.insertImage({
        src: localPath,
        width: '100%',
        alt: asset.name,
        data: { originalSrc: asset.url, thumbnail: asset.thumbnail_url, localSrc: localPath }
      })
      setEditorActive(true)
    } catch (error) {
      const message = (error as any)?.errMsg || (error as Error).message || ''
      if (!message.includes('cancel')) Taro.showToast({ title: message || '图片上传失败', icon: 'none' })
    } finally {
      setUploading(false)
      Taro.hideLoading()
      setInsertOpen(false)
    }
  }

  const insertMindMap = async () => {
    if (!documentRef.current) return
    try {
      Taro.showLoading({ title: '创建导图', mask: true })
      const rootId = `root-${Date.now()}`
      const map = await mindMapApi.create(documentRef.current.id, '未命名思维导图', { nodes: [{ id: rootId, type: 'root', position: { x: 80, y: 180 }, data: { label: '中心主题' } }], edges: [], layoutStyle: 'right' })
      const next: DocumentBlock[] = [...blocksRef.current]
      const index = Math.min(next.length, Math.max(0, activeInsertionIndexRef.current))
      next.splice(index, 0, { id: `${Date.now()}-map`, type: 'mindMapBlock', mapId: map.id, title: map.title, nodeCount: 1, previewLabels: ['中心主题'] })
      blocksRef.current = next
      setBlocks(next)
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { Taro.hideLoading(); setInsertOpen(false) }
  }

  const openMindMap = async () => {
    const maps = blocksRef.current.filter(block => block.type === 'mindMapBlock' && block.mapId)
    if (!maps.length) return Taro.showToast({ title: '当前文档还没有思维导图', icon: 'none' })
    let selected = maps[0]
    if (maps.length > 1) {
      try {
        const result = await Taro.showActionSheet({ itemList: maps.map(block => block.title || '未命名思维导图') })
        selected = maps[result.tapIndex] || selected
      } catch { return }
    }
    Taro.navigateTo({ url: `/pages/mindmap/index?id=${documentRef.current?.id || ''}&mapId=${selected.mapId}` })
  }

  const openMindMapBlock = (block: DocumentBlock) => {
    if (!block.mapId || !documentRef.current) return
    editorRef.current?.blur()
    Taro.hideKeyboard()
    Taro.navigateTo({ url: `/pages/mindmap/index?id=${documentRef.current.id}&mapId=${block.mapId}` })
  }

  const updateTaskLine = (blockIndex: number, lineIndex: number, value: string) => {
    const next = [...blocksRef.current]
    const current = next[blockIndex]
    if (!current || current.type !== 'taskList') return
    const lines = (current.text || '').split('\n')
    lines[lineIndex] = value
    next[blockIndex] = { ...current, text: lines.join('\n') }
    blocksRef.current = next
    setBlocks(next)
  }

  const toggleTaskLine = (blockIndex: number, lineIndex: number) => {
    const next = [...blocksRef.current]
    const current = next[blockIndex]
    if (!current || current.type !== 'taskList') return
    const checkedLines = [...(current.checkedLines || [])]
    checkedLines[lineIndex] = !checkedLines[lineIndex]
    next[blockIndex] = { ...current, checkedLines }
    blocksRef.current = next
    setBlocks(next)
    Taro.vibrateShort({ type: 'light' }).catch(() => {})
  }

  const openDocumentMenu = () => Taro.showActionSheet({ itemList: ['编辑历史', '分享与发布', '删除文档'] }).then(async result => {
    if (result.tapIndex === 0) setPanel('history')
    if (result.tapIndex === 1) setPanel('share')
    if (result.tapIndex === 2 && document) {
      const answer = await Taro.showModal({ title: '移到回收站', content: '确定删除当前文档吗？' })
      if (answer.confirm) { await documentApi.remove(document.id); Taro.navigateBack() }
    }
  }).catch(() => {})

  if (!document) return <View className='loading-screen'><View className='loading-ring' /><Text>正在打开内容</Text></View>

  const dockVisible = true
  const keyboardOffset = keyboardHeight > 0 ? Math.round(keyboardHeight / pixelRatioRef.current) : 0
  const flowItems = documentFlow(blocks)
  return <View className='document-page'>
    <Canvas id='kw-mindmap-preview-canvas' type='2d' className='mindmap-preview-canvas' />
    <View className='document-top'>
      <View className='document-top__type'>文</View>
      <Text className='document-top__status'>{status}</Text>
      <View className='document-top__action' onClick={() => saveNow('manual')}>保存</View>
      <View className='document-top__menu' onClick={openDocumentMenu}>•••</View>
    </View>

    <ScrollView className='document-scroll' scrollY enhanced showScrollbar={false}>
      <View className='document-paper'>
        <View className='document-title-wrap'>
          <Textarea className='document-title' autoHeight value={title} placeholder='无标题文档' maxlength={300} showConfirmBar={false} onFocus={() => setEditorActive(false)} onInput={event => setTitle(event.detail.value)} />
        </View>
        <View className='document-flow'>
          {flowItems.map((item, flowIndex) => {
            if (item.kind === 'editor') return <Editor
              key={item.key}
              id={`kw-document-${item.key}`}
              className={`document-editor document-editor--segment ${flowIndex === flowItems.length - 1 ? 'document-editor--last' : ''}`}
              placeholder={flowIndex === flowItems.length - 1 ? '输入正文…' : ''}
              showImgSize
              showImgToolbar
              showImgResize
              onReady={() => editorReady(item.key, item.blocks)}
              onFocus={() => {
                editorRef.current = editorRefs.current[item.key] || editorRef.current
                activeInsertionIndexRef.current = item.start + item.count
                setEditorActive(true)
              }}
              onInput={(event: any) => onEditorInput(item.start, item.count, event)}
              onStatusChange={(event: any) => setFormats(event.detail || {})}
            />
            if (item.kind === 'task') {
              const lines = (item.block.text || '待办事项').split('\n')
              return <View key={item.key} className='task-block'>
                {lines.map((line, lineIndex) => {
                  const checked = Boolean(item.block.checkedLines?.[lineIndex])
                  return <View key={`${item.key}-${lineIndex}`} className={`task-row ${checked ? 'checked' : ''}`}>
                    <View className='task-check-hit' onClick={() => toggleTaskLine(item.index, lineIndex)}>
                      <View className='task-check'>{checked ? '✓' : ''}</View>
                    </View>
                    <Textarea
                      className='task-text'
                      autoHeight
                      value={line}
                      maxlength={2000}
                      showConfirmBar={false}
                      onFocus={() => { activeInsertionIndexRef.current = item.index + 1; setEditorActive(true) }}
                      onInput={event => updateTaskLine(item.index, lineIndex, event.detail.value)}
                    />
                  </View>
                })}
              </View>
            }
            const preview = mapPreviews[item.block.mapId || item.block.id]
            return <View key={item.key} className='mindmap-interactive' hoverClass='mindmap-interactive--pressed' onClick={() => openMindMapBlock(item.block)}>
              {preview
                ? <Image className='mindmap-interactive__image' src={preview} mode='widthFix' />
                : <View className='mindmap-interactive__fallback'><View className='mindmap-interactive__root'>{item.block.previewLabels?.[0] || '中心主题'}</View></View>}
              <View className='mindmap-interactive__bar'>
                <View><Text className='mindmap-interactive__title'>{item.block.title || '未命名思维导图'}</Text><Text className='mindmap-interactive__meta'>{item.block.nodeCount || 1} 个主题</Text></View>
                <View className='mindmap-interactive__open'>进入编辑 <Text>→</Text></View>
              </View>
            </View>
          })}
        </View>
      </View>
      <View className={`document-bottom-space ${dockVisible ? 'dock-visible' : ''}`} />
    </ScrollView>

    {!dockVisible && !insertOpen && <View className='floating-insert' onClick={() => { setInsertOpen(true); setEditorActive(true) }}><View className='floating-insert__plus'>+</View><Text>插入内容</Text></View>}

    {dockVisible && !insertOpen && <View className={`editor-dock ${keyboardHeight ? 'keyboard-open' : ''}`} style={{ bottom: `${keyboardOffset}px` }}>
      {formatOpen && <ScrollView className='format-strip' scrollX showScrollbar={false}>
        <View className='format-strip__inner'>
          <View onClick={() => setLineType('paragraph')}>正文</View>
          <View onClick={() => setLineType('heading', 1)}>H1</View>
          <View onClick={() => setLineType('heading', 2)}>H2</View>
          <View onClick={() => setLineType('heading', 3)}>H3</View>
          <View className={formats.list === 'check' ? 'on' : ''} onClick={() => setLineType('taskList')}>待办</View>
          <View onClick={() => setLineType('orderedList')}>编号</View>
          <View className={formats.list === 'bullet' ? 'on' : ''} onClick={() => setLineType('bulletList')}>列表</View>
          <View onClick={() => setLineType('blockquote')}>引用</View>
          <View className={formats.italic ? 'on italic' : 'italic'} onClick={() => applyFormat('italic')}>I</View>
          <View className={formats.underline ? 'on underline' : 'underline'} onClick={() => applyFormat('underline')}>U</View>
          <View className={colorOpen ? 'color-tool on' : 'color-tool'} onClick={() => setColorOpen(!colorOpen)}><Text style={{ background: formats.color || COLORS[0] }} /></View>
          <View onClick={() => editorRef.current?.undo()}>撤销</View>
          <View onClick={() => editorRef.current?.redo()}>重做</View>
          {keyboardHeight > 0 && <View onClick={() => { editorRef.current?.blur(); Taro.hideKeyboard(); setFormatOpen(false) }}>收起</View>}
        </View>
      </ScrollView>}
      <ScrollView className='editor-dock__scroll' scrollX showScrollbar={false}>
        <View className='editor-dock__inner'>
          <View className='primary compact' onClick={() => setInsertOpen(true)}>+</View>
          <View className={formats.header ? 'on' : ''} onClick={() => setLineType('paragraph')}>正文</View>
          <View className={formats.bold ? 'on strong' : 'strong'} onClick={() => applyFormat('bold')}>B</View>
          <View className={formats.list === 'bullet' ? 'on' : ''} onClick={() => setLineType('bulletList')}>列表</View>
          <View className={formats.list === 'check' ? 'on' : ''} onClick={() => setLineType('taskList')}>待办</View>
          <View className={uploading ? 'disabled' : ''} onClick={chooseImage}>{uploading ? '上传中' : '图片'}</View>
          <View onClick={openMindMap}>导图</View>
          <View className={formatOpen ? 'on' : ''} onClick={() => setFormatOpen(!formatOpen)}>更多</View>
        </View>
      </ScrollView>
    </View>}

    {colorOpen && <View className='color-mask' onClick={() => setColorOpen(false)} />}
    {colorOpen && <View className='color-panel'>
      <View className='color-panel__head'><View><Text>字体颜色</Text><Text>点击色块即时应用</Text></View><View className='color-panel__close' onClick={() => setColorOpen(false)}>×</View></View>
      {recentColors.length > 0 && <View className='color-panel__section'><Text>最近使用</Text><View className='color-swatches recent'>{recentColors.map(color => <View key={color} className='color-swatch' style={{ background: color }} onClick={() => applyTextColor(color)} />)}</View></View>}
      <View className='color-panel__section'><Text>标准色</Text><View className='color-swatches'>{COLOR_GROUPS.flat().map(color => <View key={color} className={`color-swatch ${formats.color === color ? 'selected' : ''}`} style={{ background: color }} onClick={() => applyTextColor(color)} />)}</View></View>
      <View className='custom-color'><View className='custom-color__preview' style={{ background: /^#[0-9a-f]{6}$/i.test(customColor) ? customColor : '#5579c2' }} /><Text>#</Text><Input value={customColor.replace('#', '')} maxlength={6} placeholder='5579c2' onInput={event => setCustomColor(`#${event.detail.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)}`)} /><View className={/^#[0-9a-f]{6}$/i.test(customColor) ? '' : 'disabled'} onClick={() => /^#[0-9a-f]{6}$/i.test(customColor) && applyTextColor(customColor)}>应用</View></View>
    </View>}

    {insertOpen && <View className='insert-mask' onClick={() => setInsertOpen(false)} />}
    {insertOpen && <View className='insert-sheet'>
      <View className='insert-sheet__head'><Text>插入内容</Text><View onClick={() => setInsertOpen(false)}>关闭</View></View>
      <View className='insert-grid'>
        {INSERT_TYPES.map(item => <View key={item.type} onClick={() => insertContent(item.type)}><Text>{item.label}</Text></View>)}
        <View onClick={chooseImage}><Text>图片</Text></View>
        <View onClick={insertMindMap}><Text>思维导图</Text></View>
        <View onClick={openMindMap}><Text>打开导图</Text></View>
      </View>
    </View>}
    {panel && <DocumentPanels document={document} mode={panel} onClose={() => setPanel(null)} onDocumentChange={hydrate} />}
  </View>
}
