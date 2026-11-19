import './Badge.css';

export interface BadgeProps {
  /** Result the badge reports. */
  status: 'succeeded' | 'warning' | 'failed' | 'neutral';
  children: string;
}

/** A short status label, for example the result of a pipeline run. */
export function Badge({ status, children }: BadgeProps) {
  return <span className={`demo-badge demo-badge--${status}`}>{children}</span>;
}
