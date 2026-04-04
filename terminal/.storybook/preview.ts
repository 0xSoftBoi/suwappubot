import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'studio',
      values: [
        { name: 'studio', value: '#FFFEFB' },
        { name: 'butter', value: '#FFF8EE' },
        { name: 'spring-sky', value: '#EAF4FF' },
      ],
    },
    options: {
      storySort: {
        order: ['Foundations', 'Atoms', 'Molecules', 'Organisms', 'Templates'],
      },
    },
  },
}

export default preview
