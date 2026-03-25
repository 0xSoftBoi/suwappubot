import { forwardRef } from 'react';

interface PanelProps {
  id?: string;
  className?: string;
  children: React.ReactNode;
}

const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ id, className = '', children }, ref) => {
    return (
      <div
        ref={ref}
        id={id}
        className={`gsap-panel ${className}`}
      >
        {children}
      </div>
    );
  }
);

Panel.displayName = 'Panel';

export default Panel;
