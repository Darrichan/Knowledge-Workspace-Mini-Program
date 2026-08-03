import { Input, Picker, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { contentToText, documentApi } from '../services/api'
import type { DocumentItem, DocumentShare, DocumentVersion } from '../types/domain'
import './DocumentPanels.scss'

type Props = {
  document: DocumentItem
  mode: 'history' | 'share'
  onClose: () => void
  onDocumentChange: (document: DocumentItem) => void
}

const formatDate = (value: string) => {
  const date = new Date(value)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function DocumentPanels({ document, mode, onClose, onDocumentChange }: Props) {
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [shares, setShares] = useState<DocumentShare[]>([])
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null)
  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState<'viewer' | 'editor'>('viewer')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const load = async () => {
    try {
      if (mode === 'history') {
        const result = await documentApi.versions(document.id)
        setVersions(result)
        setSelectedVersion(result[0] || null)
      } else setShares(await documentApi.shares(document.id))
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [mode, document.id])

  const restore = async (version: DocumentVersion) => {
    const answer = await Taro.showModal({ title: `恢复版本 ${version.version}`, content: '恢复会创建一个新版本，当前版本不会被删除。' })
    if (!answer.confirm) return
    try {
      setBusy(version.id)
      const updated = await documentApi.restoreVersion(document.id, version.id)
      onDocumentChange(updated)
      Taro.showToast({ title: '已恢复为新版本', icon: 'success' })
      await load()
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setBusy('') }
  }

  const removeVersion = async (version: DocumentVersion) => {
    const answer = await Taro.showModal({ title: `删除版本 ${version.version}`, content: '删除后无法恢复，确定继续吗？' })
    if (!answer.confirm) return
    try {
      setBusy(version.id)
      await documentApi.deleteVersion(document.id, version.id)
      await load()
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setBusy('') }
  }

  const addShare = async () => {
    if (!email.trim()) return Taro.showToast({ title: '请输入协作者邮箱', icon: 'none' })
    try {
      setBusy('share')
      await documentApi.share(document.id, email.trim(), permission)
      setEmail('')
      await load()
      Taro.showToast({ title: '已添加协作者', icon: 'success' })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setBusy('') }
  }

  const changeShare = async (share: DocumentShare) => {
    try {
      setBusy(share.id)
      await documentApi.updateShare(document.id, share.id, share.permission === 'viewer' ? 'editor' : 'viewer')
      await load()
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setBusy('') }
  }

  const removeShare = async (share: DocumentShare) => {
    const answer = await Taro.showModal({ title: '移除协作者', content: `确定移除 ${share.display_name || share.email} 吗？` })
    if (!answer.confirm) return
    try {
      setBusy(share.id)
      await documentApi.deleteShare(document.id, share.id)
      await load()
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setBusy('') }
  }

  const togglePublish = async () => {
    try {
      setBusy('publish')
      const updated = document.published_at ? await documentApi.unpublish(document.id) : await documentApi.publish(document.id)
      onDocumentChange(updated)
      Taro.showToast({ title: updated.published_at ? '已发布' : '已取消发布', icon: 'success' })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setBusy('') }
  }

  return <View className='panel-mask' onClick={onClose}>
    <View className='document-panel' onClick={event => event.stopPropagation()}>
      <View className='document-panel__header'><View><Text>{mode === 'history' ? '编辑历史' : '分享与发布'}</Text><Text>{mode === 'history' ? '恢复旧版本不会覆盖后续历史' : '管理协作者的查看和编辑权限'}</Text></View><View onClick={onClose}>×</View></View>
      {loading ? <View className='panel-loading'>正在加载…</View> : mode === 'history' ? <View className='history-layout'>
        <ScrollView className='history-list' scrollY>{versions.map(version => <View key={version.id} className={`history-item ${selectedVersion?.id === version.id ? 'active' : ''}`} onClick={() => setSelectedVersion(version)}><Text>版本 {version.version}</Text><Text>{version.actor_name || '成员'} · {formatDate(version.created_at)}</Text></View>)}{!versions.length && <View className='panel-empty'>暂无历史版本</View>}</ScrollView>
        {selectedVersion && <ScrollView className='history-preview' scrollY><Text className='history-preview__title'>{selectedVersion.title}</Text><Text className='history-preview__meta'>{selectedVersion.actor_name || '成员'} 于 {formatDate(selectedVersion.created_at)} 编辑</Text><Text className='history-preview__body'>{contentToText(selectedVersion.content) || '该版本没有正文内容'}</Text><View className='panel-actions'><View onClick={() => restore(selectedVersion)}>{busy === selectedVersion.id ? '处理中…' : '恢复为新版本'}</View><View className='danger' onClick={() => removeVersion(selectedVersion)}>删除此版本</View></View></ScrollView>}
      </View> : <ScrollView className='share-body' scrollY>
        <View className='publish-card'><View><Text>{document.published_at ? '已公开发布' : '当前为私有内容'}</Text><Text>{document.published_at ? '可通过公开主页访问' : '只有空间成员和协作者可访问'}</Text></View><View className={document.published_at ? 'on' : ''} onClick={togglePublish}>{busy === 'publish' ? '…' : document.published_at ? '关闭' : '发布'}</View></View>
        <View className='share-form'><Input value={email} type='text' placeholder='协作者邮箱' onInput={event => setEmail(event.detail.value)} /><Picker mode='selector' range={['可查看', '可编辑']} value={permission === 'viewer' ? 0 : 1} onChange={event => setPermission(Number(event.detail.value) === 1 ? 'editor' : 'viewer')}><View className='permission-picker'>{permission === 'viewer' ? '可查看' : '可编辑'}</View></Picker><View className='share-submit' onClick={addShare}>{busy === 'share' ? '添加中…' : '添加'}</View></View>
        <Text className='share-heading'>协作者 · {shares.length}</Text>
        {shares.map(share => <View className='share-row' key={share.id}><View className='share-avatar'>{(share.display_name || share.email).slice(0, 1).toUpperCase()}</View><View className='share-person'><Text>{share.display_name}</Text><Text>{share.email}</Text></View><View className='share-permission' onClick={() => changeShare(share)}>{busy === share.id ? '…' : share.permission === 'viewer' ? '可查看' : '可编辑'}</View><View className='share-remove' onClick={() => removeShare(share)}>×</View></View>)}
      </ScrollView>}
    </View>
  </View>
}
