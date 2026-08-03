import { Text, View } from '@tarojs/components'
import type { DocumentItem, DocumentType } from '../types/domain'
import './ContentCard.scss'

const TYPE_META: Record<DocumentType, { icon: string; label: string; className: string }> = {
  document: { icon: '文', label: '文档', className: 'doc' },
  mindmap: { icon: '导', label: '思维导图', className: 'mind' },
  spreadsheet: { icon: '表', label: '电子表格', className: 'sheet' },
  gantt: { icon: '甘', label: '甘特图', className: 'gantt' },
  folder: { icon: '夹', label: '文件夹', className: 'folder' }
}

type Props = { item: DocumentItem; onClick: (item: DocumentItem) => void }

export default function ContentCard({ item, onClick }: Props) {
  const meta = TYPE_META[item.type] || TYPE_META.document
  return (
    <View className='content-card' hoverClass='content-card--pressed' onClick={() => onClick(item)}>
      <View className={`content-card__icon content-card__icon--${meta.className}`}>{meta.icon}</View>
      <View className='content-card__body'>
        <Text className='content-card__title'>{item.title}</Text>
        <Text className='content-card__meta'>{meta.label} · 版本 {item.version}</Text>
      </View>
      <Text className='content-card__arrow'>›</Text>
    </View>
  )
}
