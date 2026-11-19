import './Button.css';

export interface ButtonProps {
  /** Text of the button. */
  label: string;
  /** How much the button stands out. */
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  onClick?: () => void;
}

/** The main way for a user to act on a page. */
export function Button({ label, variant = 'primary', size = 'medium', disabled = false, onClick }: ButtonProps) {
  return (
    <button
      type="button"
      className={`demo-button demo-button--${variant} demo-button--${size}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
