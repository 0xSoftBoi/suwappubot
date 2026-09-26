# Hero media: the ocean loop and the soundscape (2026-08-25)

The home hero's atmosphere layer. Two assets, both of which had a naive first
version that shipped and then got replaced once it was actually measured.
Written down because both replacements were driven by evidence that is cheap to
lose and expensive to rediscover.

Code: `showcase/src/components/OceanAtmosphere.tsx`,
`showcase/src/lib/ambientEngine.ts`, `showcase/scripts/encode-ocean.sh`.

---

## 1. The video

### What was wrong with the first version

It hotlinked `videos.pexels.com` directly, and it used Pexels clip **1093652**
(golden hour). Two independent problems:

**Hotlinking.** A third party we do not control could throttle, move, or block
the single most important asset on the site. That is not an acceptable
dependency for the first thing a visitor sees. The encoded output is now
committed and served from our own origin.

**The clip cannot loop.** 1093652 looks better in a single frame than what
replaced it, which is exactly why it survived a review. It is a continuous
drone shot **flying towards shore**: by the end, rocks and wet sand are in
frame. It never returns to where it started, so:

- a hard cut back to frame 0 is an obvious jump;
- crossfading the head over the tail ghosts *rocks through open water*, which
  looks like a rendering bug.

An automated frame-pair search (below) initially "found" a good loop in it at
`3.63s → 9.63s`. Those two frames are open ocean and a rocky beach. The metric
was 64x36 **grayscale** MSE, and both frames have a similar luminance layout
(bright sky above, bright water below), so they scored as near-identical.
Re-running in colour at 96x54 fixed it. If you automate a similarity search,
verify the winning pair by eye before trusting it.

### The clip that shipped

Pexels **856204**, a locked-off shot of open water, 20s, 4K. No landfall, fixed
horizon, fixed sun-glint path. Only clouds and the water surface move, so it
genuinely returns to where it started.

Its one flaw is that it is cold midday blue, which fights the warm soil and
persimmon palette. Recovered with `colortemperature=4400` baked into the
encode, which lands on a warm-neutral pewter. `3800` was tested and goes sepia:
the water stops reading as water.

### Loop points, chosen not guessed

Every frame pair at least N seconds apart was compared and the tightest colour
match won. On 856204:

| min length | seam | MSE |
|---|---|---|
| 10s | 9.84s → 19.84s | 172 |
| **12s** | **8.00s → 20.00s** | **243** |
| 14s | 6.00s → 20.00s | 340 |

12s was taken: a longer loop repeats less noticeably and the seam is still
tight. For scale, the naive "cut the whole clip end-to-start" seam on the old
footage measured **26,236** on the same scale.

A 0.5s dissolve then hides the residual. Because the pair is already matched,
the dissolve blends near-identical frames and produces none of the ghosting
that sank the previous clip. The output opens and closes on the same frame
(`src[8.5]`).

### Encoding

Sun glitter on open water is close to the worst case for a video codec: every
frame is full of moving high-frequency speckle. Denoise is the biggest lever,
because it removes detail the hero's scrim hides anyway.

| | 1080p | 720p |
|---|---|---|
| shipped (H.264, hqdn3d, CRF 39) | **1.35 MB** | **476 KB** |
| before denoise/CRF tuning | 4.1 MB | 1.7 MB |

Both were rendered through the production colour treatment (brightness 0.7,
scrim, grain, vignette) and compared as crops before CRF 39 was accepted.

**H.264 only, deliberately.** An intermediate revision also shipped VP9/WebM on
the usual "modern codec is smaller" reasoning. Measured on this footage it is
not. At matched quality VP9 cost 5.7 MB against H.264's 4.1 MB; at matched
size it looked worse; at CRF 54 it was still **3.4x larger** than H.264 CRF 39.
libvpx handles this speckle badly. H.264 also has universal hardware decode,
which matters for a video that loops forever in the background of a phone.
Re-measure before re-adding WebM; do not add it back on principle.

### Delivery

- The poster is the **LCP element**, preloaded from `page.tsx`. Measured
  locally: **LCP 696ms**, **CLS 0**.
- The poster is the loop's *opening* frame under the same grade, so the
  poster-to-video handoff has nothing to flash between.
- The video mounts in an effect, i.e. after hydration, which keeps it off the
  critical path while the poster is still the largest paint.
- 1080p at >=700px viewport, 720p below. Reduced-motion, Save-Data, and
  2G/3G visitors get the poster and no video at all.

---

## 2. The soundscape

Synthesized at runtime, so there is no audio file to download, license, or
cache-bust, and because it is generated rather than played back it never
audibly loops.

The first version was filtered brown noise plus a few detuned sine oscillators.
It was honest about being cheap and it sounded it: **no reverb at all**, which
is the single thing that separates "a space" from "oscillators in a box".

What it is now (`showcase/src/lib/ambientEngine.ts`):

- **Convolution reverb with a procedurally generated impulse response.** The IR
  is exponentially decaying noise shaped by a one-pole lowpass whose cutoff
  closes across the tail, because air absorbs high frequencies first and that
  is what makes a synthetic tail sound like a room. Decorrelated per channel
  for width, with a 12ms fade-in so the onset reads as early reflections rather
  than a click. Generated, so the "room" costs zero bytes.
- **Real voice architecture.** Each pad note is three oscillators detuned in
  cents through a lowpass that opens as the note swells and closes as it fades:
  movement without vibrato.
- **Generative composition**, not a drone. Chords are drawn from D natural
  minor and scheduled with a lookahead scheduler against `AudioContext`'s
  clock, because `setTimeout` jitters and drifts. Notes are staggered so a
  chord assembles rather than lands, and overlap the previous chord's tail.
- **Sparse bells** sent almost entirely to the reverb, at irregular intervals so
  they never read as a UI chime.
- A **compressor** on the master bus so overlapping swells cannot stack into
  clipping.

Verified by rendering the same DSP through an `OfflineAudioContext` and
measuring the result: RMS 0.272, peak 0.705 (so it is audible and not
clipping), zero NaN samples, and an IR that decays from 0.0369 to 0.000001
across its tail.

---

## Regenerating

```bash
curl -L 'https://videos.pexels.com/video-files/856204/856204-uhd_3840_2160_25fps.mp4' -o ocean-source.mp4
bash showcase/scripts/encode-ocean.sh ocean-source.mp4
```

Needs a full ffmpeg with libx264. The Playwright-bundled ffmpeg is a stripped
VP8-only build and will not work.

## A note on verifying video locally

The sandboxed Chromium used for screenshots is built without proprietary
codecs: `canPlayType('video/mp4; codecs="avc1.42E01E")` returns empty, so an
H.264 `<video>` reports `error.code 4` and the poster stays up. That is an
artefact of the test browser, not of the asset. Do not "fix" it by switching
formats. Verify the file with ffprobe and check playback in a real browser.
