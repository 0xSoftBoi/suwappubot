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
#    speckle. hqdn3d plus CRF 39 takes 1080p from 4.1 MB to ~1.4 MB, and under
#    the production colour treatment (brightness 0.7, scrim, grain, vignette)
#    the difference is not visible. Both were rendered through that treatment
#    and compared before this number was chosen.
#
# H.264 ONLY, DELIBERATELY. An earlier revision also shipped VP9/WebM on the
# usual "modern codec is smaller" reasoning. Measured on THIS footage it was
# not: VP9 needed so high a CRF to match H.264's size that it lost its quality
# edge, and matching quality cost 5.7 MB against H.264's 4.1 MB. So WebM would
# have doubled the committed bytes to serve a worse file to some browsers.
# H.264 also has universal hardware decode, which matters for a video that
# loops forever in the background of a phone. Re-measure before re-adding it.
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
POST="colortemperature=temperature=4400,hqdn3d=6:5:8:6"

encode () {
  local H=$1 CRF=$2
  echo "→ ${H}p"
  ffmpeg -y -v error -i "$SRC" -filter_complex "$LOOP;[lp]$POST,scale=-2:$H[v]" -map "[v]" -an \
    -c:v libx264 -crf "$CRF" -preset slow -profile:v high -pix_fmt yuv420p \
    -movflags +faststart "$OUT/ocean-${H}.mp4"
}

encode 1080 39
encode 720 39

# The poster MUST be the loop's opening frame (src @8.5s) under the same grade,
# so the handoff from poster to playing video has nothing to flash between.
echo "→ poster"
ffmpeg -y -v error -ss 8.5 -i "$SRC" -vf "$POST,scale=-2:1080" -frames:v 1 /tmp/ocean-poster.png
ffmpeg -y -v error -i /tmp/ocean-poster.png -quality 62 "$OUT/ocean-poster.webp"
rm -f /tmp/ocean-poster.png

echo
echo "Done:"
ls -la "$OUT"
