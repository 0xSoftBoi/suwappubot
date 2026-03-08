'use client';

import { forwardRef } from 'react';

interface PanelProps {
  id?: string;
  className?: string;
  children: React.ReactNode;
}

const Panel = forwardRef<HTMLElement, PanelProps>(({ id, className = '', children }, ref) => {
  return (
    <section
      ref={ref}
      id={id}
      className={`gsap-panel ${className}`}
    >
      {children}
    </section>
  );
});

Panel.displayName = 'Panel';
export default Panel;
