import { Canvas, Editor, Image, Input, RichText, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, useLoad, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import DocumentPanels from '../../components/DocumentPanels'
import { documentApi, downloadAssetFile, mindMapApi, workspaceApi } from '../../services/api'
import { blocksToContent, contentToBlocks } from '../../services/documentBlocks'
import type { BlockType, DocumentBlock } from '../../services/documentBlocks'
import { blocksToEditorDelta, editorDeltaToBlocks } from '../../services/documentEditor'
import type { EditorDelta, EditorImageLookup } from '../../services/documentEditor'
import { mindMapGraphSummary, standaloneDocumentToMindMapGraph } from '../../services/mindMapImport'
import { renderMindMapPreview } from '../../services/mindMapPreview'
import type { DocumentItem } from '../../types/domain'
import './index.scss'

// 标题统一收在「格式」栏里（H1-H6），插入菜单只放块级内容。
const INSERT_TYPES: { label: string; type: BlockType }[] = [
  { label: '正文', type: 'paragraph' }, { label: '无序列表', type: 'bulletList' },
  { label: '有序列表', type: 'orderedList' }, { label: '待办', type: 'taskList' },
  { label: '引用', type: 'blockquote' }, { label: '代码块', type: 'codeBlock' },
  { label: '外链', type: 'link' }, { label: '分割线', type: 'horizontalRule' }
]
const COLORS = ['#1d2b3e', '#61728a', '#c84f58', '#d87932', '#b89116', '#358863', '#2f83aa', '#5579c2', '#7657b8', '#a94d7f']
const COLOR_GROUPS = [
  ['#1d2b3e', '#4a586b', '#7c899b', '#b4bdc9', '#ffffff'],
  ['#b4232f', '#e05260', '#ed8690', '#c85b2a', '#ed8b4a'],
  ['#8e6d08', '#d3a20d', '#e8c34b', '#23764e', '#45a779'],
  ['#176b91', '#2f83aa', '#69b7d5', '#345ca8', '#5579c2'],
  ['#6142a0', '#7657b8', '#9a82d0', '#943e6c', '#c86498']
]

const wrappedLineCount = (text = '', charactersPerLine = 21) => {
  const lines = text.split('\n')
  return lines.reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)), 0)
}

// 各级标题的字号不同，每行能容纳的字数和行高都跟着变。页面 wxss 进不到编辑器
// 内部，实际字号由微信决定，所以这里一律往宽了取。
const headingMetric = (level = 2) => {
  if (level <= 1) return { charsPerLine: 11, lineHeight: 110 }
  if (level === 2) return { charsPerLine: 14, lineHeight: 88 }
  if (level === 3) return { charsPerLine: 17, lineHeight: 72 }
  return { charsPerLine: 19, lineHeight: 62 }
}

// 微信原生 Editor 默认会形成独立滚动区。按内容预留完整高度，避免正文段
// 与页面最外层 ScrollView 同时滚动。
// 正文栏宽度：750rpx 减去 document-paper 左右各 18rpx 的内边距。
const EDITOR_CONTENT_WIDTH_RPX = 714

const blockHeightRpx = (block: DocumentBlock) => {
  if (block.type === 'image') {
    // 图片以 width:100% 插入，高度完全由原始比例决定，而页面 wxss 进不去编辑器，
    // 没有任何 max-height 能约束它。预留少了就会被直接裁掉（长截图尤其明显），
    // 所以宁可多留一点：留白只是观感，裁切是功能。
    const { imageWidth, imageHeight } = block
    if (imageWidth && imageHeight) {
      return Math.round(Math.min(3600, Math.max(200, EDITOR_CONTENT_WIDTH_RPX * (imageHeight / imageWidth)))) + 48
    }
    // 尺寸未知时按偏高的竖图预留，量出来之后会立刻收敛到真实值。
    return 960
  }
  if (block.type === 'mindMapBlock') return 620
  if (block.type === 'horizontalRule') return 72
  if (block.type === 'heading') {
    // 标题字号远大于正文，一行塞不下 21 个字。按正文口径估算会严重少算行数，
    // 内容溢出编辑器盒子后会和下方的待办/导图叠在一起，而且溢出的部分点不到
    // 光标。这里对每一级都往宽了留 —— 少算是功能问题，多算只是留白。
    const metric = headingMetric(block.level)
    return Math.max(metric.lineHeight, wrappedLineCount(block.text || '', metric.charsPerLine) * metric.lineHeight) + 20
  }
  const visualLines = wrappedLineCount(block.text || '', block.type === 'codeBlock' ? 18 : 21)
  if (block.type === 'codeBlock') return Math.max(72, visualLines * 52) + 24
  if (block.type === 'blockquote') return Math.max(62, visualLines * 54) + 20
  if (block.type === 'bulletList' || block.type === 'orderedList') return Math.max(58, visualLines * 56)
  return Math.max(58, visualLines * 54)
}

const editorHeightRpx = (segmentBlocks: DocumentBlock[], isLast = false) => {
  // 末段只留一点余量。能不能在图片下方落光标已经由 withTrailingLine 保证，
  // 靠留白去撑只会在待办/图片下方堆出一大块空区。
  const trailingSlack = isLast ? 120 : 0
  if (!segmentBlocks.length) return 76 + trailingSlack
  const contentHeight = segmentBlocks.reduce((total, block) => total + blockHeightRpx(block), 0)
  return Math.max(76, contentHeight + 40) + trailingSlack
}

