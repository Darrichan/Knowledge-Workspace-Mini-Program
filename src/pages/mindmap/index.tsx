import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useLoad, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { documentApi } from '../../services/api'
import type { DocumentItem, MindMapNode } from '../../types/domain'
import './index.scss'

const COLORS = ['#e46b64', '#dd9b3f', '#67a764', '#4f83df', '#8a69d1', '#d66f9b']

function initialNodes(content: Record<string, any> | undefined): MindMapNode[] {
  if (Array.isArray(content?.nodes)) return content.nodes
  return []
}

export default function MindMapPage() {
  const id = useRouter().params.id || ''
  const [doc, setDoc] = useState<DocumentItem | null>(null)
  const [rootLabel, setRootLabel] = useState('')
  const [nodes, setNodes] = useState<MindMapNode[]>([])
  const [selectedId, setSelectedId] = useState('root')
  const [status, setStatus] = useState('正在加载')
  const hydrated = useRef(false)

  useLoad(async () => {
    if (!id) return
    try {
      const result = await documentApi.get(id)
      setDoc(result)
      setRootLabel((result.content?.root as string) || result.title)
      setNodes(initialNodes(result.content))
      setStatus(`版本 ${result.version}`)
      setTimeout(() => { hydrated.current = true }, 0)
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  })

  useEffect(() => {
    if (!hydrated.current || !doc) return
    setStatus('有未保存更改')
    const timer = setTimeout(async () => {
      try {
        setStatus('自动保存中…')
        const updated = await documentApi.update(doc.id, doc.version, rootLabel || '无标题思维导图', { type: 'mindmap', root: rootLabel, nodes })
        setDoc(updated)
        setStatus(`已自动保存 · 版本 ${updated.version}`)
      } catch (error) {
        setStatus('保存失败')
        Taro.showToast({ title: (error as Error).message, icon: 'none' })
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [rootLabel, nodes])

  const addNode = () => {
    const node: MindMapNode = { id: `${Date.now()}`, label: '新主题', color: COLORS[nodes.length % COLORS.length] }
    setNodes(current => [...current, node])
    setSelectedId(node.id)
  }
  const updateNode = (nodeId: string, label: string) => setNodes(current => current.map(node => node.id === nodeId ? { ...node, label } : node))
  const deleteSelected = () => {
    if (selectedId === 'root') return Taro.showToast({ title: '中心主题不能删除', icon: 'none' })
    setNodes(current => current.filter(node => node.id !== selectedId))
    setSelectedId('root')
  }

  if (!doc) return <View className='loading-screen'><View className='loading-ring' /><Text>正在打开导图</Text></View>

  return <View className='mind-page'><View className='mind-toolbar'><Text className='mind-toolbar__status'>{status}</Text><View className='mind-toolbar__actions'><View onClick={addNode}>＋ 分支</View><View onClick={deleteSelected}>删除</View></View></View><ScrollView className='mind-canvas' scrollX scrollY enhanced showScrollbar={false}><View className='mind-board'><View className={`root-node ${selectedId === 'root' ? 'selected' : ''}`} onClick={() => setSelectedId('root')}><Input value={rootLabel} onFocus={() => setSelectedId('root')} onInput={event => setRootLabel(event.detail.value)} /></View><View className='mind-trunk' /><View className='branch-stack'>{nodes.map((node, index) => <View className='branch-row' key={node.id}><View className='branch-line' style={{ borderColor: node.color }} /><View className={`branch-node ${selectedId === node.id ? 'selected' : ''}`} style={{ borderBottomColor: node.color }} onClick={() => setSelectedId(node.id)}><Input value={node.label} onFocus={() => setSelectedId(node.id)} onInput={event => updateNode(node.id, event.detail.value)} /></View><View className='branch-dot' style={{ background: node.color }} /></View>)}{!nodes.length && <View className='empty-branch' onClick={addNode}><Text>＋</Text><Text>添加第一个分支</Text></View>}</View></View></ScrollView><View className='mind-hint'>横向拖动画布 · 点击文字直接编辑 · 内容自动保存</View></View>
}
