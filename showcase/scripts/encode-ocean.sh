#!/bin/bash
#
# Regenerates the hero ocean loop in showcase/public/media/.
#
# WHY THESE FILES ARE COMMITTED
# The hero is the first thing a visitor sees. Hotlinking a stock CDN for it
# means a third party we do not control can throttle, move, or block the most
# important asset on the site. So the encoded output is committed and served
# from our own origin, and this script exists so those binaries are
# reproducible rather than a mystery blob someone dropped into public/.
#
# SOURCE
# Pexels video 856204 (https://www.pexels.com/video/ocean-waves-856204/)
# Pexels licence: free for commercial use, no attribution required.
# 3840x2160, 25fps, 20.07s, ~54 MB.
#
# WHY THIS CLIP AND NOT A PRETTIER ONE
# The first choice here was Pexels 1093652, a golden-hour clip that looked
# better in a single frame. It is a continuous drone shot flying TOWARDS
# SHORE: rocks and wet sand enter frame by the end, so it never returns to
# where it started and therefore cannot loop. Crossfading its head over its
# tail ghosted rocks through open water. This clip is a locked-off shot of
# open water with no landfall, so it genuinely loops. Loopability beat
# prettiness, and the warmth was recovered in the grade below instead.
#
# THE FOUR DECISIONS WORTH KNOWING
# 1. Loop points. Chosen by searching every frame pair in the clip for the
#    smallest colour difference at >=12s apart (src[8.0] vs src[20.0], the
#    tightest seam in the clip). Do not hand-pick new ones by eye; rerun the
#    search in docs if the source ever changes.
# 2. Crossfade. A 0.5s dissolve over an already-matched pair, so the residual
#    seam disappears without the double-exposure a long dissolve would cause.
#    Output's first and last frame are both src[8.5].
# 3. Grade. The source is cold midday blue, which fights the warm soil and
#    persimmon palette. colortemperature=4400 lands on a warm-neutral pewter.
#    3800 was tested and goes sepia: the water stops reading as water.
# 4. Denoise + CRF. Sun glitter on open water is about the most expensive
#    thing there is to encode: every frame is full of moving high-frequency
#    speckle.
#
#    This used to be hqdn3d=6:5:8:6 at CRF 39 (~1.4 MB), justified by "under
#    the production colour treatment (brightness 0.7, scrim, grain, vignette)
#    the difference is not visible". THAT JUSTIFICATION EXPIRED. site.css has
#    since dropped the video to brightness(0.92), deleted the vignette, and
#    replaced the flat scrim with a mask — see the "Was brightness(0.7):
#    crushed" comment there. The heavy darkening that was hiding the
#    compression is gone, so at 1:1 the glitter had clumped into visible waxy
#    blobs on the brightest, most-looked-at part of the frame.
#
#    Re-measured at the CURRENT grade. The knee is CRF 34 with a LIGHTER
#    denoise: the old 6:5:8:6 was itself smearing the sparkle before x264 ever
#    saw it, and dropping to 4:3:6:6 is what buys back the individual glints.
#    Sizes on this clip: CRF 39/dn6 1.3 MB (smeared), CRF 34/dn4 4.2 MB,
#    CRF 30/dn4 8.8 MB, CRF 24/dn2 20.8 MB. CRF 34 sits right where the
#    returns flatten — side by side with CRF 24 it is very hard to separate,
#    and it stays inside the ~5 MB a hero background loop should cost.
#    -tune film + aq-mode=3 both matter here: they bias x264 toward keeping
#    fine texture instead of flattening the water into plastic.
#
# H.264 ONLY, DELIBERATELY, AND RE-CONFIRMED. An earlier revision shipped
# VP9/WebM on the usual "modern codec is smaller" reasoning and measured that
# it lost on THIS footage. That has now been re-tested against AV1 (SVT-AV1
# preset 6) at the new quality target, and AV1 loses too: size-matched at
# ~4 MB, libsvtav1 CRF 53 is visibly softer than x264 CRF 34 — the glints
# smear and the dark water loses definition. To merely match x264's quality
# AV1 needed ~7.5 MB. Dense high-frequency speckle is the one content type
# where AV1's advantages do not show up. H.264 also has universal hardware
# decode, which matters for a video that loops forever in the background of
# somebody's phone. Re-measure before adding a second codec.
#
# fps is deliberately left at the source's 25: resampling to 24 saves ~4% and
# risks judder, which is a bad trade.
#
# USAGE:  bash scripts/encode-ocean.sh [path-to-source.mp4]
# Needs a full ffmpeg with libx264. The Playwright-bundled ffmpeg is
# a stripped VP8-only build and will NOT work.

set -euo pipefail

SRC="${1:-ocean-source.mp4}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/media"

if [ ! -f "$SRC" ]; then
  echo "Source not found: $SRC" >&2
  echo "Download it with:" >&2
  echo "  curl -L 'https://videos.pexels.com/video-files/856204/856204-uhd_3840_2160_25fps.mp4' -o ocean-source.mp4" >&2
  exit 1
fi

mkdir -p "$OUT"

# body = src[8.5..20.0]; pre = src[8.0..8.5]; dissolve pre over body's tail.
# Output therefore opens and closes on src[8.5] and loops invisibly.
LOOP="[0]split[a][b];\
[a]trim=start=8.5:end=20,setpts=PTS-STARTPTS[body];\
[b]trim=start=8:end=8.5,setpts=PTS-STARTPTS[pre];\
[body][pre]xfade=transition=fade:duration=0.5:offset=11[lp]"
POST="colortemperature=temperature=4400,hqdn3d=4:3:6:6"

encode () {
  local H=$1 CRF=$2
  echo "→ ${H}p"
  ffmpeg -y -v error -i "$SRC" -filter_complex "$LOOP;[lp]$POST,scale=-2:$H[v]" -map "[v]" -an \
    -c:v libx264 -crf "$CRF" -preset slow -tune film -profile:v high -pix_fmt yuv420p \
    -x264-params "aq-mode=3:psy-rd=1.0,0.15:ref=4:bframes=6:me=umh:subme=9" \
    -movflags +faststart "$OUT/ocean-${H}.mp4"
}

encode 1080 34
encode 720 34

# The poster MUST be the loop's opening frame (src @8.5s) under the same grade,
# so the handoff from poster to playing video has nothing to flash between.
echo "→ poster"
ffmpeg -y -v error -ss 8.5 -i "$SRC" -vf "$POST,scale=-2:1080" -frames:v 1 /tmp/ocean-poster.png
ffmpeg -y -v error -i /tmp/ocean-poster.png -quality 62 "$OUT/ocean-poster.webp"
rm -f /tmp/ocean-poster.png

echo
echo "Done:"
ls -la "$OUT"
