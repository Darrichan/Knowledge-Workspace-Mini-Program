import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import ContentCard from '../../components/ContentCard'
import { authApi, workspaceApi } from '../../services/api'
import { openDocument } from '../../services/navigation'
import type { DocumentItem } from '../../types/domain'
import './index.scss'

export default function SharedPage() {
  const [items, setItems] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  useDidShow(async () => {
    if (!authApi.hasToken()) return Taro.reLaunch({ url: '/pages/login/index' })
    try { setItems(await workspaceApi.shared()) }
    catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setLoading(false) }
  })
  return <View className='page-shell safe-page shared-page'><View className='shared-heading'><Text className='shared-heading__label'>COLLABORATION</Text><Text className='shared-heading__title'>与我共享</Text><Text className='shared-heading__copy'>他人邀请你参与的知识内容</Text></View>{loading ? <View className='loading-screen'><View className='loading-ring' /></View> : <View className='shared-list'>{items.map(item => <ContentCard key={item.id} item={item} onClick={openDocument} />)}{!items.length && <View className='shared-empty'><View className='shared-empty__orb'>享</View><Text className='shared-empty__title'>暂时没有共享内容</Text><Text className='shared-empty__copy'>桌面端邀请协作者后，内容会同步出现在这里</Text></View>}</View>}</View>
}
