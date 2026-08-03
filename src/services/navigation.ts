import Taro from '@tarojs/taro'
import type { DocumentItem } from '../types/domain'

export function openDocument(item: DocumentItem) {
  if (item.type === 'folder') {
    Taro.showToast({ title: '移动端文件夹浏览正在接入', icon: 'none' })
    return
  }
  const page = item.type === 'mindmap' ? 'mindmap' : 'document'
  Taro.navigateTo({ url: `/pages/${page}/index?id=${item.id}` })
}

export const CREATE_TYPES = [
  { label: '新建文档', type: 'document' as const, title: '无标题文档' },
  { label: '新建思维导图', type: 'mindmap' as const, title: '无标题思维导图' },
  { label: '新建电子表格', type: 'spreadsheet' as const, title: '无标题表格' },
  { label: '新建甘特图', type: 'gantt' as const, title: '无标题甘特图' },
  { label: '新建文件夹', type: 'folder' as const, title: '新建文件夹' }
]
