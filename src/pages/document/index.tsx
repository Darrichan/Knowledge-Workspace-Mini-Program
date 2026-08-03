import { Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useLoad, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { contentToText, documentApi, textToContent } from '../../services/api'
import type { DocumentItem } from '../../types/domain'
import './index.scss'

export default function DocumentPage() {
  const router = useRouter()
  const id = router.params.id || ''
  const [document, setDocument] = useState<DocumentItem | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState('正在加载')
  const [toolsOpen, setToolsOpen] = useState(false)
  const hydrated = useRef(false)

  useLoad(async () => {
    if (!id) return Taro.showToast({ title: '缺少内容 ID', icon: 'none' })
    try {
      const result = await documentApi.get(id)
      setDocument(result)
      setTitle(result.title)
      setBody(contentToText(result.content))
      setStatus(`版本 ${result.version}`)
      setTimeout(() => { hydrated.current = true }, 0)
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  })

  useEffect(() => {
    if (!hydrated.current || !document) return
    setStatus('有未保存更改')
    const timer = setTimeout(async () => {
      try {
        setStatus('保存中…')
        const updated = await documentApi.update(document.id, document.version, title || '无标题文档', textToContent(body))
        setDocument(updated)
        setStatus(`已自动保存 · 版本 ${updated.version}`)
      } catch (error) {
        setStatus('保存失败')
        Taro.showToast({ title: (error as Error).message, icon: 'none' })
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [title, body])

  if (!document) return <View className='loading-screen'><View className='loading-ring' /><Text>正在打开内容</Text></View>

  const isSpecial = document.type === 'spreadsheet' || document.type === 'gantt'
  return <View className='document-page'><View className='document-top'><View className='document-top__type'>{document.type === 'spreadsheet' ? '表' : document.type === 'gantt' ? '甘' : '文'}</View><Text className='document-top__status'>{status}</Text><View className='document-top__menu' onClick={() => setToolsOpen(!toolsOpen)}>•••</View></View>{toolsOpen && <View className='tool-sheet'><View onClick={() => Taro.showToast({ title: '编辑历史将在移动端第二阶段开放', icon: 'none' })}>编辑历史</View><View onClick={() => Taro.showToast({ title: '分享设置请先使用桌面端', icon: 'none' })}>分享设置</View></View>}<ScrollView className='document-scroll' scrollY><Input className='document-title' value={title} placeholder='无标题内容' onInput={event => setTitle(event.detail.value)} />{isSpecial && <View className='special-banner'><Text>{document.type === 'spreadsheet' ? '电子表格移动预览' : '甘特图移动预览'}</Text><Text className='special-banner__copy'>当前版本支持内容编辑，完整网格与时间轴交互将在后续迁移。</Text></View>}<Textarea className='document-editor' autoHeight value={body} placeholder='开始记录你的想法…' maxlength={-1} onInput={event => setBody(event.detail.value)} /><View className='insert-bar'><View onClick={() => setBody(`${body}\n- `)}>列表</View><View onClick={() => setBody(`${body}\n## `)}>标题</View><View onClick={() => Taro.showToast({ title: '图片上传即将接入小程序文件接口', icon: 'none' })}>图片</View><View onClick={() => Taro.showToast({ title: '思维导图请从新建菜单创建', icon: 'none' })}>导图</View></View></ScrollView></View>
}
