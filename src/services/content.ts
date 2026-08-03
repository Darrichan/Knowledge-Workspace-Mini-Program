import Taro from '@tarojs/taro'
import { documentApi } from './api'
import { CREATE_TYPES, openDocument } from './navigation'

export async function chooseAndCreate(workspaceId: string, onCreated?: () => void) {
  if (!workspaceId) {
    Taro.showToast({ title: '工作空间尚未准备好', icon: 'none' })
    return
  }
  try {
    const result = await Taro.showActionSheet({ itemList: CREATE_TYPES.map(item => item.label) })
    const choice = CREATE_TYPES[result.tapIndex]
    if (!choice) return
    Taro.showLoading({ title: '正在创建', mask: true })
    const created = await documentApi.create(workspaceId, choice.type, choice.title)
    Taro.hideLoading()
    onCreated?.()
    if (created.type === 'folder') {
      Taro.showToast({ title: '文件夹已创建', icon: 'success' })
    } else {
      openDocument(created)
    }
  } catch (error) {
    Taro.hideLoading()
    const message = (error as any)?.errMsg || (error as Error)?.message || ''
    if (!message.includes('cancel')) Taro.showToast({ title: message || '创建失败', icon: 'none' })
  }
}
