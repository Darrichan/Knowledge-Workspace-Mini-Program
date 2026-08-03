import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import ContentCard from '../../components/ContentCard'
import { authApi, workspaceApi } from '../../services/api'
import { chooseAndCreate } from '../../services/content'
import { openDocument } from '../../services/navigation'
import type { DocumentItem, Workspace } from '../../types/domain'
import './index.scss'

export default function SpacePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [folderTrail, setFolderTrail] = useState<DocumentItem[]>([])

  const load = async () => {
    if (!authApi.hasToken()) return Taro.reLaunch({ url: '/pages/login/index' })
    try {
      let current = Taro.getStorageSync<Workspace>('kw_mini_workspace')
      if (!current?.id) {
        const spaces = await workspaceApi.list()
        current = spaces[0] || await workspaceApi.create('我的空间')
        Taro.setStorageSync('kw_mini_workspace', current)
      }
      setWorkspace(current)
      const nextDocuments = await workspaceApi.documents(current.id)
      setDocuments(nextDocuments)
      const targetFolderId = Taro.getStorageSync<string>('kw_mini_open_folder')
      if (targetFolderId) {
        const trail: DocumentItem[] = []
        let cursor = nextDocuments.find(item => item.id === targetFolderId && item.type === 'folder')
        while (cursor) { trail.unshift(cursor); cursor = cursor.parent_id ? nextDocuments.find(item => item.id === cursor?.parent_id && item.type === 'folder') : undefined }
        setFolderTrail(trail)
        Taro.removeStorageSync('kw_mini_open_folder')
      }
    } catch (error) {
      Taro.showToast({ title: (error as Error).message, icon: 'none' })
    } finally {
      setLoading(false)
      Taro.stopPullDownRefresh()
    }
  }

  useDidShow(load)
  usePullDownRefresh(load)
  const currentFolder = folderTrail[folderTrail.length - 1] || null
  const filtered = useMemo(() => documents.filter(item => item.parent_id === (currentFolder?.id || null) && item.title.toLowerCase().includes(query.toLowerCase())), [documents, query, currentFolder?.id])
  const openItem = (item: DocumentItem) => {
    if (item.type === 'folder') {
      setFolderTrail(current => [...current, item])
      setQuery('')
    } else openDocument(item)
  }
  const goBackFolder = () => { setFolderTrail(current => current.slice(0, -1)); setQuery('') }

  return (
    <View className='page-shell safe-page space-page'>
      <View className='space-heading'><View><Text className='space-heading__eyebrow'>MY SPACE</Text><Text className='space-heading__title'>{currentFolder?.title || workspace?.name || '我的空间'}</Text><Text className='space-heading__copy'>{filtered.length} 个内容节点</Text></View><View className='space-heading__add' hoverClass='space-heading__add--pressed' onClick={() => workspace && chooseAndCreate(workspace.id, load, currentFolder?.id || null)}>＋</View></View>
      {folderTrail.length > 0 && <View className='folder-breadcrumb'><View onClick={goBackFolder}>‹ 返回上一级</View><ScrollView scrollX showScrollbar={false}><Text>我的空间</Text>{folderTrail.map(folder => <Text key={folder.id}> / {folder.title}</Text>)}</ScrollView></View>}
      <View className='search-box'><Text>⌕</Text><Input placeholder='搜索标题' value={query} onInput={event => setQuery(event.detail.value)} /><Text className='search-box__count'>{filtered.length}</Text></View>
      <View className='filter-row'><View className='filter-chip active'>全部</View><View className='filter-chip'>最近更新</View><View className='filter-chip'>我的创建</View></View>
      {loading ? <View className='loading-screen'><View className='loading-ring' /><Text>正在加载</Text></View> : <View className='space-list'>{filtered.map(item => <ContentCard key={item.id} item={item} onClick={openItem} />)}{!filtered.length && <View className='space-empty'>{query ? '没有匹配的内容' : '当前文件夹还没有内容'}</View>}</View>}
      <View className='floating-create' onClick={() => workspace && chooseAndCreate(workspace.id, load, currentFolder?.id || null)}>＋<Text>新建</Text></View>
    </View>
  )
}
