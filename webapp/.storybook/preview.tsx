import React from 'react'
import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'telegram-light',
      values: [
        { name: 'telegram-light', value: '#ffffff' },
        { name: 'telegram-dark', value: '#1c1c1e' },
      ],
    },
    a11y: {
      test: 'todo'
    }
  },
  globalTypes: {
    theme: {
      description: 'Global theme for components',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: ['light', 'dark'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme
      return (
        <div className={theme === 'dark' ? 'dark' : ''}>
          <div
            style={{
              backgroundColor: 'var(--tg-theme-bg-color)',
              color: 'var(--tg-theme-text-color)',
              minHeight: '100vh',
              padding: '0',
            }}
          >
            <Story />
          </div>
        </div>
      )
    },
  ],
};

export default preview;