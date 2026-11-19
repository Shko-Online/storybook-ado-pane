import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';

const meta = {
  title: 'Components/Card',
  component: Card,
  args: {
    title: 'Storybook',
    children: 'Published by run #20261119.1. 15 stories in 4 components.',
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};

export const WithStatus: Story = {
  args: { status: <Badge status="succeeded">Succeeded</Badge> },
};

export const WithActions: Story = {
  args: {
    status: <Badge status="failed">Failed</Badge>,
    children: 'The build step failed, so no Storybook was published for this run.',
    actions: (
      <>
        <Button label="Rerun" size="small" />
        <Button label="View logs" size="small" variant="secondary" />
      </>
    ),
  },
};
