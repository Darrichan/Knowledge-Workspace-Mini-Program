import { Image, Input, Picker, ScrollView, Switch, Text, Textarea, View } from '@tarojs/components'
import Taro, { useLoad, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import DocumentPanels from '../../components/DocumentPanels'
import { documentApi, downloadAssetFile, mindMapApi } from '../../services/api'
import { blocksToContent, contentToBlocks, createBlock as createDocumentBlock } from '../../services/documentBlocks'
import type { BlockType, DocumentBlock } from '../../services/documentBlocks'
import type { DocumentItem } from '../../types/domain'
import './index.scss'

const INSERT_TYPES: { label: string; type: BlockType }[] = [
  { label: '正文', type: 'paragraph' }, { label: '标题', type: 'heading' }, { label: '无序列表', type: 'bulletList' },
  { label: '有序列表', type: 'orderedList' }, { label: '待办', type: 'taskList' }, { label: '引用', type: 'blockquote' },
  { label: '代码块', type: 'codeBlock' }, { label: '外链', type: 'link' }, { label: '分割线', type: 'horizontalRule' }
]
const LANGUAGES = ['plaintext', 'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'sql', 'json', 'html', 'css', 'bash', 'yaml', 'markdown']
const COLORS = ['#25364d', '#60738e', '#d35f5f', '#df8c35', '#d0a20c', '#3b9a69', '#3388b7', '#5f82d1', '#805fc5', '#bd5e91']

function ProtectedDocumentImage({ block, onAltChange }: { block: DocumentBlock; onAltChange: (value: string) => void }) {
  const [previewSrc, setPreviewSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    downloadAssetFile(block.thumbnail || block.src)
      .then(path => { if (alive) setPreviewSrc(path) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [block.thumbnail, block.src])

  const openPreview = async () => {
    try {
      Taro.showLoading({ title: '加载原图', mask: true })
      const fullPath = await downloadAssetFile(block.src)
      if (fullPath) await Taro.previewImage({ current: fullPath, urls: [fullPath] })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { Taro.hideLoading() }
  }

  return <View className='image-block'>
    {previewSrc ? <Image mode='widthFix' lazyLoad src={previewSrc} onClick={openPreview} /> : <View className={`image-placeholder ${failed ? 'failed' : ''}`} onClick={failed ? openPreview : undefined}><Text>{failed ? '图片加载失败，点击重试' : '图片加载中…'}</Text></View>}
    <Input value={block.alt} placeholder='添加图片说明' onInput={event => onAltChange(event.detail.value)} />
  </View>
}

export default function DocumentPage() {
  const id = useRouter().params.id || ''
  const [document, setDocument] = useState<DocumentItem | null>(null)
  const [title, setTitle] = useState('')
  const [blocks, setBlocks] = useState<DocumentBlock[]>([])
  const [status, setStatus] = useState('正在加载')
  const [activeBlockId, setActiveBlockId] = useState('')
  const [insertOpen, setInsertOpen] = useState(false)
  const [panel, setPanel] = useState<'history' | 'share' | null>(null)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const hydrated = useRef(false)
  const versionRef = useRef(1)
  const documentRef = useRef<DocumentItem | null>(null)
  const titleRef = useRef('')
  const blocksRef = useRef<DocumentBlock[]>([])
  const savingRef = useRef(false)
  const queuedRef = useRef(false)

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
    const listener = ({ height }: { height: number }) => setKeyboardOpen(height > 0)
    Taro.onKeyboardHeightChange(listener)
    return () => Taro.offKeyboardHeightChange(listener)
  }, [])

  const updateBlock = (blockId: string, patch: Partial<DocumentBlock>) => setBlocks(current => current.map(block => block.id === blockId ? { ...block, ...patch } : block))
  const removeBlock = (blockId: string) => setBlocks(current => current.length === 1 ? [createDocumentBlock()] : current.filter(block => block.id !== blockId))
  const duplicateBlock = (block: DocumentBlock) => setBlocks(current => { const index = current.findIndex(item => item.id === block.id); const copy = { ...block, id: `${Date.now()}-copy` }; return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)] })
  const moveBlock = (blockId: string, offset: number) => setBlocks(current => { const index = current.findIndex(block => block.id === blockId); const target = index + offset; if (index < 0 || target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next })
  const insertBlock = (type: BlockType) => {
    const block = createDocumentBlock(type)
    setBlocks(current => { const index = Math.max(-1, current.findIndex(item => item.id === activeBlockId)); return [...current.slice(0, index + 1), block, ...current.slice(index + 1)] })
    setActiveBlockId(block.id); setInsertOpen(false)
  }

  const changeBlockType = (blockId: string, type: BlockType, level?: number) => updateBlock(blockId, {
    type,
    ...(type === 'heading' ? { level: level || 2 } : {}),
    ...(type === 'codeBlock' ? { language: 'plaintext' } : {})
  })

  const chooseImage = async () => {
    try {
      const result = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] })
      const media = result.tempFiles[0]
      if (!media || !documentRef.current) return
      Taro.showLoading({ title: '上传图片', mask: true })
      let path = media.tempFilePath
      try { path = (await Taro.compressImage({ src: path, quality: 65 })).tempFilePath } catch {}
      const asset = await documentApi.uploadImage(documentRef.current.id, path, path.split('/').pop() || 'image.jpg')
      const block: DocumentBlock = { id: `${Date.now()}-image`, type: 'image', src: asset.url, thumbnail: asset.thumbnail_url, alt: asset.name }
      setBlocks(current => { const index = Math.max(-1, current.findIndex(item => item.id === activeBlockId)); return [...current.slice(0, index + 1), block, ...current.slice(index + 1)] })
      setActiveBlockId(block.id)
    } catch (error) {
      const message = (error as any)?.errMsg || (error as Error).message || ''
      if (!message.includes('cancel')) Taro.showToast({ title: message || '图片上传失败', icon: 'none' })
    } finally { Taro.hideLoading(); setInsertOpen(false) }
  }

  const insertMindMap = async () => {
    if (!documentRef.current) return
    try {
      Taro.showLoading({ title: '创建导图', mask: true })
      const rootId = `root-${Date.now()}`
      const map = await mindMapApi.create(documentRef.current.id, '未命名思维导图', { nodes: [{ id: rootId, type: 'root', position: { x: 80, y: 180 }, data: { label: '中心主题' } }], edges: [], layoutStyle: 'right' })
      const block: DocumentBlock = { id: `${Date.now()}-map`, type: 'mindMapBlock', mapId: map.id, title: map.title, nodeCount: 1, previewLabels: ['中心主题'] }
      setBlocks(current => { const index = Math.max(-1, current.findIndex(item => item.id === activeBlockId)); return [...current.slice(0, index + 1), block, ...current.slice(index + 1)] })
      setActiveBlockId(block.id)
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { Taro.hideLoading(); setInsertOpen(false) }
  }

  const openMap = (block: DocumentBlock) => Taro.navigateTo({ url: `/pages/mindmap/index?id=${documentRef.current?.id}&mapId=${block.mapId || ''}` })
  const activeBlock = blocks.find(block => block.id === activeBlockId)

  const openBlockActions = async () => {
    if (!activeBlock) return
    try {
      const result = await Taro.showActionSheet({ itemList: ['上移', '下移', '创建副本', '删除此段'] })
      if (result.tapIndex === 0) moveBlock(activeBlock.id, -1)
      if (result.tapIndex === 1) moveBlock(activeBlock.id, 1)
      if (result.tapIndex === 2) duplicateBlock(activeBlock)
      if (result.tapIndex === 3) removeBlock(activeBlock.id)
    } catch {}
  }

  if (!document) return <View className='loading-screen'><View className='loading-ring' /><Text>正在打开内容</Text></View>

  return <View className='document-page'>
    <View className='document-top'><View className='document-top__type'>文</View><Text className='document-top__status'>{status}</Text><View className='document-top__action' onClick={() => saveNow('manual')}>保存</View><View className='document-top__menu' onClick={() => Taro.showActionSheet({ itemList: ['编辑历史', '分享与发布', '删除文档'] }).then(async result => { if (result.tapIndex === 0) setPanel('history'); if (result.tapIndex === 1) setPanel('share'); if (result.tapIndex === 2) { const answer = await Taro.showModal({ title: '移到回收站', content: '确定删除当前文档吗？' }); if (answer.confirm) { await documentApi.remove(document.id); Taro.navigateBack() } } }).catch(() => {})}>•••</View></View>
    <ScrollView className='document-scroll' scrollY enhanced showScrollbar={false} onClick={() => { setActiveBlockId(''); setInsertOpen(false) }}>
      <View className='document-title-wrap' onClick={event => event.stopPropagation()}><Textarea className='document-title' autoHeight value={title} placeholder='无标题文档' maxlength={300} showConfirmBar={false} onFocus={() => setActiveBlockId('')} onInput={event => setTitle(event.detail.value)} /></View>
      <View className='block-list'>{blocks.map(block => {
        const active = activeBlockId === block.id
        const prefix = block.type === 'bulletList' ? '•' : block.type === 'orderedList' ? '1.' : block.type === 'taskList' ? '☐' : block.type === 'blockquote' ? '“' : ''
        return <View key={block.id} className={`doc-block doc-block--${block.type} ${active ? 'active' : ''}`} onClick={event => { event.stopPropagation(); setActiveBlockId(block.id) }}>
          {active && <View className='block-handle' onClick={openBlockActions}><Text>···</Text></View>}
          {block.type === 'horizontalRule' ? <View className='block-divider' /> : block.type === 'image' ? <ProtectedDocumentImage block={block} onAltChange={value => updateBlock(block.id, { alt: value })} /> : block.type === 'mindMapBlock' ? <View className='map-block' onClick={() => openMap(block)}><View className='map-block__icon'>导</View><View><Text>{block.title}</Text><Text>{block.nodeCount || 1} 个主题 · 点击进入编辑</Text></View><Text>›</Text></View> : <>
            {active && block.type === 'codeBlock' && <Picker mode='selector' range={LANGUAGES} value={Math.max(0, LANGUAGES.indexOf(block.language || 'plaintext'))} onChange={event => updateBlock(block.id, { language: LANGUAGES[Number(event.detail.value)] })}><View className='code-language'>{block.language || 'plaintext'}⌄</View></Picker>}
            <View className='block-content-row'>{prefix && <Text className='block-prefix'>{prefix}</Text>}<Textarea className={`block-editor block-editor--h${block.level || 2}`} style={{ color: block.color || undefined, fontWeight: block.bold ? '700' : undefined, fontStyle: block.italic ? 'italic' : undefined, textDecoration: block.underline ? 'underline' : undefined }} autoHeight maxlength={-1} value={block.text} placeholder={block.type === 'link' ? '链接显示文字' : block.type === 'codeBlock' ? '输入代码…' : '输入内容…'} showConfirmBar={false} onFocus={() => setActiveBlockId(block.id)} onInput={event => updateBlock(block.id, { text: event.detail.value })} /></View>
            {block.type === 'link' && <Input className='link-url' type='text' value={block.url} placeholder='https://example.com' onInput={event => updateBlock(block.id, { url: event.detail.value })} />}
            {active && block.type === 'taskList' && <View className='task-setting'><Switch checked={(block.checkedLines || []).every(Boolean)} color='#6388d5' onChange={event => updateBlock(block.id, { checkedLines: (block.text || '').split('\n').map(() => event.detail.value) })} /><Text>全部完成</Text></View>}
          </>}
        </View>
      })}</View>
      <View className='document-bottom-space' />
    </ScrollView>
    {!keyboardOpen && !insertOpen && !activeBlock && <View className='floating-insert' onClick={() => setInsertOpen(true)}><View className='floating-insert__plus'>＋</View><Text>插入内容</Text></View>}
    {activeBlock && !insertOpen && <View className={`editor-dock ${keyboardOpen ? 'keyboard-open' : ''}`} onClick={event => event.stopPropagation()}>
      {formatOpen && <ScrollView className='format-strip' scrollX showScrollbar={false}><View className='format-strip__inner'><View onClick={() => changeBlockType(activeBlock.id, 'paragraph')}>正文</View>{[1,2,3].map(level => <View key={level} onClick={() => changeBlockType(activeBlock.id, 'heading', level)}>H{level}</View>)}<View onClick={() => changeBlockType(activeBlock.id, 'taskList')}>待办</View><View onClick={() => changeBlockType(activeBlock.id, 'orderedList')}>编号</View><View onClick={() => changeBlockType(activeBlock.id, 'bulletList')}>列表</View><View onClick={() => changeBlockType(activeBlock.id, 'codeBlock')}>代码</View></View></ScrollView>}
      <ScrollView className='editor-dock__scroll' scrollX showScrollbar={false}><View className='editor-dock__inner'><View className='primary' onClick={() => setInsertOpen(true)}>插入</View><View className={formatOpen ? 'on' : ''} onClick={() => setFormatOpen(!formatOpen)}>样式</View><View className={activeBlock.bold ? 'on strong' : 'strong'} onClick={() => updateBlock(activeBlock.id, { bold: !activeBlock.bold })}>B</View><View className={activeBlock.italic ? 'on italic' : 'italic'} onClick={() => updateBlock(activeBlock.id, { italic: !activeBlock.italic })}>I</View><View className={activeBlock.underline ? 'on underline' : 'underline'} onClick={() => updateBlock(activeBlock.id, { underline: !activeBlock.underline })}>U</View><Picker mode='selector' range={COLORS} value={Math.max(0, COLORS.indexOf(activeBlock.color || COLORS[0]))} onChange={event => updateBlock(activeBlock.id, { color: COLORS[Number(event.detail.value)] })}><View className='color-tool'><Text style={{ background: activeBlock.color || COLORS[0] }} /></View></Picker><View onClick={() => changeBlockType(activeBlock.id, 'bulletList')}>列表</View><View onClick={chooseImage}>图片</View><View onClick={() => changeBlockType(activeBlock.id, 'taskList')}>待办</View><View onClick={openBlockActions}>更多</View>{keyboardOpen && <View onClick={() => Taro.hideKeyboard()}>收起</View>}</View></ScrollView>
    </View>}
    {insertOpen && <View className='insert-mask' onClick={() => setInsertOpen(false)} />}
    {insertOpen && <View className='insert-sheet'><View className='insert-sheet__head'><Text>插入内容</Text><View onClick={() => setInsertOpen(false)}>×</View></View><View className='insert-grid'>{INSERT_TYPES.map(item => <View key={item.type} onClick={() => insertBlock(item.type)}><Text>{item.label.slice(0, 1)}</Text><Text>{item.label}</Text></View>)}<View onClick={chooseImage}><Text>图</Text><Text>图片</Text></View><View onClick={insertMindMap}><Text>导</Text><Text>思维导图</Text></View></View></View>}
    {panel && <DocumentPanels document={document} mode={panel} onClose={() => setPanel(null)} onDocumentChange={hydrate} />}
  </View>
}
