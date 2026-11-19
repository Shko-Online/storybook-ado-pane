import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { RunSummary } from './RunSummary';

const meta = {
  title: 'Screens/Run summary',
  component: RunSummary,
  args: { run: '20261119.1', result: 'succeeded', onRerun: fn() },
} satisfies Meta<typeof RunSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Succeeded: Story = {};

export const Failed: Story = { args: { result: 'failed' } };
