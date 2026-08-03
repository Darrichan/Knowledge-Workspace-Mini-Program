import { Button, Input, Slider, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useState } from 'react'
import Brand from '../../components/Brand'
import { authApi } from '../../services/api'
import './index.scss'

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [challengeToken, setChallengeToken] = useState('')
  const [target, setTarget] = useState(50)
  const [sliderValue, setSliderValue] = useState(0)
  const [captchaTicket, setCaptchaTicket] = useState('')
  const [captchaBusy, setCaptchaBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [wechatBusy, setWechatBusy] = useState(false)

  const loadChallenge = useCallback(async () => {
    try {
      const challenge = await authApi.challenge()
      setChallengeToken(challenge.challenge_token)
      setTarget(challenge.target)
      setSliderValue(0)
      setCaptchaTicket('')
    } catch (error) {
      Taro.showToast({ title: (error as Error).message, icon: 'none' })
    }
  }, [])

  useDidShow(() => {
    if (authApi.hasToken()) {
      Taro.switchTab({ url: '/pages/home/index' })
      return
    }
    loadChallenge()
  })

  const verifySlider = async (value: number): Promise<string> => {
    if (!challengeToken || captchaBusy) return ''
    setCaptchaBusy(true)
    try {
      const result = await authApi.verifyCaptcha(challengeToken, value)
      setCaptchaTicket(result.captcha_ticket)
      setSliderValue(target)
      Taro.showToast({ title: '验证通过', icon: 'success' })
      return result.captcha_ticket
    } catch (error) {
      Taro.showToast({ title: (error as Error).message, icon: 'none' })
      await loadChallenge()
      return ''
    } finally {
      setCaptchaBusy(false)
    }
  }

  const submit = async () => {
    if (!email || !password || (mode === 'register' && (!displayName || !inviteCode))) {
      Taro.showToast({ title: '请填写完整信息', icon: 'none' })
      return
    }
    if (busy || captchaBusy) return
    setBusy(true)
    try {
      let activeCaptchaTicket = captchaTicket
      if (!activeCaptchaTicket) {
        if (Math.abs(sliderValue - target) > 3) {
          Taro.showToast({ title: '请将滑块移动到标记位置', icon: 'none' })
          return
        }
        activeCaptchaTicket = await verifySlider(sliderValue)
        if (!activeCaptchaTicket) return
      }
      const result = mode === 'login'
        ? await authApi.login(email.trim(), password, activeCaptchaTicket)
        : await authApi.register(email.trim(), displayName.trim(), password, inviteCode.trim(), activeCaptchaTicket)
      authApi.saveSession(result)
      Taro.showToast({ title: mode === 'login' ? '登录成功' : '注册成功', icon: 'success' })
      setTimeout(() => Taro.switchTab({ url: '/pages/home/index' }), 350)
    } catch (error) {
      Taro.showToast({ title: (error as Error).message, icon: 'none', duration: 2400 })
      loadChallenge()
    } finally {
      setBusy(false)
    }
  }

  const loginWithWechat = async () => {
    if (wechatBusy || busy) return
    setWechatBusy(true)
    try {
      const loginResult = await Taro.login()
      if (!loginResult.code) throw new Error('未能获取微信登录凭证，请重试')
      const result = await authApi.wechatLogin(loginResult.code)
      authApi.saveSession(result)
      await Taro.showToast({ title: '微信登录成功', icon: 'success' })
      setTimeout(() => Taro.switchTab({ url: '/pages/home/index' }), 350)
    } catch (error) {
      await Taro.showToast({
        title: error instanceof Error ? error.message : '微信登录失败',
        icon: 'none',
        duration: 2800
      })
    } finally {
      setWechatBusy(false)
    }
  }

  return (
    <View className='login-page'>
      <View className='login-page__halo login-page__halo--top' />
      <View className='login-page__halo login-page__halo--bottom' />
      <View className='login-page__brand'><Brand /></View>
      <View className='login-card'>
        <View className='login-card__heading'>
          <Text className='login-card__title'>{mode === 'login' ? '欢迎回来' : '创建私有账号'}</Text>
          <Text className='login-card__subtitle'>{mode === 'login' ? '进入你的移动知识工作台' : '仅限持有邀请码的成员注册'}</Text>
        </View>
        <View className='mode-switch'>
          <View className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</View>
          <View className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</View>
        </View>
        <View className='form-stack'>
          {mode === 'register' && <Input className='form-input' placeholder='你的称呼' value={displayName} onInput={event => setDisplayName(event.detail.value)} />}
          <Input className='form-input' type='text' placeholder='邮箱' value={email} onInput={event => setEmail(event.detail.value)} />
          <Input className='form-input' password placeholder='密码（至少 8 位）' value={password} onInput={event => setPassword(event.detail.value)} />
          {mode === 'register' && <Input className='form-input' placeholder='邀请码' value={inviteCode} onInput={event => setInviteCode(event.detail.value)} />}
        </View>
        <View className={`slider-card ${captchaTicket ? 'slider-card--verified' : ''}`}>
          <View className='slider-card__label'>
            <Text>{captchaTicket ? '验证已通过' : captchaBusy ? '正在验证…' : '拖动滑块完成验证'}</Text>
            {!captchaTicket && !captchaBusy && <Text className='slider-card__refresh' onClick={loadChallenge}>换一个</Text>}
          </View>
          <View className='slider-card__track'>
            <View className='slider-card__target' style={{ left: `${target}%` }} />
            <Slider
              value={sliderValue}
              activeColor='#668bdd'
              backgroundColor='#e9eef6'
              blockColor={captchaTicket ? '#54aa96' : '#ffffff'}
              blockSize={26}
              disabled={Boolean(captchaTicket) || captchaBusy}
              onChanging={event => setSliderValue(event.detail.value)}
              onChange={event => verifySlider(event.detail.value)}
            />
          </View>
        </View>
        <Button className='primary-button login-card__submit' loading={busy || captchaBusy} disabled={busy || captchaBusy} onClick={submit}>
          {captchaBusy ? '正在验证' : mode === 'login' ? '登录' : '使用邀请码注册'}
        </Button>
        {mode === 'login' && <>
          <View className='login-divider'><Text>或</Text></View>
          <Button className='wechat-login-button' loading={wechatBusy} disabled={wechatBusy || busy} onClick={loginWithWechat}>
            <Text className='wechat-login-button__mark'>微</Text>
            <Text>{wechatBusy ? '正在识别微信' : '微信快捷登录'}</Text>
          </Button>
          <Text className='wechat-login-help'>首次使用请先通过邮箱登录，并在“我的”页面绑定当前微信。</Text>
        </>}
      </View>
      <Text className='login-page__footer'>私有部署 · 内容仅对受邀成员开放</Text>
    </View>
  )
}
