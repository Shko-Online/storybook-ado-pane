import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  // Files copied as they are into the built Storybook (the illustration on the welcome page).
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
};

export default config;
