import { Button, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import Brand from '../../components/Brand'
import { authApi } from '../../services/api'
import './index.scss'

type ScanState = 'ready' | 'confirming' | 'confirmed' | 'error'

export default function ScanLoginPage() {
  const router = useRouter()
  const ticket = useMemo(() => {
    const raw = String(router.params.scene || router.params.ticket || '')
    try { return decodeURIComponent(raw) } catch { return raw }
  }, [router.params.scene, router.params.ticket])
  const [state, setState] = useState<ScanState>(ticket ? 'ready' : 'error')
  const [message, setMessage] = useState(ticket ? '' : '登录二维码无效，请在电脑端刷新后重试')

  const confirmLogin = async () => {
    if (!ticket || state === 'confirming' || state === 'confirmed') return
    setState('confirming')
    setMessage('')
    try {
      const loginResult = await Taro.login()
      if (!loginResult.code) throw new Error('未能获取微信登录凭证，请重试')
      await authApi.confirmPcScan(ticket, loginResult.code)
      setState('confirmed')
      setMessage('电脑端已经完成登录，可以返回电脑继续使用')
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : '确认登录失败，请重试')
    }
  }

  const closeMiniProgram = () => {
    Taro.exitMiniProgram({ fail: () => Taro.navigateBack() })
  }

  return (
    <View className='scan-login-page'>
      <View className='scan-login-page__halo scan-login-page__halo--top' />
      <View className='scan-login-page__halo scan-login-page__halo--bottom' />
      <View className='scan-login-page__brand'><Brand compact /></View>
      <View className={`scan-login-card is-${state}`}>
        <View className='scan-login-card__icon'>
          {state === 'confirmed' ? '✓' : state === 'error' ? '!' : '↗'}
        </View>
        <Text className='scan-login-card__eyebrow'>KW 安全登录</Text>
        <Text className='scan-login-card__title'>
          {state === 'confirmed' ? '登录已确认' : state === 'error' ? '暂时无法确认' : '在电脑端登录 KW？'}
        </Text>
        <Text className='scan-login-card__copy'>
          {message || '确认后，扫描此码的电脑将获得你的 KW 登录状态。二维码不会泄露密码。'}
        </Text>
        {state === 'ready' && (
          <Button className='scan-login-card__primary' onClick={confirmLogin}>确认登录</Button>
        )}
        {state === 'confirming' && (
          <Button className='scan-login-card__primary' loading disabled>正在确认</Button>
        )}
        {state === 'error' && ticket && (
          <Button className='scan-login-card__primary' onClick={confirmLogin}>重新确认</Button>
        )}
        {state === 'confirmed' && (
          <Button className='scan-login-card__primary is-success' onClick={closeMiniProgram}>完成</Button>
        )}
        {state !== 'confirmed' && (
          <Button className='scan-login-card__secondary' onClick={closeMiniProgram}>取消</Button>
        )}
        <Text className='scan-login-card__notice'>仅在你本人发起 PC 登录时确认；陌生二维码请直接取消。</Text>
      </View>
    </View>
  )
}
