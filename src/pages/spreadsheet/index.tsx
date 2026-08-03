import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useLoad, useRouter } from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import DocumentPanels from '../../components/DocumentPanels'
import { documentApi } from '../../services/api'
import type { DocumentItem, SheetFormat } from '../../types/domain'
import './index.scss'

type CellPoint = { row: number; col: number }
type SheetContent = { type: 'spreadsheet'; rows: number; columns: number; cells: Record<string, string>; formats: Record<string, SheetFormat>; frozenRows?: number; frozenColumns?: number }
const COLORS = ['#25364d', '#d35f5f', '#df8c35', '#c79a00', '#318b62', '#317eaa', '#5378ca', '#7c5bc1', '#b45887']
const keyOf = (row: number, col: number) => `${row}:${col}`
const columnName = (index: number) => { let value = index + 1; let name = ''; while (value) { value -= 1; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26) } return name }
const initialSheet = (content?: Record<string, any>): SheetContent => content?.type === 'spreadsheet' ? { type: 'spreadsheet', rows: Math.max(100, Number(content.rows) || 100), columns: Math.max(10, Number(content.columns) || 10), cells: content.cells || {}, formats: content.formats || {}, frozenRows: content.frozenRows ?? 1, frozenColumns: content.frozenColumns ?? 1 } : { type: 'spreadsheet', rows: 100, columns: 10, cells: {}, formats: {}, frozenRows: 1, frozenColumns: 1 }

