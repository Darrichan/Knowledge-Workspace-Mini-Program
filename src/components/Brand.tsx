import { Image, Text, View } from '@tarojs/components'
import brandMark from '../assets/brand-mark.png'
import './Brand.scss'

type Props = { compact?: boolean }

export default function Brand({ compact = false }: Props) {
  return (
    <View className={`brand ${compact ? 'brand--compact' : ''}`}>
      <Image className='brand__mark' src={brandMark} mode='aspectFit' />
      <View className='brand__copy'>
        <Text className='brand__name'>KW</Text>
        <Text className='brand__en'>Knowledge Workspace</Text>
      </View>
    </View>
  )
}
