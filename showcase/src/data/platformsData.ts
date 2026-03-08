export interface Platform {
  id: string;
  name: string;
  description: string;
  video: string;
  features: string[];
}

export const PLATFORMS: Platform[] = [
  {
    id: 'telegram-bot',
    name: 'Telegram Bot',
    description: 'Quick commands, inline keyboards, instant confirmations.',
    video: '/remotion/out/telegram-bot-demo.mp4',
    features: ['/s command for swaps', 'Inline keyboard confirmations', 'Real-time price updates'],
  },
  {
    id: 'mini-app',
    name: 'Mini App',
    description: 'Full trading dashboard inside Telegram.',
    video: '/remotion/out/mini-app-demo.mp4',
    features: ['Portfolio overview', 'Advanced swap interface', 'Price alerts'],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Same bot, different messenger.',
    video: '/remotion/out/whatsapp-demo.mp4',
    features: ['Token picker flow', 'Reply-based confirmations'],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Full trading bot for your server.',
    video: '/remotion/out/discord-demo.mp4',
    features: ['/swap and /wallet commands', 'Whale alerts and trending tokens', 'Daily leaderboard'],
  },
  {
    id: 'mobile',
    name: 'Mobile',
    description: 'Native iOS experience.',
    video: '/remotion/out/mobile-app-demo.mp4',
    features: ['Tab-based navigation', 'Token discovery', 'Push notifications'],
  },
];
