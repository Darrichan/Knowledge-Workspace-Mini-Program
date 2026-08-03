import { PropsWithChildren } from 'react'
import Taro from '@tarojs/taro'
import './app.scss'

if (process.env.TARO_APP_API_MODE === 'cloud') {
  Taro.cloud.init({
    env: process.env.TARO_APP_CLOUD_ENV || undefined,
    traceUser: true
  })
}

function App({ children }: PropsWithChildren<any>) {
  return children
}

export default App
