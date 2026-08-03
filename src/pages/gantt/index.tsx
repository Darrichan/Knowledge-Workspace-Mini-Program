import { Input, Picker, ScrollView, Slider, Text, View } from '@tarojs/components'
import Taro, { useLoad, useRouter } from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import DocumentPanels from '../../components/DocumentPanels'
import { documentApi } from '../../services/api'
import type { DocumentItem, GanttTask } from '../../types/domain'
import './index.scss'

const DAY = 86400000
const dateText = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const shortDate = (value: string) => { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? '选择日期' : `${date.getMonth() + 1}/${date.getDate()}` }
const parseDate = (value: string) => new Date(`${value}T00:00:00`).getTime()
const initialTasks = (content?: Record<string, any>): GanttTask[] => Array.isArray(content?.tasks) ? content.tasks : []

export default function GanttPage() {
  const id = useRouter().params.id || ''
  const [document, setDocument] = useState<DocumentItem | null>(null)
  const [title, setTitle] = useState('')
  const [tasks, setTasks] = useState<GanttTask[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState('正在加载')
  const [panel, setPanel] = useState<'history' | 'share' | null>(null)
  const hydrated = useRef(false); const savingRef = useRef(false); const queuedRef = useRef(false); const versionRef = useRef(1)
  const documentRef = useRef<DocumentItem | null>(null); const titleRef = useRef(''); const tasksRef = useRef<GanttTask[]>([])
  const hydrate = (result: DocumentItem) => { setDocument(result); documentRef.current = result; setTitle(result.title); titleRef.current = result.title; const next = initialTasks(result.content); setTasks(next); tasksRef.current = next; versionRef.current = result.version; setStatus(`版本 ${result.version}`) }
  useLoad(async () => { if (!id) return; try { hydrate(await documentApi.get(id)); setTimeout(() => { hydrated.current = true }, 0) } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) } })
  const saveNow = async (reason = 'interval') => {
    if (!documentRef.current || savingRef.current) { queuedRef.current = true; return }
    savingRef.current = true; queuedRef.current = false; const snapshot = tasksRef.current; const snapshotTitle = titleRef.current
    try { setStatus('保存中…'); const updated = await documentApi.update(documentRef.current.id, versionRef.current, snapshotTitle.trim() || '无标题甘特图', { type: 'gantt', tasks: snapshot }, reason); documentRef.current = updated; versionRef.current = updated.version; setDocument(updated); setStatus(`已自动保存 · 版本 ${updated.version}`) }
    catch (error) { setStatus('保存失败'); Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { savingRef.current = false; if (queuedRef.current || snapshot !== tasksRef.current || snapshotTitle !== titleRef.current) setTimeout(() => saveNow(), 0) }
  }
  useEffect(() => { titleRef.current = title; tasksRef.current = tasks; if (!hydrated.current) return; setStatus('有未保存更改'); const timer = setTimeout(() => saveNow(), 1200); return () => clearTimeout(timer) }, [title, tasks])
  const updateTask = (taskId: string, patch: Partial<GanttTask>) => setTasks(current => current.map(task => task.id === taskId ? { ...task, ...patch } : task))
  const addTask = () => { const task = { id: `${Date.now()}`, name: '', start: '', end: '', progress: 0 }; setTasks(current => [...current, task]); setSelectedId(task.id) }
  const removeTask = async (taskId: string) => { const result = await Taro.showModal({ title: '删除任务', content: '确定删除这项任务吗？' }); if (result.confirm) { setTasks(current => current.filter(task => task.id !== taskId)); if (selectedId === taskId) setSelectedId('') } }
  const days = useMemo(() => {
    const valid = tasks.flatMap(task => [task.start, task.end]).filter(Boolean).map(parseDate).filter(Number.isFinite)
    const start = valid.length ? Math.min(...valid) : new Date().setHours(0, 0, 0, 0)
    const end = valid.length ? Math.max(...valid) : start + DAY * 13
    return Array.from({ length: Math.min(180, Math.max(14, Math.round((end - start) / DAY) + 1)) }, (_, index) => dateText(new Date(start + index * DAY)))
  }, [tasks])
  const clickDay = (value: string) => {
    const task = tasks.find(item => item.id === selectedId)
    if (!task) return Taro.showToast({ title: '请先选中任务', icon: 'none' })
    if (!task.start || task.end) updateTask(task.id, { start: value, end: '' })
    else if (parseDate(value) < parseDate(task.start)) updateTask(task.id, { start: value, end: task.start })
    else updateTask(task.id, { end: value })
  }
  if (!document) return <View className='loading-screen'><View className='loading-ring' /><Text>正在打开甘特图</Text></View>
  return <View className='gantt-page'>
    <View className='gantt-top'><View className='gantt-top__icon'>甘</View><Input value={title} maxlength={300} onInput={event => setTitle(event.detail.value)} /><Text>{status}</Text><View onClick={() => saveNow('manual')}>保存</View><View onClick={() => Taro.showActionSheet({ itemList: ['编辑历史', '分享与发布'] }).then(result => setPanel(result.tapIndex === 0 ? 'history' : 'share')).catch(() => {})}>•••</View></View>
    <View className='gantt-summary'><View><Text>项目进度</Text><Text>{tasks.length ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length) : 0}%</Text></View><View className='gantt-summary__bar'><View style={{ width: `${tasks.length ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length) : 0}%` }} /></View><View className='gantt-add' onClick={addTask}>＋ 新建任务</View></View>
    <ScrollView className='gantt-scroll' scrollY enhanced showScrollbar={false}>
      <ScrollView className='timeline-days' scrollX showScrollbar={false}><View className='timeline-days__inner'>{days.map(day => <View key={day} className={tasks.some(task => task.start === day || task.end === day) ? 'marked' : ''} onClick={() => clickDay(day)}><Text>{shortDate(day)}</Text><Text>{['日', '一', '二', '三', '四', '五', '六'][new Date(`${day}T00:00:00`).getDay()]}</Text></View>)}</View></ScrollView>
      <Text className='timeline-help'>点击任务后，可直接点时间轴设置开始和结束日期</Text>
      <View className='task-list'>{tasks.map((task, index) => <View key={task.id} className={`task-card ${selectedId === task.id ? 'selected' : ''}`} onClick={() => setSelectedId(task.id)}>
        <View className='task-card__head'><Text>{String(index + 1).padStart(2, '0')}</Text><Input value={task.name} placeholder='输入任务名称' onFocus={() => setSelectedId(task.id)} onInput={event => updateTask(task.id, { name: event.detail.value })} /><View onClick={() => removeTask(task.id)}>×</View></View>
        <View className='date-row'><Picker mode='date' value={task.start || dateText(new Date())} onChange={event => updateTask(task.id, { start: String(event.detail.value), end: task.end && parseDate(task.end) < parseDate(String(event.detail.value)) ? '' : task.end })}><View><Text>开始</Text><Text className={task.start ? '' : 'placeholder'}>{shortDate(task.start)}</Text></View></Picker><Text>→</Text><Picker mode='date' value={task.end || task.start || dateText(new Date())} onChange={event => updateTask(task.id, { end: String(event.detail.value), start: task.start || String(event.detail.value) })}><View><Text>结束</Text><Text className={task.end ? '' : 'placeholder'}>{shortDate(task.end)}</Text></View></Picker></View>
        <View className='progress-row'><Text>进度</Text><Slider min={0} max={100} step={5} value={task.progress} activeColor='#6287d5' backgroundColor='#e2e8f1' blockSize={22} onChange={event => updateTask(task.id, { progress: event.detail.value })} /><Text>{task.progress}%</Text></View>
        {task.start && task.end && <View className='task-duration'>{Math.max(1, Math.round((parseDate(task.end) - parseDate(task.start)) / DAY) + 1)} 天</View>}
      </View>)}{!tasks.length && <View className='gantt-empty' onClick={addTask}><View>＋</View><Text>还没有任务</Text><Text>新建任务后再选择具体日期，不会预填默认数据</Text></View>}</View>
      <View className='gantt-bottom-space' />
    </ScrollView>
    {panel && <DocumentPanels document={document} mode={panel} onClose={() => setPanel(null)} onDocumentChange={hydrate} />}
  </View>
}
