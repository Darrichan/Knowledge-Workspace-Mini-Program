import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useLoad, useRouter } from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import DocumentPanels from '../../components/DocumentPanels'
import { documentApi, mindMapApi } from '../../services/api'
import type { DocumentItem, MindMapItem, MindMapNode, MindMapVersion } from '../../types/domain'
import './index.scss'

const COLORS = ['#e56b63', '#de9838', '#77a44d', '#48a082', '#4e83df', '#8269d2', '#cf6896']
const MARKERS = ['!', '?', '★', '✓', '⚑', '●']
const nodeLabel = (node: any) => String(node?.data?.label || node?.label || '新主题')

function documentNodes(content?: Record<string, any>) {
  return Array.isArray(content?.nodes) ? content.nodes.map((node: any) => ({ ...node, parent_id: node.parent_id || null })) : []
}

function graphToState(graph: Record<string, any>, fallback: string) {
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const root = graphNodes.find((node: any) => node.type === 'root' || node.data?.type === 'root') || graphNodes[0]
  const rootId = root?.id || `root-${Date.now()}`
  const parents: Record<string, string> = {}
  ;(graph?.edges || []).forEach((edge: any) => { parents[String(edge.target)] = String(edge.source) })
  const nodes: MindMapNode[] = graphNodes.filter((node: any) => node.id !== rootId).map((node: any, index: number) => ({ id: String(node.id), label: nodeLabel(node), color: node.data?.color || COLORS[index % COLORS.length], parent_id: node.data?.parent_id || parents[String(node.id)] || rootId, priority: node.data?.priority ?? null, marker: node.data?.marker ?? null, fontSize: Number(node.data?.fontSize) || 28 }))
  return { rootId, rootLabel: root ? nodeLabel(root) : fallback, nodes }
}

function stateToGraph(rootId: string, rootLabel: string, nodes: MindMapNode[]) {
  const depthOf = (node: MindMapNode): number => { const parent = nodes.find(item => item.id === node.parent_id); return parent ? 1 + depthOf(parent) : 1 }
  const positioned = nodes.map((node, index) => ({ id: node.id, type: 'topic', position: { x: 380 + depthOf(node) * 280, y: 100 + index * 100 }, data: { label: node.label, color: node.color, parent_id: node.parent_id || rootId, priority: node.priority, marker: node.marker, fontSize: node.fontSize || 28 } }))
  return { nodes: [{ id: rootId, type: 'root', position: { x: 70, y: 220 }, data: { label: rootLabel, type: 'root' } }, ...positioned], edges: nodes.map(node => ({ id: `${node.parent_id || rootId}-${node.id}`, source: node.parent_id || rootId, target: node.id })), layoutStyle: 'right' }
}