// \u5bfc\u56fe\u662f\u5757\u7ea7\u5361\u7247\uff0c\u5f85\u529e\u8981\u81ea\u7ed8\u590d\u9009\u6846\u2014\u2014\u4e24\u8005\u7684\u5916\u89c2\u90fd\u4e0d\u80fd\u4ea4\u7ed9\u5fae\u4fe1 Editor \u51b3\u5b9a
// \uff08\u539f\u751f checklist \u4f1a\u6e32\u67d3\u6210\u4e00\u4e2a\u5706\u70b9\uff0c\u4e14\u9875\u9762 wxss \u8fdb\u4e0d\u53bb\uff09\u3002\u56e0\u6b64\u5728\u8fd9\u4e24\u79cd\u5757\u5904
// \u628a\u6b63\u6587\u5207\u6210\u591a\u6bb5 Editor\uff0c\u5757\u672c\u8eab\u7528\u666e\u901a React \u7ec4\u4ef6\u6e32\u67d3\u5728\u6bb5\u4e0e\u6bb5\u4e4b\u95f4\u3002
type DocumentFlowItem =
  | { kind: 'editor'; key: string; start: number; count: number; blocks: DocumentBlock[] }
  | { kind: 'task'; key: string; index: number; block: DocumentBlock }
  | { kind: 'mindmap'; key: string; index: number; block: DocumentBlock }

const documentFlow = (blocks: DocumentBlock[]): DocumentFlowItem[] => {
  // 绝大多数文档没有待办和导图，整篇就是一个连续编辑器，不用分段也不会产生空段。
  const needsSplit = blocks.some(block => block.type === 'taskList' || block.type === 'mindMapBlock')
  if (!needsSplit) return [{ kind: 'editor', key: 'editor-0', start: 0, count: blocks.length, blocks }]

  const output: DocumentFlowItem[] = []
  let segmentStart = 0
  let segmentBlocks: DocumentBlock[] = []
  let segmentIndex = 0
  // 千万不要因为某段"看起来是空的"就跳过它 —— 段里的块会留在 blocks 数据里
  // 却没有任何编辑器承载，变成看不见也删不掉的孤儿；等相邻内容再变化时，
  // 这些空行又会突然冒出来。空段照样渲染，只是给一个很小的高度。
  const flush = () => {
    if (!segmentBlocks.length) return
    output.push({ kind: 'editor', key: `editor-${segmentIndex++}`, start: segmentStart, count: segmentBlocks.length, blocks: segmentBlocks })
    segmentBlocks = []
  }
  blocks.forEach((block, index) => {
    if (block.type === 'taskList' || block.type === 'mindMapBlock') {
      flush()
      output.push(block.type === 'taskList'
        ? { kind: 'task', key: `task-${block.id}`, index, block }
        : { kind: 'mindmap', key: `mindmap-${block.mapId || block.id}`, index, block })
      segmentStart = index + 1
    } else {
      if (!segmentBlocks.length) segmentStart = index
      segmentBlocks.push(block)
    }
  })
  flush()
  // 末尾始终留一个可输入的编辑器，否则文档以待办或导图结尾时无处继续写。
  if (output[output.length - 1]?.kind !== 'editor') {
    output.push({ kind: 'editor', key: `editor-${segmentIndex}`, start: blocks.length, count: 0, blocks: [] })
  }
  return output
}

const blankParagraph = (suffix: string): DocumentBlock =>
  ({ id: `${Date.now().toString(36)}-${suffix}`, type: 'paragraph', text: '' })

// 正文的头尾都必须是可以落光标的段落。
// 结尾：文档以图片结尾时后面若没有一行，就再也写不下去了。
// 开头：待办和导图渲染在编辑器之外，如果它们排在第一位，上方就没有任何编辑器
// 段承载光标 —— 看得见一点空隙，却怎么点都进不去。
const withEditableEdges = (blocks: DocumentBlock[]): DocumentBlock[] => {
  let next = blocks
  const first = next[0]
  if (first && (first.type === 'taskList' || first.type === 'mindMapBlock')) {
    next = [blankParagraph('head'), ...next]
  }
  const last = next[next.length - 1]
  if (!last || last.type !== 'paragraph' || (last.text || '').trim()) {
    next = [...next, blankParagraph('tail')]
  }
  return next
}

const deltaText = (delta?: EditorDelta) => (delta?.ops || []).map(op => typeof op.insert === 'string' ? op.insert : '\ufffc').join('')

