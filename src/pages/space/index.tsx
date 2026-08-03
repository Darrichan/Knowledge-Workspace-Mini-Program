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
      setDocuments(await workspaceApi.documents(current.id))
    } catch (error) {
      Taro.showToast({ title: (error as Error).message, icon: 'none' })
    } finally {
      setLoading(false)
      Taro.stopPullDownRefresh()
    }
  }

  useDidShow(load)
  usePullDownRefresh(load)
  const filtered = useMemo(() => documents.filter(item => item.title.toLowerCase().includes(query.toLowerCase())), [documents, query])

  return (
    <View className='page-shell safe-page space-page'>
      <View className='space-heading'><View><Text className='space-heading__eyebrow'>MY SPACE</Text><Text className='space-heading__title'>{workspace?.name || '我的空间'}</Text><Text className='space-heading__copy'>{documents.length} 个内容节点</Text></View><View className='space-heading__add' hoverClass='space-heading__add--pressed' onClick={() => workspace && chooseAndCreate(workspace.id, load)}>＋</View></View>
      <View className='search-box'><Text>⌕</Text><Input placeholder='搜索标题' value={query} onInput={event => setQuery(event.detail.value)} /><Text className='search-box__count'>{filtered.length}</Text></View>
      <View className='filter-row'><View className='filter-chip active'>全部</View><View className='filter-chip'>最近更新</View><View className='filter-chip'>我的创建</View></View>
      {loading ? <View className='loading-screen'><View className='loading-ring' /><Text>正在加载</Text></View> : <View className='space-list'>{filtered.map(item => <ContentCard key={item.id} item={item} onClick={openDocument} />)}{!filtered.length && <View className='space-empty'>没有匹配的内容</View>}</View>}
      <View className='floating-create' onClick={() => workspace && chooseAndCreate(workspace.id, load)}>＋<Text>新建</Text></View>
    </View>
  )
}
