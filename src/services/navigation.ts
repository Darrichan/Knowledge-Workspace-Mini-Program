import Taro from '@tarojs/taro'
import type { DocumentItem } from '../types/domain'

export function openDocument(item: DocumentItem) {
  if (item.type === 'folder') {
    Taro.setStorageSync('kw_mini_open_folder', item.id)
    return Taro.switchTab({ url: '/pages/space/index' })
  }
  const page = item.type === 'mindmap' ? 'mindmap' : item.type === 'spreadsheet' ? 'spreadsheet' : item.type === 'gantt' ? 'gantt' : 'document'
  Taro.navigateTo({ url: `/pages/${page}/index?id=${item.id}` })
}

export const CREATE_TYPES = [
  { label: '新建文档', type: 'document' as const, title: '无标题文档' },
  { label: '新建思维导图', type: 'mindmap' as const, title: '无标题思维导图' },
  { label: '新建电子表格', type: 'spreadsheet' as const, title: '无标题表格' },
  { label: '新建甘特图', type: 'gantt' as const, title: '无标题甘特图' },
  { label: '新建文件夹', type: 'folder' as const, title: '新建文件夹' }
]

export function initialContent(type: DocumentItem['type']) {
  if (type === 'mindmap') return { type: 'mindmap', root: '中心主题', nodes: [] }
  if (type === 'spreadsheet') return { type: 'spreadsheet', rows: 100, columns: 10, cells: {}, formats: {}, frozenRows: 1, frozenColumns: 1 }
  if (type === 'gantt') return { type: 'gantt', tasks: [] }
  if (type === 'folder') return { type: 'folder' }
  return { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
}
