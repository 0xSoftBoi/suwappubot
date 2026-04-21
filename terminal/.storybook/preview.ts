import type { Preview } from '@storybook/react-vite'
import { createElement } from 'react'
import '../src/index.css'
import { TerminalThemeScope, type TerminalThemeMode } from '../src/theme/TerminalThemeScope'

const preview: Preview = {
  decorators: [
    (Story, context) =>
      createElement(
        TerminalThemeScope,
        { mode: context.globals.terminalTheme as TerminalThemeMode },
        createElement(Story),
      ),
  ],
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
        order: ['Workbench', 'Foundations', 'Atoms', 'Molecules', 'Organisms', 'Templates'],
      },
    },
  },
  globalTypes: {
    terminalTheme: {
      name: 'Terminal Theme',
      description: 'Global rebuilt terminal theme',
      toolbar: {
        icon: 'paintbrush',
        dynamicTitle: true,
        items: [
          { value: 'precision', title: 'Precision' },
          { value: 'desk', title: 'Desk' },
          { value: 'studio', title: 'Studio' },
        ],
      },
    },
  },
  initialGlobals: {
    terminalTheme: 'precision',
  },
}

export default preview
