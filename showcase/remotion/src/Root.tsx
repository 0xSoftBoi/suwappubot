import { Composition } from 'remotion'
import { TelegramBotDemo } from './compositions/TelegramBotDemo'
import { MiniAppDemo } from './compositions/MiniAppDemo'
import { WhatsAppDemo } from './compositions/WhatsAppDemo'
import { MobileAppDemo } from './compositions/MobileAppDemo'

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TelegramBotDemo"
        component={TelegramBotDemo}
        durationInFrames={750} // 25 seconds at 30fps
        fps={30}
        width={720}
        height={1280}
      />
      <Composition
        id="MiniAppDemo"
        component={MiniAppDemo}
        durationInFrames={900} // 30 seconds at 30fps
        fps={30}
        width={720}
        height={1280}
      />
      <Composition
        id="WhatsAppDemo"
        component={WhatsAppDemo}
        durationInFrames={600} // 20 seconds at 30fps
        fps={30}
        width={720}
        height={1280}
      />
      <Composition
        id="MobileAppDemo"
        component={MobileAppDemo}
        durationInFrames={900} // 30 seconds at 30fps
        fps={30}
        width={720}
        height={1280}
      />
    </>
  )
}
