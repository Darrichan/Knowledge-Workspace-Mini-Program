import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import Brand from '../../components/Brand'
import { apiConfig, authApi } from '../../services/api'
import type { User, WechatBindingStatus } from '../../types/domain'
import './index.scss'

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(() => Taro.getStorageSync<User>('kw_mini_user') || null)
  const [wechatBinding, setWechatBinding] = useState<WechatBindingStatus | null>(null)
  const [bindingBusy, setBindingBusy] = useState(false)

  useDidShow(async () => {
    if (!authApi.hasToken()) return Taro.reLaunch({ url: '/pages/login/index' })
    try {
      const [current, binding] = await Promise.all([
        authApi.me(),
        authApi.wechatBinding()
      ])
      setUser(current)
      setWechatBinding(binding)
      Taro.setStorageSync('kw_mini_user', current)
    } catch {}
  })

  const bindWechat = async () => {
    if (bindingBusy || wechatBinding?.bound) return
    setBindingBusy(true)
    try {
      const loginResult = await Taro.login()
      if (!loginResult.code) throw new Error('未能获取微信登录凭证，请重试')
      const binding = await authApi.bindWechat(loginResult.code)
      setWechatBinding(binding)
      await Taro.showToast({ title: '微信绑定成功', icon: 'success' })
    } catch (error) {
      await Taro.showToast({
        title: error instanceof Error ? error.message : '微信绑定失败',
        icon: 'none',
        duration: 2600
      })
    } finally {
      setBindingBusy(false)
    }
  }

  const logout = () => {
    Taro.showModal({
      title: '退出登录',
      content: '确定退出当前账号吗？',
      success: result => {
        if (result.confirm) {
          authApi.logout()
          Taro.removeStorageSync('kw_mini_workspace')
          Taro.reLaunch({ url: '/pages/login/index' })
        }
      }
    })
  }

  return (
    <View className='page-shell safe-page profile-page'>
      <Brand compact />

      <View className='profile-card'>
        <View className='profile-card__avatar'>{(user?.display_name || '知').slice(0, 1)}</View>
        <Text className='profile-card__name'>{user?.display_name || '未登录'}</Text>
        <Text className='profile-card__email'>{user?.email || ''}</Text>
        <View className='profile-card__badge'>私有成员</View>
      </View>

      <View className={`wechat-bind-card ${wechatBinding?.bound ? 'wechat-bind-card--bound' : ''}`}>
        <View className='wechat-bind-card__icon'>微</View>
        <View className='wechat-bind-card__content'>
          <View className='wechat-bind-card__heading'>
            <Text>{wechatBinding?.bound ? '微信已绑定' : '微信未绑定'}</Text>
            <Text className='wechat-bind-card__status'>{wechatBinding?.bound ? '已开启' : '建议完成'}</Text>
          </View>
          <Text className='wechat-bind-card__copy'>
            {wechatBinding?.bound
              ? '当前微信已与 KW 账号一对一绑定，可用于小程序与 PC 端快捷登录。'
              : '绑定当前微信后，下次可直接授权登录。每个 KW 账号仅能绑定一个微信。'}
          </Text>
          {!wechatBinding?.bound && (
            <Button
              className='wechat-bind-card__button'
              loading={bindingBusy}
              disabled={bindingBusy || wechatBinding === null}
              onClick={bindWechat}
            >
              {bindingBusy ? '正在绑定' : '绑定当前微信'}
            </Button>
          )}
        </View>
      </View>

      <View className='settings-card'>
        <View className='settings-row'>
          <Text>账号 ID</Text>
          <Text className='settings-row__value'>{user?.public_id || '-'}</Text>
        </View>
        <View className='settings-row'>
          <Text>接口环境</Text>
          <Text className='settings-row__value settings-row__value--online'>已连接</Text>
        </View>
        <View className='settings-row settings-row--stack'>
          <Text>当前 API</Text>
          <Text className='settings-row__api'>{apiConfig.baseUrl}</Text>
        </View>
      </View>
      <Button className='logout-button' onClick={logout}>退出登录</Button>
    </View>
  )
}
