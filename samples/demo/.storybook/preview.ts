import type { Preview } from '@storybook/react-vite';
import '../src/tokens.css';

const preview: Preview = {
  // A documentation page for every component, generated from its stories.
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    options: { storySort: { order: ['Welcome', 'Components', 'Screens'] } },
    controls: { matchers: { color: /(background|color)$/i } },
  },
};

export default preview;
