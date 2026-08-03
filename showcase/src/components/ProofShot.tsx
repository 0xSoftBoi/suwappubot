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
  priority = false,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  priority?: boolean;
}) {
  return (
    <figure className="proof">
      <div className="proof__frame">
        <Image
          src={src}
          width={width}
          height={height}
          alt={alt}
          priority={priority}
          // These are dense UI captures: fine tabular text turns to mush if the
          // browser upscales, so ask for a candidate at least as wide as the
          // real layout box (~1280) and keep compression light.
          sizes="(max-width: 900px) 100vw, 1400px"
          quality={92}
          className="proof__img"
        />
      </div>
      <figcaption className="proof__cap">{caption}</figcaption>
    </figure>
  );
}