export default function DocumentPage() {
  const id = useRouter().params.id || ''
  const [document, setDocument] = useState<DocumentItem | null>(null)
  const [title, setTitle] = useState('')
  const [blocks, setBlocks] = useState<DocumentBlock[]>([])
  const [status, setStatus] = useState('正在加载')
  const [insertOpen, setInsertOpen] = useState(false)
  const [panel, setPanel] = useState<'history' | 'share' | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [dockCorrection, setDockCorrection] = useState(0)
  const keyboardCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dockCalibrationTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const keyboardHeightRef = useRef(0)
  const dockCorrectionRef = useRef(0)
  const stableWindowHeightRef = useRef(Math.max(0, Number(Taro.getWindowInfo().windowHeight) || 0))
  const requestDockCalibrationRef = useRef<() => void>(() => {})
  const dockInteractionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dockInteractionRef = useRef(false)
  const [, setEditorActive] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const [formats, setFormats] = useState<Record<string, any>>({})
  const [uploading, setUploading] = useState(false)
  const [creatingMindMap, setCreatingMindMap] = useState(false)
  const [mindMapChoices, setMindMapChoices] = useState<DocumentItem[]>([])
  const [mapPreviews, setMapPreviews] = useState<Record<string, string>>({})
  const [colorOpen, setColorOpen] = useState(false)
  const [customColor, setCustomColor] = useState('#5579c2')
  const [recentColors, setRecentColors] = useState<string[]>([])
  const hydrated = useRef(false)
  const versionRef = useRef(1)
  const documentRef = useRef<DocumentItem | null>(null)
  const titleRef = useRef('')
  const blocksRef = useRef<DocumentBlock[]>([])
  const editorRef = useRef<Taro.EditorContext | null>(null)
  const imageLookupRef = useRef<EditorImageLookup>({})
  const editorTextRef = useRef('')
  const settingEditorRef = useRef(false)
  const savingRef = useRef(false)
  const creatingMindMapRef = useRef(false)
  const queuedRef = useRef(false)
  const previewCanvasRef = useRef<any>(null)
  const editorRefs = useRef<Record<string, Taro.EditorContext>>({})
  // 光标所在段的末尾位置，新导图插在这里而不是永远追加到文末。
  const activeInsertionIndexRef = useRef(0)
  // 当前聚焦的编辑器段覆盖 blocks 的哪一片，按光标切分时需要。
  const activeSegmentRef = useRef<{ key: string; start: number; count: number } | null>(null)
  // 标题输入框不属于正文内容区，聚焦时不应该触发内容区跟着键盘重新布局。
  const contentFocusedRef = useRef(false)
  const previewAttemptedRef = useRef<Set<string>>(new Set())
  // boundingClientRect 返回 px，样式统一用 rpx，这里存换算比例。
  const rpxPerPxRef = useRef(750 / Math.max(1, Number(Taro.getWindowInfo().windowWidth) || 375))
  // 已量出的图片尺寸，按图片地址缓存，避免重复 getImageInfo。
  const imageSizeRef = useRef<Record<string, { width: number; height: number }>>({})
  // 已下载的图片本地路径。重刷段落时不再重新走网络，否则 setContents 会拖到
  // 几秒后才落地，把用户刚点进去的输入框焦点抢走。
  const localPathCacheRef = useRef<Record<string, string>>({})
  // 每段编辑器的实测高度（px）。微信没有读取 editor 内容高度的接口，
  // 这里把 onInput 给出的 html 渲染到屏幕外的镜像节点上量出来。
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const [segmentHtml, setSegmentHtml] = useState<Record<string, string>>({})
  const measureTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const getPreviewCanvas = async () => {
    if (previewCanvasRef.current) return previewCanvasRef.current
    return new Promise<any>((resolve, reject) => {
      Taro.createSelectorQuery().select('#kw-mindmap-preview-canvas').fields({ node: true, size: true }, result => {
        if (result?.node) { previewCanvasRef.current = result.node; resolve(result.node) } else reject(new Error('导图预览画布未就绪'))
      }).exec()
    })
  }

  /** 量出图片真实尺寸并回填到块上。旧文档没有记录尺寸，只靠兜底值会把图裁掉。 */
  const measureImages = async (localPaths: Record<string, string>) => {
    const entries = Object.entries(localPaths)
    let changed = false
    for (const [key, localPath] of entries) {
      if (!localPath || imageSizeRef.current[key]) continue
      try {
        const info = await Taro.getImageInfo({ src: localPath })
        const width = Number(info.width) || 0
        const height = Number(info.height) || 0
        if (!width || !height) continue
        imageSizeRef.current[key] = { width, height }
        changed = true
      } catch {}
    }
    if (!changed) return
    const next = blocksRef.current.map(block => {
      if (block.type !== 'image') return block
      const size = imageSizeRef.current[block.src || block.thumbnail || '']
      if (!size || (block.imageWidth === size.width && block.imageHeight === size.height)) return block
      return { ...block, imageWidth: size.width, imageHeight: size.height }
    })
    if (next.some((block, index) => block !== blocksRef.current[index])) {
      blocksRef.current = next
      setBlocks(next)
    }
  }

  const loadBlocksIntoEditor = async (context: Taro.EditorContext, nextBlocks: DocumentBlock[], measureKey = '') => {
    settingEditorRef.current = true
    const measured: Record<string, string> = {}
    try {
      const prepared = await blocksToEditorDelta(nextBlocks, async block => {
        const key = block.src || block.thumbnail || ''
        const cached = key ? localPathCacheRef.current[key] : ''
        if (cached) return cached
        try {
          const localPath = await downloadAssetFile(block.thumbnail || block.src)
          if (key && localPath) { measured[key] = localPath; localPathCacheRef.current[key] = localPath }
          return localPath
        } catch { return block.thumbnail || block.src || '' }
      })
      imageLookupRef.current = { ...imageLookupRef.current, ...prepared.imageLookup }
      editorTextRef.current = deltaText(prepared.delta)
      context.setContents({
        delta: prepared.delta,
        complete: () => setTimeout(() => {
          settingEditorRef.current = false
          void measureImages(measured)
          context.getContents({ success: (result: any) => scheduleMeasure(measureKey, result?.html || '') })
        }, 80)
      })
    } catch {
      settingEditorRef.current = false
      Taro.showToast({ title: '文档内容加载失败', icon: 'none' })
    }
  }

  const hydrate = (result: DocumentItem) => {
    setDocument(result); documentRef.current = result
    setTitle(result.title); titleRef.current = result.title
    const nextBlocks = withEditableEdges(contentToBlocks(result.content))
    setBlocks(nextBlocks); blocksRef.current = nextBlocks
    versionRef.current = result.version
    setStatus(`版本 ${result.version}`)
    // 已经挂载的段要立刻推入内容；还没 ready 的会在 editorReady 里补上。
    documentFlow(nextBlocks).forEach(item => {
      if (item.kind !== 'editor') return
      const context = editorRefs.current[item.key]
      if (context) void loadBlocksIntoEditor(context, item.blocks)
    })
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

  const clearDockCalibrationTimers = () => {
    dockCalibrationTimersRef.current.forEach(timer => clearTimeout(timer))
    dockCalibrationTimersRef.current = []
  }

  const resetKeyboardLayout = () => {
    if (keyboardCloseTimerRef.current) clearTimeout(keyboardCloseTimerRef.current)
    keyboardCloseTimerRef.current = null
    keyboardHeightRef.current = 0
    setKeyboardHeight(0)
    clearDockCalibrationTimers()
    dockCorrectionRef.current = 0
    setDockCorrection(0)
    const currentHeight = Math.max(0, Number(Taro.getWindowInfo().windowHeight) || 0)
    if (currentHeight > stableWindowHeightRef.current) stableWindowHeightRef.current = currentHeight
  }

  useEffect(() => {
    const updateDockCorrection = (nextCorrection: number) => {
      const stableHeight = stableWindowHeightRef.current || 1
      const safeCorrection = Math.max(-stableHeight, Math.min(stableHeight, nextCorrection))
      if (Math.abs(safeCorrection - dockCorrectionRef.current) < .5) return
      dockCorrectionRef.current = safeCorrection
      setDockCorrection(safeCorrection)
    }

    const calibrateDock = (height: number) => {
      if (height <= 0 || keyboardHeightRef.current <= 0) return
      Taro.createSelectorQuery().select('#kw-editor-dock').boundingClientRect(rect => {
        if (!rect || keyboardHeightRef.current <= 0) return
        const dockHeight = Math.max(0, Number(rect.height) || 0)
        const currentTop = Number(rect.top)
        const stableHeight = stableWindowHeightRef.current
        if (!stableHeight || !Number.isFinite(currentTop) || !dockHeight) return

        // 中间段原生 Editor 获得焦点时，微信会把页面整体上移；
        // fixed: bottom=0 也会跟着错位。用稳定视口高度和键盘
        // 真实高度算出键盘上沿，再根据实际位置迭代校正。
        const desiredTop = Math.max(0, stableHeight - height - dockHeight)
        const delta = desiredTop - currentTop
        if (Math.abs(delta) < .5) return
        updateDockCorrection(dockCorrectionRef.current + delta)
      }).exec()
    }

    const scheduleDockCalibration = (height: number) => {
      clearDockCalibrationTimers()
      // 原生 Editor 的自动上移和键盘高度事件不在同一帧，
      // 需要覆盖初次弹起、输入法候选栏完成和页面平移收尾。
      ;[0, 48, 120, 240, 420, 700].forEach(delay => {
        dockCalibrationTimersRef.current.push(setTimeout(() => calibrateDock(height), delay))
      })
    }
    requestDockCalibrationRef.current = () => {
      const height = keyboardHeightRef.current
      if (height > 0) scheduleDockCalibration(height)
    }

    const clearKeyboardCloseTimer = () => {
      if (!keyboardCloseTimerRef.current) return
      clearTimeout(keyboardCloseTimerRef.current)
      keyboardCloseTimerRef.current = null
    }

    const listener = ({ height }: { height: number }) => {
      const nextHeight = Math.max(0, Number(height) || 0)
      if (nextHeight > 0) {
        clearKeyboardCloseTimer()
        // 标题输入不属于正文内容区，别让它触发内容区跟着重新布局——
        // 这正是标题输入法弹起又立刻收起的根因。
        if (!contentFocusedRef.current) return
        keyboardHeightRef.current = nextHeight
        setKeyboardHeight(nextHeight)
        scheduleDockCalibration(nextHeight)
      } else {
        // 延迟确认真正收起，过滤焦点切换时的短暂 0 高度事件。
        clearKeyboardCloseTimer()
        keyboardCloseTimerRef.current = setTimeout(resetKeyboardLayout, 120)
      }
    }
    Taro.onKeyboardHeightChange(listener)
    return () => {
      Taro.offKeyboardHeightChange(listener)
      if (keyboardCloseTimerRef.current) clearTimeout(keyboardCloseTimerRef.current)
      if (dockInteractionTimerRef.current) clearTimeout(dockInteractionTimerRef.current)
      Object.values(measureTimersRef.current).forEach(timer => clearTimeout(timer))
      clearDockCalibrationTimers()
      requestDockCalibrationRef.current = () => {}
    }
  }, [])

  const keepKeyboardDocked = () => {
    if (!keyboardCloseTimerRef.current) return
    clearTimeout(keyboardCloseTimerRef.current)
    keyboardCloseTimerRef.current = null
  }

  const scheduleKeyboardDockReset = () => {
    // 点击工具栏会让原生 Editor 短暂触发 blur，但键盘并未真正关闭。
    // 这种 blur 不能把工具栏送回屏幕底部，否则工具栏会落到键盘后面。
    if (dockInteractionRef.current) return
    if (keyboardCloseTimerRef.current) clearTimeout(keyboardCloseTimerRef.current)
    keyboardCloseTimerRef.current = setTimeout(() => {
      resetKeyboardLayout()
    }, 160)
  }

  const preserveDockDuringAction = () => {
    keepKeyboardDocked()
    dockInteractionRef.current = true
    if (dockInteractionTimerRef.current) clearTimeout(dockInteractionTimerRef.current)
    dockInteractionTimerRef.current = setTimeout(() => {
      dockInteractionTimerRef.current = null
      dockInteractionRef.current = false
    }, 260)
  }

  const closeKeyboard = () => {
    resetKeyboardLayout()
    setFormatOpen(false)
    editorRef.current?.blur()
    Taro.hideKeyboard()
  }

  // rich-text 对 <img> 的渲染跟编辑器不一致，镜像里把图片摘掉；
  // 图片高度另有 getImageInfo 量出的精确值，不需要靠镜像估。
  const measurableHtml = (html: string) => String(html || '').replace(/<img[^>]*>/gi, '')

  const scheduleMeasure = (key: string, html: string) => {
    setSegmentHtml(current => current[key] === measurableHtml(html) ? current : ({ ...current, [key]: measurableHtml(html) }))
    if (measureTimersRef.current[key]) clearTimeout(measureTimersRef.current[key])
    measureTimersRef.current[key] = setTimeout(() => {
      Taro.createSelectorQuery().select(`#kw-measure-${key}`).boundingClientRect(rect => {
        const height = Math.ceil(Number((rect as any)?.height) || 0)
        if (!height) return
        setMeasuredHeights(current => current[key] === height ? current : ({ ...current, [key]: height }))
      }).exec()
    }, 120)
  }

  // 镜像用的是 .document-editor 的字号，编辑器内部实际字号由微信决定，两者未必
  // 完全一致，所以留一点安全系数。
  const MEASURE_SAFETY = 1.04
  const segmentHeightStyle = (item: { key: string; blocks: DocumentBlock[] }, isLast: boolean) => {
    const estimateRpx = editorHeightRpx(item.blocks, isLast)
    const measuredPx = measuredHeights[item.key]
    if (!measuredPx) return { height: `${estimateRpx}rpx` }
    // 图片不参与镜像测量（rich-text 排不出编辑器里的效果），用 getImageInfo
    // 量出的精确高度单独加上。
    const imageRpx = item.blocks.reduce((total, block) => total + (block.type === 'image' ? blockHeightRpx(block) : 0), 0)
    const textRpx = measuredPx * rpxPerPxRef.current * MEASURE_SAFETY
    // rich-text 渲染失败或只渲染了一部分时高度会异常偏小，这种值不能信，
    // 否则又会溢出重合。明显低于估算就判定不可信，退回估算。
    if (textRpx + imageRpx < estimateRpx * 0.45) return { height: `${estimateRpx}rpx` }
    const slackRpx = (isLast ? 120 : 0) + 32
    return { height: `${Math.ceil(textRpx + imageRpx + slackRpx)}rpx` }
  }

  const editorReady = (key: string, segmentBlocks: DocumentBlock[]) => {
    Taro.createSelectorQuery().select(`#kw-document-${key}`).context(result => {
      const context = result.context as Taro.EditorContext
      if (!context) return
      editorRefs.current[key] = context
      if (!editorRef.current) editorRef.current = context
      void loadBlocksIntoEditor(context, segmentBlocks, key)
    }).exec()
  }

  // 一段 Editor 只负责 blocks[start, start+count) 这一片，回写时原地替换该片。
  const onEditorInput = (key: string, start: number, count: number, event: any) => {
    if (settingEditorRef.current) return
    scheduleMeasure(key, event.detail.html)
    const delta = event.detail.delta as EditorDelta
    editorTextRef.current = deltaText(delta)
    // 待办的续行与退出由原生 checklist 自己处理，这里只负责把 delta 同步成块。
    const segment = editorDeltaToBlocks(delta, imageLookupRef.current)
    const next = withEditableEdges([...blocksRef.current.slice(0, start), ...segment, ...blocksRef.current.slice(start + count)])
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
    if (type === 'taskList') return insertTaskBlock()
    if (!editorRef.current) return
    if (type === 'horizontalRule') editorRef.current.insertDivider()
    else if (type === 'link') void insertLink()
    else setLineType(type)
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
      // 记下真实比例，正文才能按图片实际占的高度预留空间，而不是一律按最大值留白。
      let imageWidth = Number(media.width) || 0
      let imageHeight = Number(media.height) || 0
      if (!imageWidth || !imageHeight) {
        try {
          const info = await Taro.getImageInfo({ src: localPath })
          imageWidth = Number(info.width) || 0
          imageHeight = Number(info.height) || 0
        } catch {}
      }
      imageLookupRef.current[localPath] = {
        src: asset.url, thumbnail: asset.thumbnail_url, alt: asset.name,
        ...(imageWidth && imageHeight ? { imageWidth, imageHeight } : {})
      }
      editorRef.current.insertImage({
        src: localPath,
        width: '100%',
        alt: asset.name,
        data: { originalSrc: asset.url, thumbnail: asset.thumbnail_url, localSrc: localPath },
        fail: (error: any) => Taro.showToast({ title: error?.errMsg || '图片插入失败', icon: 'none' })
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

  const createAndInsertMindMap = async (title: string, graph: Record<string, any>, successMessage: string) => {
    // 不再要求 editorRef —— 导图卡片是独立 React 块，跟 Editor 实例无关。
    if (!documentRef.current || creatingMindMapRef.current) return
    creatingMindMapRef.current = true
    setCreatingMindMap(true)
    try {
      Taro.showLoading({ title: '创建导图', mask: true })
      const map = await mindMapApi.create(documentRef.current.id, title, graph)
      const summary = mindMapGraphSummary(map.graph || graph)
      const mapBlock: DocumentBlock = { id: `${Date.now()}-map`, type: 'mindMapBlock', mapId: map.id, title: map.title, ...summary }
      insertBlockAtCursor(mapBlock)
      // 预览图失败也不影响卡片出现，卡片会退化成中心主题占位。
      try {
        const preview = await renderMindMapPreview(map, await getPreviewCanvas())
        if (preview) setMapPreviews(current => ({ ...current, [map.id]: preview }))
      } catch {}
      previewAttemptedRef.current.add(map.id)
      await saveNow('mind-map-insert')
      Taro.showToast({ title: successMessage, icon: 'success' })
    } catch (error) { Taro.showToast({ title: (error as Error).message || '导图创建失败', icon: 'none' }) }
    finally {
      creatingMindMapRef.current = false
      setCreatingMindMap(false)
      Taro.hideLoading()
      setInsertOpen(false)
    }
  }

  const insertNewMindMap = () => {
    const rootId = `root-${Date.now()}`
    return createAndInsertMindMap('未命名思维导图', {
      nodes: [{ id: rootId, type: 'root', position: { x: 80, y: 180 }, data: { label: '中心主题' } }],
      edges: [],
      layoutStyle: 'right'
    }, '导图已插入')
  }

  // 为正文里已有的导图块补预览图。失败只试一次，避免每次输入都重试。
  useEffect(() => {
    const pending = blocks.filter(block =>
      block.type === 'mindMapBlock' && block.mapId &&
      !mapPreviews[block.mapId] && !previewAttemptedRef.current.has(block.mapId)
    )
    if (!pending.length || !documentRef.current) return
    let cancelled = false
    void (async () => {
      for (const block of pending) {
        const mapId = block.mapId as string
        previewAttemptedRef.current.add(mapId)
        try {
          const map = await mindMapApi.get(documentRef.current!.id, mapId)
          const preview = await renderMindMapPreview(map, await getPreviewCanvas())
          if (!cancelled && preview) setMapPreviews(current => ({ ...current, [mapId]: preview }))
        } catch {}
      }
    })()
    return () => { cancelled = true }
  }, [blocks, mapPreviews])

  // 从导图编辑页返回时预览必须重画，否则卡片永远停留在刚创建的样子。
  useDidShow(() => {
    if (!hydrated.current) return
    previewAttemptedRef.current.clear()
    setMapPreviews({})
  })

  const openMindMapBlock = (block: DocumentBlock) => {
    if (!block.mapId || !documentRef.current) return
    Taro.navigateTo({ url: `/pages/mindmap/index?id=${documentRef.current.id}&mapId=${block.mapId}` })
  }

  const updateTaskLine = (blockIndex: number, lineIndex: number, value: string) => {
    const next = [...blocksRef.current]
    const current = next[blockIndex]
    if (!current || current.type !== 'taskList') return
    const lines = (current.text || '').split('\n')
    const checkedLines = [...(current.checkedLines || [])]
    // 在待办里敲回车会把换行带进这一行的值，要真的拆成多行，
    // 否则勾选状态会和显示的行对不上。
    const inserted = value.split('\n')
    lines.splice(lineIndex, 1, ...inserted)
    if (inserted.length > 1) checkedLines.splice(lineIndex + 1, 0, ...new Array(inserted.length - 1).fill(false))
    next[blockIndex] = { ...current, text: lines.join('\n'), checkedLines }
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

  const removeTaskLine = (blockIndex: number, lineIndex: number) => {
    const next = [...blocksRef.current]
    const current = next[blockIndex]
    if (!current || current.type !== 'taskList') return
    const lines = (current.text || '').split('\n')
    const checkedLines = [...(current.checkedLines || [])]
    lines.splice(lineIndex, 1)
    checkedLines.splice(lineIndex, 1)
    // 删掉最后一条就把整个待办块移除，否则会留下一个空块占位。
    if (!lines.length) next.splice(blockIndex, 1)
    else next[blockIndex] = { ...current, text: lines.join('\n'), checkedLines }
    blocksRef.current = next
    setBlocks(next)
  }

  const removeBlockAt = (blockIndex: number) => {
    const next = blocksRef.current.filter((_, index) => index !== blockIndex)
    blocksRef.current = next
    setBlocks(next)
  }

  const removeMindMapBlock = async (blockIndex: number, block: DocumentBlock) => {
    const answer = await Taro.showModal({ title: '移除思维导图', content: '将从正文中移除这张导图，导图本身仍保留在文档中。' })
    if (!answer.confirm) return
    if (block.mapId) previewAttemptedRef.current.delete(block.mapId)
    removeBlockAt(blockIndex)
  }

  // 插入点前面正好是一个空段落时就占用它的位置，否则待办上方会平白多出一行空白。
  const absorbBlankBefore = (blocks: DocumentBlock[], insertAt: number) => {
    const previous = blocks[insertAt - 1]
    if (insertAt > 0 && previous?.type === 'paragraph' && !(previous.text || '').trim()) {
      return { blocks: [...blocks.slice(0, insertAt - 1), ...blocks.slice(insertAt)], insertAt: insertAt - 1 }
    }
    return { blocks, insertAt }
  }


  /** 重刷受结构变化影响的编辑器段。段的划分变了，原有段仍显示旧内容。
      只刷改动位置之后的段 —— 全刷会对没变的段也调 setContents，而 setContents
      落地时会抢走焦点，用户此刻可能已经在别处打字了。 */
  const reloadSegments = async (nextBlocks: DocumentBlock[], fromIndex = 0) => {
    for (const item of documentFlow(nextBlocks)) {
      if (item.kind !== 'editor' || item.start + item.count <= fromIndex) continue
      const context = editorRefs.current[item.key]
      if (context) await loadBlocksIntoEditor(context, item.blocks, item.key)
    }
  }

  // 微信不提供光标位置。先在光标处插入一个不可见标记，读回内容找到它落在
  // 哪一行，就地切开 —— 否则新块只能追加到当前段末尾，跟光标对不上。
  const CURSOR_MARKER = '\u2063KW\u2063'

  const insertBlockAtCursor = (block: DocumentBlock) => {
    const context = editorRef.current
    const segment = activeSegmentRef.current
    const appendFallback = () => {
      const insertAt = Math.min(Math.max(0, activeInsertionIndexRef.current || blocksRef.current.length), blocksRef.current.length)
      const absorbed = absorbBlankBefore(blocksRef.current, insertAt)
      const next = withEditableEdges([...absorbed.blocks.slice(0, absorbed.insertAt), block, ...absorbed.blocks.slice(absorbed.insertAt)])
      blocksRef.current = next
      setBlocks(next)
      activeInsertionIndexRef.current = absorbed.insertAt + 1
      return next
    }
    if (!context || !segment) { appendFallback(); return }

    context.insertText({
      text: CURSOR_MARKER,
      success: () => context.getContents({
        success: (result: any) => {
          const delta = result?.delta as EditorDelta | undefined
          if (!delta) { appendFallback(); return }
          const parsed = editorDeltaToBlocks(delta, imageLookupRef.current)
          const markerIndex = parsed.findIndex(item => (item.text || '').includes(CURSOR_MARKER))
          if (markerIndex < 0) { appendFallback(); return }

          const target = parsed[markerIndex]
          const [before, after] = (target.text || '').split(CURSOR_MARKER)
          const head = before.trim() ? [{ ...target, text: before }] : []
          const tail = after.trim() ? [{ ...target, id: `${target.id}-tail`, text: after }] : []
          const rebuilt = [...parsed.slice(0, markerIndex), ...head, block, ...tail, ...parsed.slice(markerIndex + 1)]
          const next = withEditableEdges([
            ...blocksRef.current.slice(0, segment.start),
            ...rebuilt,
            ...blocksRef.current.slice(segment.start + segment.count)
          ])
          blocksRef.current = next
          setBlocks(next)
          activeInsertionIndexRef.current = segment.start + markerIndex + head.length + 1
          void reloadSegments(next, segment.start)
        },
        fail: () => { appendFallback() }
      }),
      fail: () => { appendFallback() }
    })
  }

  const insertTaskBlock = () => {
    insertBlockAtCursor({ id: `${Date.now()}-task`, type: 'taskList', text: '', checkedLines: [false] })
    setInsertOpen(false)
  }

  const importMindMap = async () => {
    if (!documentRef.current || creatingMindMapRef.current) return
    try {
      Taro.showLoading({ title: '读取已有导图', mask: true })
      const documents = await workspaceApi.documents(documentRef.current.workspace_id)
      const candidates = documents.filter(item => item.type === 'mindmap')
      Taro.hideLoading()
      if (!candidates.length) return Taro.showToast({ title: '空间里还没有可导入的导图', icon: 'none' })
      setInsertOpen(false)
      setMindMapChoices(candidates)
    } catch (error) {
      Taro.hideLoading()
      Taro.showToast({ title: (error as Error).message || '导图读取失败', icon: 'none' })
    }
  }

  const importSelectedMindMap = async (selected: DocumentItem) => {
    setMindMapChoices([])
    await createAndInsertMindMap(
      String(selected.content?.root || selected.title || '未命名思维导图'),
      standaloneDocumentToMindMapGraph(selected),
      '导图已导入'
    )
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
  const flowItems = documentFlow(blocks)
  // 整篇文档为空时才显示占位提示。文档里已经有图片或待办了，末段再冒出一句
  // 「输入正文」会让人觉得内容被割成了两截。
  const documentEmpty = !blocks.some(block => {
    if (block.type === 'image') return Boolean(block.src || block.thumbnail)
    if (block.type === 'mindMapBlock' || block.type === 'horizontalRule') return true
    return Boolean((block.text || '').trim())
  })
  return <View className='document-page'>
    <Canvas id='kw-mindmap-preview-canvas' type='2d' className='mindmap-preview-canvas' />
    <View className='document-top'>
      <View className='document-top__type'>文</View>
      <Text className='document-top__status'>{status}</Text>
      <View className='document-top__action' onClick={() => saveNow('manual')}>保存</View>
      <View className='document-top__menu' onClick={openDocumentMenu}>•••</View>
    </View>

    {/* scrollAnchoring 曾用来配合"键盘弹起时整页容器跟着变矮"的旧方案，那套方案早改成
        translate3d + 底部占位（见下方 keyboardHeight/dockCorrection），但这个 flag 一直没删。
        它会在容器内任何元素变高时（包括聚焦中的 textarea 自身 autoHeight 换行）悄悄挪动 scrollTop，
        而标题/待办这类 adjustPosition={false} 的原生输入框一旦被这样挪动就会被系统判定失焦——
        键盘"弹起又立刻收起"就是这么来的，删掉即可，不需要替代方案。 */}
    <ScrollView className='document-scroll' scrollY enhanced enableFlex showScrollbar={false}>
      <View className='document-paper'>
        <View className='document-title-wrap'>
          <Textarea className='document-title' autoHeight adjustPosition={false} value={title} placeholder='无标题文档' maxlength={300} showConfirmBar={false} onFocus={() => { contentFocusedRef.current = false; activeSegmentRef.current = null; keepKeyboardDocked(); setEditorActive(false) }} onBlur={scheduleKeyboardDockReset} onInput={event => setTitle(event.detail.value)} />
        </View>
        <View className='document-flow'>
          {flowItems.map((item, flowIndex) => {
            if (item.kind === 'task') {
              const lines = (item.block.text || '').split('\n')
              return <View key={item.key} className='task-block'>
                {lines.map((line, lineIndex) => {
                  const checked = Boolean(item.block.checkedLines?.[lineIndex])
                  return <View key={`${item.key}-${lineIndex}`} className={`task-row ${checked ? 'checked' : ''}`}>
                    <View className='task-check-hit' onClick={() => toggleTaskLine(item.index, lineIndex)}>
                      <View className='task-check'>{checked ? '✓' : ''}</View>
                    </View>
                    {/* 微信原生 textarea 不吃 text-decoration，勾选后换成 text 才画得出删除线。 */}
                    {checked
                      ? <Text className='task-text task-text--done' onClick={() => toggleTaskLine(item.index, lineIndex)}>{line || '已完成'}</Text>
                      : <Textarea
                        className='task-text'
                        autoHeight
                        value={line}
                        placeholder='输入待办事项'
                        maxlength={2000}
                        showConfirmBar={false}
                        adjustPosition={false}
                        onFocus={() => {
                          // 焦点在待办行上，不属于任何编辑器段；不清掉的话按光标
                          // 插入会往上一个聚焦过的编辑器里塞标记。
                          activeSegmentRef.current = null
                          activeInsertionIndexRef.current = item.index + 1
                          contentFocusedRef.current = true
                          keepKeyboardDocked()
                          setEditorActive(true)
                          requestDockCalibrationRef.current()
                        }}
                        onBlur={scheduleKeyboardDockReset}
                        onInput={event => updateTaskLine(item.index, lineIndex, event.detail.value)}
                      />}
                    <View className='task-remove' onClick={() => removeTaskLine(item.index, lineIndex)}>×</View>
                  </View>
                })}
              </View>
            }
            if (item.kind === 'mindmap') {
              const preview = item.block.mapId ? mapPreviews[item.block.mapId] : ''
              return <View key={item.key} className='mindmap-interactive' hoverClass='mindmap-interactive--pressed' onClick={() => openMindMapBlock(item.block)}>
                {preview
                  ? <Image className='mindmap-interactive__image' src={preview} mode='aspectFit' />
                  : <View className='mindmap-interactive__fallback'><View className='mindmap-interactive__root'>{item.block.previewLabels?.[0] || '中心主题'}</View></View>}
                <View className='mindmap-interactive__remove' onClick={event => { event.stopPropagation(); void removeMindMapBlock(item.index, item.block) }}>×</View>
              </View>
            }
            return <Editor
              key={item.key}
              id={`kw-document-${item.key}`}
              className='document-editor document-editor--continuous'
              style={segmentHeightStyle(item, flowIndex === flowItems.length - 1)}
              placeholder={documentEmpty ? '输入正文…' : ''}
              showImgSize
              showImgToolbar
              showImgResize
              onReady={() => editorReady(item.key, item.blocks)}
              onFocus={() => {
                editorRef.current = editorRefs.current[item.key] || editorRef.current
                activeSegmentRef.current = { key: item.key, start: item.start, count: item.count }
                activeInsertionIndexRef.current = item.start + item.count
                contentFocusedRef.current = true
                keepKeyboardDocked()
                setEditorActive(true)
                requestDockCalibrationRef.current()
              }}
              onBlur={scheduleKeyboardDockReset}
              onInput={(event: any) => onEditorInput(item.key, item.start, item.count, event)}
              onStatusChange={(event: any) => setFormats(event.detail || {})}
            />
          })}
          {flowItems.filter(item => item.kind === 'editor').map(item => (
            <View key={`measure-${item.key}`} className='editor-measure' id={`kw-measure-${item.key}`}>
              <RichText nodes={segmentHtml[item.key] || ''} />
            </View>
          ))}
        </View>
      </View>
      <View
        className={`document-bottom-space ${dockVisible ? 'dock-visible' : ''}`}
        style={keyboardHeight ? { height: `${keyboardHeight + 96}px` } : undefined}
      />
    </ScrollView>

    {!dockVisible && !insertOpen && <View className='floating-insert' onClick={() => { setInsertOpen(true); setEditorActive(true) }}><View className='floating-insert__plus'>+</View><Text>插入内容</Text></View>}

    {dockVisible && !insertOpen && <View
      id='kw-editor-dock'
      className={`editor-dock ${keyboardHeight ? 'keyboard-open' : ''}`}
      style={dockCorrection ? { transform: `translate3d(0, ${dockCorrection}px, 0)` } : undefined}
      onTouchStart={preserveDockDuringAction}
    >
      {formatOpen ? <ScrollView className='format-strip' scrollX showScrollbar={false}>
        <View className='format-strip__inner'>
          <View className='format-back' onClick={() => setFormatOpen(false)}>‹ 返回</View>
          <View onClick={() => setLineType('paragraph')}>正文</View>
          <View onClick={() => setLineType('heading', 1)}>H1</View>
          <View onClick={() => setLineType('heading', 2)}>H2</View>
          <View onClick={() => setLineType('heading', 3)}>H3</View>
          <View onClick={() => setLineType('heading', 4)}>H4</View>
          <View onClick={() => setLineType('heading', 5)}>H5</View>
          <View onClick={() => setLineType('heading', 6)}>H6</View>
          <View className={formats.bold ? 'on strong' : 'strong'} onClick={() => applyFormat('bold')}>加粗</View>
          <View onClick={insertTaskBlock}>待办</View>
          <View onClick={() => setLineType('orderedList')}>编号</View>
          <View className={formats.list === 'bullet' ? 'on' : ''} onClick={() => setLineType('bulletList')}>列表</View>
          <View onClick={() => setLineType('blockquote')}>引用</View>
          <View className={formats.italic ? 'on italic' : 'italic'} onClick={() => applyFormat('italic')}>I</View>
          <View className={formats.underline ? 'on underline' : 'underline'} onClick={() => applyFormat('underline')}>U</View>
          <View className={colorOpen ? 'color-tool on' : 'color-tool'} onClick={() => setColorOpen(!colorOpen)}><Text style={{ background: formats.color || COLORS[0] }} /></View>
          <View onClick={() => editorRef.current?.undo()}>撤销</View>
          <View onClick={() => editorRef.current?.redo()}>重做</View>
          {keyboardHeight > 0 && <View onClick={closeKeyboard}>收起</View>}
        </View>
      </ScrollView> : <ScrollView className='editor-dock__scroll' scrollX showScrollbar={false}>
        <View className='editor-dock__inner'>
          <View className='primary insert-tool' onClick={() => setInsertOpen(true)}>＋ 插入</View>
          <View className={formatOpen ? 'on' : ''} onClick={() => setFormatOpen(!formatOpen)}>格式</View>
          <View className={formats.list === 'bullet' ? 'on' : ''} onClick={() => setLineType('bulletList')}>列表</View>
          <View onClick={insertTaskBlock}>待办</View>
          <View className={uploading ? 'disabled' : ''} onClick={chooseImage}>{uploading ? '上传中' : '图片'}</View>
          <View className={creatingMindMap ? 'disabled' : ''} onClick={insertNewMindMap}>{creatingMindMap ? '创建中' : '导图'}</View>
        </View>
      </ScrollView>}
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
        <View className={creatingMindMap ? 'disabled' : ''} onClick={insertNewMindMap}><Text>{creatingMindMap ? '创建中…' : '新建导图'}</Text></View>
        <View className={creatingMindMap ? 'disabled' : ''} onClick={importMindMap}><Text>导入导图</Text></View>
      </View>
    </View>}
    {mindMapChoices.length > 0 && <View className='insert-mask' onClick={() => setMindMapChoices([])} />}
    {mindMapChoices.length > 0 && <View className='insert-sheet mindmap-picker'>
      <View className='insert-sheet__head'><Text>选择已有导图</Text><View onClick={() => setMindMapChoices([])}>取消</View></View>
      <ScrollView className='mindmap-picker__list' scrollY showScrollbar={false}>
        {mindMapChoices.map(item => <View className='mindmap-picker__item' key={item.id} onClick={() => void importSelectedMindMap(item)}>
          <View className='mindmap-picker__icon'>导</View>
          <View className='mindmap-picker__text'>
            <Text>{item.title || '未命名思维导图'}</Text>
            <Text>{String(item.content?.root || '中心主题')}</Text>
          </View>
          <Text className='mindmap-picker__arrow'>›</Text>
        </View>)}
      </ScrollView>
    </View>}
    {panel && <DocumentPanels document={document} mode={panel} onClose={() => setPanel(null)} onDocumentChange={hydrate} />}
  </View>
}
