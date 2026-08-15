import Image from 'next/image';

/**
 * ProofShot: a real screenshot of shipped product, framed as evidence.
 *
 * These replaced the abstract canvas motifs that used to sit in these bands.
 * A sophisticated trading audience reads a real order book faster than any
 * metaphor for one, so the rule here is strict: every pixel is a capture of
 * the live product, never an illustration of it.
 *
 * The caption carries the source and the capture date because the numbers in
 * these frames are real market data from a moment in time. Labelling that is
 * the difference between proof and a stale claim.
 */
export default function ProofShot({
  src,
  width,
  height,
  alt,
  caption,
  mobileHint,
  priority = false,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  mobileHint: string;
  priority?: boolean;
}) {
  return (
    <figure className="proof">
      <div className="proof__viewport" role="region" tabIndex={0} aria-label={mobileHint}>
        <div className="proof__frame">
          <Image
            src={src}
            width={width}
            height={height}
            alt={alt}
            priority={priority}
            sizes="(max-width: 680px) 900px, (max-width: 900px) 100vw, 1400px"
            quality={92}
            className="proof__img"
          />
        </div>
      </div>
      <figcaption className="proof__cap">{caption}</figcaption>
      <p className="proof__mobile-hint">{mobileHint}</p>
    </figure>
  );
}