export default function SpreadsheetPage() {
  const id = useRouter().params.id || ''
  const [document, setDocument] = useState<DocumentItem | null>(null)
  const [title, setTitle] = useState('')
  const [sheet, setSheet] = useState<SheetContent>(initialSheet())
  const [anchor, setAnchor] = useState<CellPoint>({ row: 0, col: 0 })
  const [focus, setFocus] = useState<CellPoint>({ row: 0, col: 0 })
  const [rangeMode, setRangeMode] = useState(false)
  const [status, setStatus] = useState('正在加载')
  const [panel, setPanel] = useState<'history' | 'share' | null>(null)
  const hydrated = useRef(false); const versionRef = useRef(1); const savingRef = useRef(false); const queuedRef = useRef(false)
  const titleRef = useRef(''); const sheetRef = useRef(sheet); const documentRef = useRef<DocumentItem | null>(null)

  const hydrate = (result: DocumentItem) => { setDocument(result); documentRef.current = result; setTitle(result.title); titleRef.current = result.title; const next = initialSheet(result.content); setSheet(next); sheetRef.current = next; versionRef.current = result.version; setStatus(`版本 ${result.version}`) }
  useLoad(async () => { if (!id) return; try { hydrate(await documentApi.get(id)); setTimeout(() => { hydrated.current = true }, 0) } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) } })
  const saveNow = async (reason = 'interval') => {
    if (!documentRef.current || savingRef.current) { queuedRef.current = true; return }
    savingRef.current = true; queuedRef.current = false; const snapshot = sheetRef.current; const snapshotTitle = titleRef.current
    try { setStatus('保存中…'); const updated = await documentApi.update(documentRef.current.id, versionRef.current, snapshotTitle.trim() || '无标题表格', snapshot, reason); documentRef.current = updated; versionRef.current = updated.version; setDocument(updated); setStatus(`已自动保存 · 版本 ${updated.version}`) }
    catch (error) { setStatus('保存失败'); Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { savingRef.current = false; if (queuedRef.current || snapshot !== sheetRef.current || snapshotTitle !== titleRef.current) setTimeout(() => saveNow(), 0) }
  }
  useEffect(() => { titleRef.current = title; sheetRef.current = sheet; if (!hydrated.current) return; setStatus('有未保存更改'); const timer = setTimeout(() => saveNow(), 1200); return () => clearTimeout(timer) }, [title, sheet])

  const bounds = useMemo(() => ({ top: Math.min(anchor.row, focus.row), bottom: Math.max(anchor.row, focus.row), left: Math.min(anchor.col, focus.col), right: Math.max(anchor.col, focus.col) }), [anchor, focus])
  const inSelection = (row: number, col: number) => row >= bounds.top && row <= bounds.bottom && col >= bounds.left && col <= bounds.right
  const select = (row: number, col: number) => { if (rangeMode) setFocus({ row, col }); else { setAnchor({ row, col }); setFocus({ row, col }) } }
  const updateCell = (row: number, col: number, value: string) => setSheet(current => ({ ...current, cells: { ...current.cells, [keyOf(row, col)]: value } }))
  const selectedKeys = () => { const keys: string[] = []; for (let row = bounds.top; row <= bounds.bottom; row += 1) for (let col = bounds.left; col <= bounds.right; col += 1) keys.push(keyOf(row, col)); return keys }
  const applyFormat = (patch: SheetFormat) => setSheet(current => { const formats = { ...current.formats }; selectedKeys().forEach(key => { formats[key] = { ...formats[key], ...patch } }); return { ...current, formats } })
  const copy = async () => { const rows: string[] = []; for (let row = bounds.top; row <= bounds.bottom; row += 1) { const values: string[] = []; for (let col = bounds.left; col <= bounds.right; col += 1) values.push(sheet.cells[keyOf(row, col)] || ''); rows.push(values.join('\t')) } await Taro.setClipboardData({ data: rows.join('\n') }) }
  const paste = async () => { const result = await Taro.getClipboardData(); const lines = result.data.split(/\r?\n/).map(line => line.split('\t')); setSheet(current => { const cells = { ...current.cells }; lines.forEach((line, rowOffset) => line.forEach((value, colOffset) => { cells[keyOf(anchor.row + rowOffset, anchor.col + colOffset)] = value })); return { ...current, rows: Math.max(current.rows, anchor.row + lines.length), columns: Math.max(current.columns, anchor.col + Math.max(...lines.map(line => line.length))), cells } }) }
  const fillDown = () => { const first = sheet.cells[keyOf(bounds.top, bounds.left)] || ''; const numeric = Number(first); setSheet(current => { const cells = { ...current.cells }; for (let row = bounds.top; row <= bounds.bottom; row += 1) for (let col = bounds.left; col <= bounds.right; col += 1) cells[keyOf(row, col)] = Number.isFinite(numeric) && first.trim() !== '' ? String(numeric + row - bounds.top) : first; return { ...current, cells } }) }
  const addRows = () => setSheet(current => ({ ...current, rows: current.rows + 100 }))
  const addColumn = () => setSheet(current => ({ ...current, columns: current.columns + 1 }))

  if (!document) return <View className='loading-screen'><View className='loading-ring' /><Text>正在打开表格</Text></View>
  return <View className='sheet-page'>
    <View className='sheet-top'><View className='sheet-top__icon'>表</View><Input value={title} maxlength={300} onInput={event => setTitle(event.detail.value)} /><Text>{status}</Text><View onClick={() => saveNow('manual')}>保存</View><View onClick={() => Taro.showActionSheet({ itemList: ['编辑历史', '分享与发布'] }).then(result => setPanel(result.tapIndex === 0 ? 'history' : 'share')).catch(() => {})}>•••</View></View>
    <ScrollView className='sheet-tools' scrollX showScrollbar={false}><View className='sheet-tools__inner'><View className={rangeMode ? 'active' : ''} onClick={() => { setRangeMode(!rangeMode); if (rangeMode) setAnchor(focus) }}>{rangeMode ? '结束选择' : '多选'}</View><View onClick={() => applyFormat({ bold: true })}>B</View><View className='italic' onClick={() => applyFormat({ italic: true })}>I</View>{COLORS.map(color => <View key={color} className='color-dot' style={{ background: color }} onClick={() => applyFormat({ color })} />)}<View onClick={copy}>复制</View><View onClick={paste}>粘贴</View><View onClick={fillDown}>向下填充</View><View onClick={addColumn}>＋列</View></View></ScrollView>
    <View className='formula-bar'><Text>{columnName(focus.col)}{focus.row + 1}</Text><Input value={sheet.cells[keyOf(focus.row, focus.col)] || ''} onInput={event => updateCell(focus.row, focus.col, event.detail.value)} placeholder='输入值或公式' /></View>
    <ScrollView className='sheet-scroll' scrollX scrollY enhanced showScrollbar onScrollToLower={addRows} lowerThreshold={80}><View className='sheet-grid' style={{ width: `${86 + sheet.columns * 210}px` }}>
      <View className='sheet-row sheet-row--header'><View className='row-number'>✛</View>{Array.from({ length: sheet.columns }, (_, col) => <View key={col} className={`column-head ${col >= bounds.left && col <= bounds.right ? 'selected' : ''}`}>{columnName(col)}</View>)}</View>
      {Array.from({ length: sheet.rows }, (_, row) => <View className='sheet-row' key={row}><View className={`row-number ${row >= bounds.top && row <= bounds.bottom ? 'selected' : ''}`}>{row + 1}</View>{Array.from({ length: sheet.columns }, (_, col) => { const key = keyOf(row, col); const format = sheet.formats[key] || {}; return <View key={key} className={`sheet-cell ${inSelection(row, col) ? 'selected' : ''} ${row === focus.row && col === focus.col ? 'focused' : ''}`} onClick={() => select(row, col)} onLongPress={() => { setAnchor({ row, col }); setFocus({ row, col }); setRangeMode(true); Taro.showToast({ title: '已开始多选', icon: 'none' }) }}><Input value={sheet.cells[key] || ''} style={{ color: format.color || '#26364b', fontWeight: format.bold ? '700' : '400', fontStyle: format.italic ? 'italic' : 'normal', textAlign: format.align || 'left', background: format.background || 'transparent' }} onFocus={() => select(row, col)} onInput={event => updateCell(row, col, event.detail.value)} /></View> })}</View>)}
      <View className='sheet-load-more' onClick={addRows}>＋ 再添加 100 行</View>
    </View></ScrollView>
    {panel && <DocumentPanels document={document} mode={panel} onClose={() => setPanel(null)} onDocumentChange={hydrate} />}
  </View>
}