export default function MindMapPage() {
  const router = useRouter(); const id = router.params.id || ''; const mapId = router.params.mapId || ''
  const [document, setDocument] = useState<DocumentItem | null>(null); const [map, setMap] = useState<MindMapItem | null>(null)
  const [rootId, setRootId] = useState('root'); const [rootLabel, setRootLabel] = useState(''); const [nodes, setNodes] = useState<MindMapNode[]>([])
  const [selectedId, setSelectedId] = useState('root'); const [status, setStatus] = useState('正在加载'); const [historyOpen, setHistoryOpen] = useState(false); const [documentPanel, setDocumentPanel] = useState(false); const [versions, setVersions] = useState<MindMapVersion[]>([])
  const [zoom, setZoom] = useState(.72)
  const hydrated = useRef(false); const saving = useRef(false); const queued = useRef(false); const versionRef = useRef(1); const documentRef = useRef<DocumentItem | null>(null); const mapRef = useRef<MindMapItem | null>(null); const rootRef = useRef(''); const nodesRef = useRef<MindMapNode[]>([])
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null); const zoomTouchedRef = useRef(false)
  const hydrateDocument = (result: DocumentItem) => { setDocument(result); documentRef.current = result; setRootId('root'); setRootLabel(String(result.content?.root || result.title)); const next = documentNodes(result.content); setNodes(next); rootRef.current = String(result.content?.root || result.title); nodesRef.current = next; versionRef.current = result.version; setStatus(`版本 ${result.version}`) }
  const hydrateMap = (item: MindMapItem) => { setMap(item); mapRef.current = item; const state = graphToState(item.graph, item.title); setRootId(state.rootId); setRootLabel(state.rootLabel); setNodes(state.nodes); rootRef.current = state.rootLabel; nodesRef.current = state.nodes; versionRef.current = item.version; setStatus(`导图版本 ${item.version}`) }
  useLoad(async () => { if (!id) return; try { const doc = await documentApi.get(id); setDocument(doc); documentRef.current = doc; if (mapId) hydrateMap(await mindMapApi.get(id, mapId)); else hydrateDocument(doc); setTimeout(() => { hydrated.current = true }, 0) } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) } })
  const saveNow = async (reason = 'interval') => {
    if (saving.current) { queued.current = true; return } saving.current = true; queued.current = false; const snapshotRoot = rootRef.current; const snapshotNodes = nodesRef.current
    try { setStatus('保存中…'); if (mapId && mapRef.current) { const updated = await mindMapApi.update(id, mapId, { ...mapRef.current, title: snapshotRoot || '未命名思维导图', graph: stateToGraph(rootId, snapshotRoot, snapshotNodes), version: versionRef.current }, reason); hydrateMap(updated) } else if (documentRef.current) { const updated = await documentApi.update(id, versionRef.current, snapshotRoot || '无标题思维导图', { type: 'mindmap', root: snapshotRoot, nodes: snapshotNodes }, reason); hydrateDocument(updated) } }
    catch (error) { setStatus('保存失败'); Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { saving.current = false; if (queued.current || snapshotRoot !== rootRef.current || snapshotNodes !== nodesRef.current) setTimeout(() => saveNow(), 0) }
  }
  useEffect(() => { rootRef.current = rootLabel; nodesRef.current = nodes; if (!hydrated.current) return; setStatus('有未保存更改'); const timer = setTimeout(() => saveNow(), 1000); return () => clearTimeout(timer) }, [rootLabel, nodes])
  const selected = nodes.find(node => node.id === selectedId)
  const depth = (node: MindMapNode): number => { const parent = nodes.find(item => item.id === node.parent_id); return parent ? 1 + depth(parent) : 1 }
  const ordered = useMemo(() => { const output: MindMapNode[] = []; const append = (parentId: string) => nodes.filter(node => (node.parent_id || rootId) === parentId).forEach(node => { output.push(node); append(node.id) }); append(rootId); return output }, [nodes, rootId])
  const maxDepth = useMemo(() => Math.max(1, ...nodes.map(node => depth(node))), [nodes, rootId])
  const boardWidth = Math.max(1450, 690 + maxDepth * 395)
  const boardHeight = Math.max(1050, 320 + ordered.length * 105)
  const clampZoom = (value: number) => Math.min(1.8, Math.max(.38, Math.round(value * 100) / 100))
  const applyZoom = (value: number) => { zoomTouchedRef.current = true; setZoom(clampZoom(value)) }
  const fitToContent = () => {
    const window = Taro.getWindowInfo()
    const availableWidth = Math.max(320, window.windowWidth - 20)
    const availableHeight = Math.max(480, window.windowHeight - 190)
    applyZoom(Math.min(1, availableWidth / boardWidth, availableHeight / boardHeight))
  }
  const touchDistance = (touches: any[]) => {
    if (touches.length < 2) return 0
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  }
  const onCanvasTouchStart = (event: any) => {
    if (event.touches?.length === 2) pinchRef.current = { distance: touchDistance(event.touches), zoom }
  }
  const onCanvasTouchMove = (event: any) => {
    if (event.touches?.length !== 2 || !pinchRef.current) return
    const distance = touchDistance(event.touches)
    if (distance > 0 && pinchRef.current.distance > 0) applyZoom(pinchRef.current.zoom * distance / pinchRef.current.distance)
  }
  const onCanvasTouchEnd = () => { pinchRef.current = null }
  useEffect(() => {
    if (!document || zoomTouchedRef.current) return
    const timer = setTimeout(fitToContent, 80)
    return () => clearTimeout(timer)
  }, [document, nodes.length])
  const addNode = (asChild: boolean) => { const parent = asChild ? selectedId : selected?.parent_id || rootId; const node: MindMapNode = { id: `${Date.now()}`, label: '新主题', color: selected?.color || COLORS[nodes.length % COLORS.length], parent_id: parent, fontSize: 28 }; setNodes(current => [...current, node]); setSelectedId(node.id) }
  const updateNode = (nodeId: string, patch: Partial<MindMapNode>) => setNodes(current => current.map(node => node.id === nodeId ? { ...node, ...patch } : node))
  const deleteSelected = async () => { if (selectedId === rootId || selectedId === 'root') return Taro.showToast({ title: '中心主题不能删除', icon: 'none' }); const answer = await Taro.showModal({ title: '删除主题', content: '子主题也会一起删除。' }); if (!answer.confirm) return; const ids = new Set([selectedId]); let changed = true; while (changed) { changed = false; nodes.forEach(node => { if (node.parent_id && ids.has(node.parent_id) && !ids.has(node.id)) { ids.add(node.id); changed = true } }) } setNodes(current => current.filter(node => !ids.has(node.id))); setSelectedId(rootId) }
  const openHistory = async () => { if (mapId) { try { setVersions(await mindMapApi.versions(id, mapId)); setHistoryOpen(true) } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) } } else setDocumentPanel(true) }
  const restoreMap = async (version: MindMapVersion) => { const answer = await Taro.showModal({ title: `恢复导图版本 ${version.version}`, content: '恢复会创建新版本，当前版本仍保留。' }); if (answer.confirm) { hydrateMap(await mindMapApi.restoreVersion(id, mapId, version.id)); setVersions(await mindMapApi.versions(id, mapId)) } }
  if (!document) return <View className='loading-screen'><View className='loading-ring' /><Text>正在打开导图</Text></View>
  return <View className='mind-page'><View className='mind-toolbar'><Text className='mind-toolbar__status'>{status}</Text><ScrollView className='mind-toolbar__actions' scrollX showScrollbar={false}><View className='mind-toolbar__actions-inner'><View onClick={() => addNode(false)}>＋ 同级</View><View onClick={() => addNode(true)}>＋ 子主题</View><View onClick={openHistory}>历史</View><View className='danger' onClick={deleteSelected}>删除</View></View></ScrollView></View>
    <ScrollView className='mind-canvas' scrollX scrollY enhanced showScrollbar={false} onTouchStart={onCanvasTouchStart} onTouchMove={onCanvasTouchMove} onTouchEnd={onCanvasTouchEnd} onTouchCancel={onCanvasTouchEnd}><View className='mind-stage' style={{ width: `${boardWidth * zoom}px`, height: `${boardHeight * zoom}px` }}><View className='mind-board' style={{ width: `${boardWidth}px`, minHeight: `${boardHeight}px`, transform: `scale(${zoom})` }}><View className={`root-node ${selectedId === rootId ? 'selected' : ''}`} onClick={() => setSelectedId(rootId)}><Input value={rootLabel} onFocus={() => setSelectedId(rootId)} onInput={event => setRootLabel(event.detail.value)} /></View><View className='mind-trunk' /><View className='branch-stack'>{ordered.map(node => <View className='branch-row' key={node.id} style={{ marginLeft: `${Math.max(0, depth(node) - 1) * 115}px` }}><View className='branch-line' style={{ borderColor: node.color }} /><View className={`branch-node ${selectedId === node.id ? 'selected' : ''}`} style={{ borderBottomColor: node.color }} onClick={() => setSelectedId(node.id)}>{node.priority ? <Text className='node-priority' style={{ background: COLORS[(node.priority - 1) % COLORS.length] }}>{node.priority}</Text> : null}{node.marker ? <Text className='node-marker'>{node.marker}</Text> : null}<Input value={node.label} style={{ fontSize: `${node.fontSize || 28}px` }} onFocus={() => setSelectedId(node.id)} onInput={event => updateNode(node.id, { label: event.detail.value })} /></View></View>)}{!nodes.length && <View className='empty-branch' onClick={() => addNode(true)}><Text>＋</Text><Text>添加第一个分支</Text></View>}</View></View></View></ScrollView>
    <View className='zoom-controls'><View onClick={() => applyZoom(zoom - .1)}>缩小</View><Text>{Math.round(zoom * 100)}%</Text><View onClick={() => applyZoom(zoom + .1)}>放大</View><View onClick={fitToContent}>适配</View></View>
    {selected && <ScrollView className='node-stylebar' scrollX showScrollbar={false}><View className='node-stylebar__inner'><Text>样式</Text>{COLORS.map(color => <View key={color} className='style-color' style={{ background: color }} onClick={() => updateNode(selected.id, { color })} />)}<View onClick={() => updateNode(selected.id, { fontSize: Math.max(18, (selected.fontSize || 28) - 2) })}>A−</View><View onClick={() => updateNode(selected.id, { fontSize: Math.min(52, (selected.fontSize || 28) + 2) })}>A＋</View>{[1,2,3,4,5,6,7].map(priority => <View key={priority} className='priority-choice' onClick={() => updateNode(selected.id, { priority })}>{priority}</View>)}{MARKERS.map(marker => <View key={marker} onClick={() => updateNode(selected.id, { marker })}>{marker}</View>)}<View onClick={() => updateNode(selected.id, { priority: null, marker: null })}>清除</View></View></ScrollView>}
    {historyOpen && <View className='map-history-mask' onClick={() => setHistoryOpen(false)}><View className='map-history' onClick={event => event.stopPropagation()}><View className='map-history__head'><Text>导图编辑历史</Text><View onClick={() => setHistoryOpen(false)}>×</View></View><ScrollView scrollY>{versions.map(version => <View className='map-history__row' key={version.id}><View><Text>版本 {version.version}</Text><Text>{version.actor_name || '成员'} · {new Date(version.created_at).toLocaleString()}</Text></View><View onClick={() => restoreMap(version)}>恢复</View><View className='danger' onClick={async () => { await mindMapApi.deleteVersion(id, mapId, version.id); setVersions(await mindMapApi.versions(id, mapId)) }}>删除</View></View>)}</ScrollView></View></View>}
    {documentPanel && <DocumentPanels document={document} mode='history' onClose={() => setDocumentPanel(false)} onDocumentChange={hydrateDocument} />}
  </View>
}
