import type { ReactNode } from 'react';
import './Card.css';

export interface CardProps {
  title: string;
  /** Shown to the right of the title, usually a Badge. */
  status?: ReactNode;
  children: ReactNode;
  /** Buttons at the bottom of the card. */
  actions?: ReactNode;
}

/** Groups what belongs to one thing: a title, a few lines about it, and what you can do with it. */
export function Card({ title, status, children, actions }: CardProps) {
  return (
    <section className="demo-card">
      <header className="demo-card-header">
        <h3 className="demo-card-title">{title}</h3>
        {status}
      </header>
      <p className="demo-card-body">{children}</p>
      {actions && <div className="demo-card-actions">{actions}</div>}
    </section>
  );
}
