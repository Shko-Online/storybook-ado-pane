import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Button } from './Button';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { label: 'Save changes', onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: 'secondary', label: 'Cancel' } };

export const Danger: Story = { args: { variant: 'danger', label: 'Delete pipeline' } };

export const Small: Story = { args: { size: 'small' } };

export const Large: Story = { args: { size: 'large' } };

export const Disabled: Story = { args: { disabled: true } };
