import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import Brand from '../../components/Brand'
import ContentCard from '../../components/ContentCard'
import { authApi, workspaceApi } from '../../services/api'
import { chooseAndCreate } from '../../services/content'
import { openDocument } from '../../services/navigation'
import type { DocumentItem, User, Workspace } from '../../types/domain'
import './index.scss'

export default function HomePage() {
  const [loading, setLoading] = useState(true)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [recent, setRecent] = useState<DocumentItem[]>([])
  const user = Taro.getStorageSync<User>('kw_mini_user')

  const load = async () => {
    if (!authApi.hasToken()) return Taro.reLaunch({ url: '/pages/login/index' })
    setLoading(true)
    try {
      let spaces = await workspaceApi.list()
      if (!spaces.length) spaces = [await workspaceApi.create('我的空间')]
      setWorkspace(spaces[0])
      Taro.setStorageSync('kw_mini_workspace', spaces[0])
      setRecent(await workspaceApi.recent())
    } catch (error) {
      Taro.showToast({ title: (error as Error).message, icon: 'none' })
    } finally { setLoading(false) }
  }

  useDidShow(load)

  if (loading) return <View className='loading-screen'><View className='loading-ring' /><Text>正在同步知识空间</Text></View>

  return (
    <View className='page-shell safe-page home-page'>
      <View className='home-page__header'>
        <Brand compact />
        <View className='avatar'>{(user?.display_name || '知').slice(0, 1)}</View>
      </View>
      <View className='hero-card'>
        <Text className='hero-card__eyebrow'>PRIVATE KNOWLEDGE NODE</Text>
        <Text className='hero-card__title'>你好，{user?.display_name || '创作者'}</Text>
        <Text className='hero-card__copy'>把灵感、文档与复杂思路，沉淀成随时可继续的知识。</Text>
        <View className='hero-card__actions'>
          <View className='hero-card__primary' hoverClass='hero-card__pressed' onClick={() => workspace && chooseAndCreate(workspace.id, load)}>＋ 新建内容</View>
          <View className='hero-card__secondary' onClick={() => Taro.switchTab({ url: '/pages/space/index' })}>浏览空间</View>
        </View>
      </View>
      <View className='quick-grid'>
        <View className='quick-card' onClick={() => workspace && chooseAndCreate(workspace.id, load)}><Text className='quick-card__icon'>文</Text><Text className='quick-card__title'>快速创建</Text><Text className='quick-card__copy'>文档、导图、表格</Text></View>
        <View className='quick-card quick-card--mint' onClick={() => Taro.switchTab({ url: '/pages/shared/index' })}><Text className='quick-card__icon'>享</Text><Text className='quick-card__title'>与我共享</Text><Text className='quick-card__copy'>查看协作内容</Text></View>
      </View>
      <View className='section-title'><View className='title-copy'><Text className='title'>最近打开</Text><Text className='subtitle'>{recent.length ? `${recent.length} 项内容` : '暂无最近内容'}</Text></View><Text className='action' onClick={() => Taro.switchTab({ url: '/pages/space/index' })}>全部</Text></View>
      <View className='recent-list'>
        {recent.length ? recent.slice(0, 6).map(item => <ContentCard key={item.id} item={item} onClick={openDocument} />) : <View className='empty-card'><Text className='empty-card__icon'>✦</Text><Text className='empty-card__title'>从第一份内容开始</Text><Text className='empty-card__copy'>创建内容后会在这里快速继续</Text></View>}
      </View>
    </View>
  )
}
