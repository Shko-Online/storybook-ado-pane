import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './Badge';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  args: { status: 'succeeded', children: 'Succeeded' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Succeeded: Story = {};

export const Warning: Story = { args: { status: 'warning', children: 'Succeeded with issues' } };

export const Failed: Story = { args: { status: 'failed', children: 'Failed' } };

export const Neutral: Story = { args: { status: 'neutral', children: 'Queued' } };
