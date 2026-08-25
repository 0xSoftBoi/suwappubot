# Hero video hosting: why not YouTube/Vimeo, and why not 4K

Answering "can I host the hero ocean loop on Vimeo or YouTube in 4K?" — researched
Aug 2026. Short answer: **no to both platforms, and 4K is not the win it looks like.**
If the goal is getting the binary out of git, the answer is Cloudflare R2, which we
already have the account for.

---

## 1. The blocker that decides it: we'd lose the entire hero treatment

This is the site-specific reason, and it outranks every generic pro/con.

The hero's look is built almost entirely out of CSS applied **to the `<video>`
element itself** (`showcase/src/app/site.css`):

| Property | What it does here |
|---|---|
| `object-fit: cover` | fills the stage at any viewport |
| `object-position: 50% 72%` | lifts the horizon to the CTA row (see the comment there) |
| `filter: saturate(.9) brightness(.92) contrast(1.02)` | the grade |
| `mask-image` on `.home-ocean` | fades the footage out into the page instead of a flat scrim |

**`object-fit` and `object-position` have no effect on an `<iframe>`.** Neither
platform gives you the video element — you get their player in a sandboxed frame.
You'd fake cover-fit with an oversized wrapper plus a resize listener, lose
`object-position` entirely (so the 72% reframe goes away), and any `filter`/`mask`
would have to move to the wrapper, where it also clips the player's own chrome.

We'd be rebuilding a worse version of what already works, in JS, to save ~4 MB.

## 2. YouTube: also a terms problem, not just a taste problem

- **The pattern is against YouTube's developer policies.** They explicitly bar
  obscuring or overriding player controls — which is exactly what a chromeless
  background video is. ([policies](https://developers.google.com/youtube/terms/developer-policies-guide))
- **Ads can play on embeds**, and the policy forbids blocking them. An ad in the
  hero is a real failure mode, not a hypothetical.
- `modestbranding` has been **deprecated since Aug 2023**.
- `youtube-nocookie.com` does **not** remove the cookie-consent obligation — it
  still sets a cookie on play and writes a device ID to localStorage on load.
- **~1.3 MB across ~22 requests** and ~480 ms of main-thread JS for one embed, all
  competing with LCP. ([web.dev](https://web.dev/articles/embed-best-practices))
- Facade tricks (`lite-youtube-embed`) don't apply: they trade autoplay for a click,
  and a background video has to start on its own.

There is no officially supported background-video mode on YouTube at all.

## 3. Vimeo: legitimate, but still the wrong shape

Vimeo does have a real `background=1` embed (chromeless, muted, looping) on any
paid plan (~$144/yr). It's a genuine product, not a hack. But:

- Still an iframe → §1 applies in full.
- Adaptive streaming **ramps quality up from low on start**, so the hero visibly
  pops from soft to sharp on every load. That's worse than what we ship now, where
  the poster and the video's first frame are the same graded frame specifically so
  the handoff has nothing to flash between.
- Exact tier for full logo removal isn't published as a clean matrix — Vimeo's docs
  say "paid plans", third-party trackers disagree on Starter vs Standard.

## 4. Licensing: re-uploading is the risky part

The footage is Pexels 856204. The Pexels license says **"don't redistribute or sell
the photos and videos on other stock photo or wallpaper platforms."**

Re-uploading a re-encoded, graded, re-cut version to a public YouTube or Vimeo
channel sits in a grey zone — those aren't stock platforms on a strict reading, but
the clause's intent is "don't let people re-source the clip from you elsewhere," and
a public video page is exactly that. Self-hosting is unambiguously the permitted
case: using it in a project.

This risk is created *only* by the platform-hosting idea. It doesn't exist today.

## 5. 4K: measured, and it isn't worth it

What the hero actually needs, measured in-browser against the live page:

| Device | CSS box | Source px actually needed |
|---|---|---|
| Laptop 1440 @1x | 1512×914 | ~1722 |
| **MacBook 1440 @2x** | 1512×915 | **~3448** |
| Desktop 1920 @1x | 2016×945 | ~2137 |
| QHD 2560 @1x | 2688×992 | ~2849 |

So retina laptops *are* the one real case for more pixels — they display ~3448 device
px of ocean from a 1920-wide source. But what that argues for is **1440p, not 4K**,
and even that is doubtful, because on this particular hero the footage is:

- masked to fully transparent by 96% down the stage,
- radially scrimmed to 88% opacity over the copy column,
- overlaid with grain,
- and moving water at 25 fps, where the eye can't resolve fine speckle anyway.

Cost of the extra pixels, encoded at our current settings (CRF 34, `-tune film`):

| | Size |
|---|---|
| 1080p (shipping) | 4.0 MB |
| 1440p | 7.3 MB |
| **2160p (4K)** | **16.7 MB** |

4x the bytes for detail the design deliberately obscures. And neither platform lets
you *force* 4K anyway — `vq` is documented as overridable and `setPlaybackQuality()`
is unreliable, so you'd ship 4K and still be served whatever ABR decided.

## 6. If the real goal is "get the binary out of git" — use R2

That's a fair goal (the mp4s are ~6 MB of the repo) and it doesn't require an
iframe. Point the existing `<video>` tag at a CDN URL and every bit of §1 keeps
working.

We already run `suwappu.bot` on Cloudflare (free plan + edge Worker, see
`cloudflare/README.md`), and `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`
already exist in the codebase.

- **Cloudflare R2** — zero egress fees, ~$0.015/GB/mo storage. For ~6 MB of static
  mp4 this is effectively free, and it's a plain URL in a plain `<video>` tag.
  **This is the pick**: for one short static loop you want a file on a CDN, not an
  adaptive streaming product.
- Cloudflare Stream ($5/1000 min stored, $1/1000 min delivered) and Bunny Stream
  (~$1/mo min) are both fine but solve a problem we don't have — ABR ladders for
  long videos. They'd also reintroduce the quality-ramp issue from §3.

Tradeoff to accept: the asset stops being reproducible from a clean checkout, and
`scripts/encode-ocean.sh` would need to end in an upload step. The current comment
block in that script explains why the files are committed — that reasoning would
need updating, not deleting.

---

## Verdict

| Option | Verdict |
|---|---|
| YouTube embed | **No.** ToS, ads, cookies, 1.3 MB, no background mode. |
| Vimeo embed | **No.** Legitimate product, but kills the CSS treatment and adds a quality ramp. |
| 4K | **No.** 16.7 MB for detail the mask/scrim/grain removes; can't be forced on either platform anyway. |
| 1440p self-hosted | **Maybe.** 7.3 MB, the only genuine retina argument. Ask whether it's worth +3.3 MB. |
| R2 + existing `<video>` | **Yes, if the goal is repo size.** Keeps everything working. |
