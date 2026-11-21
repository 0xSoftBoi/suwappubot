import type { ReactNode } from 'react';
import Live from './Live';

/**
 * ProductFrame: a real product capture set in a lit, slightly tilted window
 * with a soft glow behind it. Optional floating glass `chips` overlap its
 * corners (position with .v3-desk__chip--a / --b). Tilt flattens on small
 * screens; the capture is cropped to its chart on phones (see home-v3.css).
 * `flow` renders a labelled step strip chip with a travelling pulse.
 */
export default function ProductFrame({
  src,
  width,
  height,
  alt,
  title,
  flow,
  aside,
  calm,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  title?: string;
  flow?: string[];
  aside?: ReactNode;
  /** Flat, untilted, no glow: the hero treatment where the capture is the only artifact. */
  calm?: boolean;
}) {
  return (
    <div className={calm ? 'v3-desk v3-desk--calm' : 'v3-desk'}>
      <span className="v3-desk__glow" aria-hidden="true" />
      <div className="v3-desk__stage">
        <figure className="v3-desk__frame">
          <div className="v3-desk__bar" aria-hidden="true">
            <i /><i /><i />
            {title ? <span>{title}</span> : null}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} width={width} height={height} alt={alt} decoding="async" />
          <span className="v3-desk__sheen" aria-hidden="true" />
        </figure>
        {flow ? (
          <div className="v3-desk__chip v3-desk__chip--a v3-glass" aria-hidden="true">
            <ol>
              {flow.map((f, i) => (<li key={f}><b>{String(i + 1).padStart(2, '0')}</b>{f}</li>))}
            </ol>
            <Live className="v3-desk__run"><i /></Live>
          </div>
        ) : null}
        {aside ? <div className="v3-desk__chip v3-desk__chip--b v3-glass" aria-hidden="true">{aside}</div> : null}
      </div>
    </div>
  );
}
