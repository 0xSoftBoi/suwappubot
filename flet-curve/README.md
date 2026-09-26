# Curve — Flet

An alternative Curve Finance UI, written once in Python and running both as a
**static website** (MetaMask/Rabby/WalletConnect) and as a **native desktop app**
(Frame/qeth over localhost JSON-RPC).

It lists every pool on a chain, sorts by volume, TVL, incentives or base APY,
and opens each pool onto a candlestick chart plus a panel that can deposit,
withdraw, swap and stake in that pool. A **Swap tab** routes any coin to any
coin *across* pools, through
[electric-router](https://github.com/michwill/electric-router) — solver and EVM
compiled to WebAssembly and run in the browser. See
[The Swap tab](#the-swap-tab).

```bash
git submodule update --init          # curve-assets, and electric-router
uv venv && uv pip install -r pyproject.toml --group dev
.venv/bin/python tools/build_assets.py   # compile the subset the app needs
.venv/bin/python tools/build_router.py   # the router: package, caches, wasm
.venv/bin/python tools/build_router.py --native   # and its desktop extensions
.venv/bin/python tools/build_icons.py    # only when the mark changes: app icon + favicon

.venv/bin/flet run src/main.py        # desktop -> Frame / qeth on 127.0.0.1:1248
.venv/bin/flet publish --route-url-strategy hash   # browser -> ./dist (from the repo root)
python tools/serve.py                # serve ./dist with caching off
```

`--route-url-strategy hash` is not optional and `pyproject.toml` cannot carry
it — see [Routes live in the fragment](#routes-live-in-the-fragment). Without
it the build works on `tools/serve.py` and 404s every deep link on a gateway.
`tools/publish_ipfs.py` passes it for you and refuses to upload a build that
came out otherwise.

To offer **WalletConnect** in the browser build, give it a projectId (free,
from [dashboard.reown.com](https://dashboard.reown.com)):

```sh
cp src/local_config.example.toml src/local_config.toml   # then fill in project_id
```

That file is gitignored and read at build time -- `flet publish` bundles it, so
there is no post-build step to forget. Without it the WalletConnect connector
simply does not appear; injected wallets (MetaMask, Rabby, Frame, qeth) work
either way.

**A session is proposed once, at connect time, with every chain it may ever
use.** A chain left out cannot be switched to afterwards: the wallet answers
"the chain is not approved or the wallet does not support
`wallet_switchEthereumChain`", and a Safe says the dApp does not support its
network.  TAC arrived at exactly that, being on neither of the two lists kept
by hand -- `wallet/chains.py`, which is five chains with explorers and tokens
for the pay flow, nor `wallet_bridge.js`'s own fallback.  So the proposal is
now what the *picker* offers, pushed to the bridge as a default when the chain
list lands: 26 chains rather than 5, and it cannot drift from what someone can
actually pick.  A `[walletconnect] chains` in `local_config.toml` still wins.

### Testing WalletConnect without a phone

WalletConnect looks untestable — it wants a projectId, a relay and a phone to
scan a QR code — and two real bugs lived in it for exactly that reason: a
reconnect that returned an unwrapped provider, and a disconnect that never
ended the pairing. Both are invisible on the first connect, which is the only
one anybody tests by hand.

There is a seam. The bridge reads its module URL from
`config.walletConnectModuleUrl` rather than hardcoding esm.sh, so a stub can be
put in its place: `tools/fake_walletconnect.js` exports an `EthereumProvider`
with the same four methods the bridge uses and records every call on
`window.__wc`. Serve a build with

```html
<script>window.FLET_PAY = {walletConnectProjectId: "test-project",
                           walletConnectModuleUrl: "./fake_walletconnect.js"};</script>
```

before `wallet_bridge.js` in `index.html`, copy the stub next to it, and the
whole lifecycle is drivable from a headless browser. What the counters should
say, connecting then disconnecting then connecting again:

    on load       null                        module never fetched
    connect       init 1, enable 1            the QR was offered
    disconnect    disconnect 1                the pairing was ended
    reconnect     init 2, enable 2            the QR was offered again

Every one of those was wrong at some point, and each is one integer.

The wallet layer is [`flet-pay-example`](https://github.com/michwill/flet-pay-example)'s
`wallet/` package. Its README is the reference for how the EIP-1193 seam and the
browser bridge work; this one covers what was added on top. Four changes were
made to it here:

- **the desktop transport polls.** An HTTP endpoint cannot push, so switching
  account in Frame or qeth used to change nothing on screen. `desktop.py` now
  asks every four seconds and synthesises the same `accountsChanged` /
  `chainChanged` events a browser wallet sends -- `Wallet` cannot tell which
  transport it is on.
- **`disconnect` counts as a disconnection.** An extension revokes a site with
  an empty `accountsChanged`; WalletConnect closes the session and sends
  `disconnect`. Only the first was handled.
- **disconnecting is remembered.** A desktop build connects at startup by
  design -- a local wallet raises no popup -- which meant relaunching undid
  a deliberate disconnect. `wallet/consent.py` leaves a marker; connecting
  removes it.
- **the connection survives the tab closing.** The bridge remembers which
  wallet was used (by `rdns`, since an EIP-6963 uuid is regenerated per page
  load) and `Wallet.restore()` picks it up on the next load -- asking
  `eth_accounts`, never `eth_requestAccounts`, so a page that opens by
  itself never opens a wallet dialog by itself. Disconnecting forgets it.
- **one bridge serves an origin.** A `BroadcastChannel` reaches every tab, so
  two tabs of this app meant two bridges answering one request -- and the
  faster one won, which is how a picker ended up listing another tab's
  wallets and a selection landed somewhere the account request did not.
  `wallet_bridge.js` now takes a Web Lock and only the holder answers;
  replies and wallet events are addressed to the client that asked. The
  browser passes the lock on when that tab closes.

Serve the build with `tools/serve.py` rather than `python -m http.server`:
the latter sends no cache headers, Chrome caches heuristically, and a reload
happily keeps running the *previous* `app.tar.gz`. That is worth a script
because the failure looks exactly like a fix that did not work.

## Publishing it to IPFS

The whole app is static, so it pins as a directory. `tools/publish_ipfs.py`
publishes, makes the build portable, and uploads it to Pinata:

```sh
python tools/publish_ipfs.py               # flet publish, then pin ./dist
python tools/publish_ipfs.py --no-build    # pin the dist/ already there
python tools/publish_ipfs.py --dry-run     # everything up to the upload
```

### Pin, prove, *then* move the name

**Pinning publishes nothing.** Pinata holds the bytes and announces provider
records into the DHT; no gateway receives a copy. Until those records are
out, a gateway asked for a block finds nobody to ask and times out. The root
CID is one record and goes first — which is why a fresh pin serves
`index.html` in half a second while individual files 504 for a good while
after, and why that reads as a broken site when it is a healthy one.

The trap is that **the first request through a gateway is what gets cached,
failures included.** Point ENS at a CID before its records are out and your
own first visit teaches that gateway a 404 which then outlives the
propagation that caused it. Waiting does not clear it; only the cache TTL
does.

So `publish_ipfs.py` prints the CID the moment the upload lands — that part
succeeded and is worth having whatever follows — and *then* watches the
network catch up, fetching the first byte of every file a visitor needs to
boot. 92 of them; the 6,716 token marks are skipped because they are lazy,
and hammering a public gateway for art nobody has asked for is not a check.

```
  CID  bafybeieq4psvxedxh37qdi3nzflz27varghalxbwgtn3wvci4plbwvbe5i
       https://bafybeieq4…be5i.ipfs.dweb.link/
       ipfs://bafybeieq4…be5i/

waiting for the network to find it: 92 files, via
  https://bafybeieq4…be5i.ipfs.dweb.link
  [#####################-------]   71/92 retrievable   3m53s
```

The bar redraws in place on a terminal and prints one line per pass when it
is piped, so a CI log stays readable. **Ctrl-C is a supported way to leave**
— the pin is done, only the waiting is not — and it tells you how to pick up
where you stopped:

```sh
python tools/publish_ipfs.py --verify-only <cid>
```

It verifies against a **CID** URL, not the ENS name, on purpose: proving it
must not be what poisons the cache of the hostname you are about to publish.

**Which CID gateway is decided per run**, not hardcoded. `dweb.link` was, and
three publishes in a row sat at 0/58 on it — one for over an hour — while the
pin was fine. So the run asks each candidate for one small file, in preference
order, and proves the pin on the first that hands it back: 12 seconds each,
because a gateway that can serve it takes under one and a gateway that cannot
takes 28. `--verify-gateway` still overrides, and is not second-guessed.

**It compares the bytes, and that part is not optional.** The first version of
this asked for a status code, picked `inbrowser.link`, and reported 58/58 in
one second — on a pin that no third party could serve at all. inbrowser.link,
`w3s.link` and `nftstorage.link` are *service-worker gateways*: they answer 200
with an HTML bootstrap for every path and do the IPFS retrieval inside the
visitor's browser. To anything that is not a browser they cannot fail, which
makes a status-code check on them worse than no check. The probe fetches
`version.json` — 92 bytes, in every build — and requires it to *be*
`version.json`.

The list is a list, rather than a swap, because of the run before that:
`ipfs.runfission.com` was used once to prove a pin healthy when dweb.link was
failing, and it has since stopped being an IPFS gateway at all — the domain
now redirects to an unrelated site. Any single name will do this eventually.

**But a pass there does not mean eth.limo can serve it**, and this is the
part that bit us. `dweb.link` is Cloudflare-fronted and answers
`max-age=29030400, immutable`; it was caught serving with `age=3266`, i.e.
from its own cache, an hour after fetching a build once. So the pre-ENS pass
proves *some gateway holds these bytes* — worth knowing, and not the question
a visitor asks. eth.limo's nodes do their own provider lookups over a
different path, and that path fails intermittently.

You cannot check it earlier, either. eth.limo has **no CID gateway**:

```
https://<cid>.ipfs.eth.limo/   DNS does not resolve
https://eth.limo/ipfs/<cid>/   404
```

It serves ENS names and nothing else, so its retrieval path cannot be
exercised until the name points at the CID. Hence a second stage, after the
ENS update — which **the same run waits for**. The script cannot move the
contenthash, that being a wallet signature, so it watches for it instead:

```
set the ENS contenthash to:
  ipfs://bafybeig4zz…mlkq

watching https://curve.eth.limo for it -- Ctrl-C to stop and warm later
  still bafybeieq4p…be5i   0m30s
  still bafybeieq4p…be5i   1m00s
  https://curve.eth.limo is serving it after 1m30s

warming the gateway people use: 77 files, via
  https://curve.eth.limo
  [############################]   77/77 retrievable   0m19s
```

It knows because every eth.limo response says which CID it resolved:

```
x-ipfs-roots: bafybeig4zzt5yofgwdpbval6p3osa3kbf4tidnnxjttjvbtwsyuf3xmlkq
```

That is a gate rather than a pause: warming before the name moves would
faithfully warm the *previous* build. `--no-warm` stops after the verify,
and `--warm` on its own picks the second stage up later — Ctrl-C during the
wait says so, and the pin is verified either way.

Fetching **is** the fix: a block pulled through an edge lands in that edge's
store, so the loop that measures the problem removes it, and the first real
visitor gets a warm cache instead of a coin flip. It reads whole files rather
than first bytes — a file is many blocks, and sampling block one warms block
one — two at a time, because eight parallel probes earned a run of 503s from
eth.limo's rate limiter, which then looked exactly like the fault being
chased.

Measured on one file, minutes apart, on a pin that had verified clean:

```
app-package.json   504 unfound (17.4s)  ->  206 served (1.0s)  ->  504 unfound
```

Not size, either: the 4 KB icon font failed the same way and left every glyph
on the page a tofu box.

**Warming is a mitigation, not a cure.** eth.limo answers `max-age=300` and
runs several edges, so a visitor arriving tomorrow on a cold one gets the
same coin flip. The durable fix is more peers that can answer — your own
node, or a second pinning service.

### The warmer asks the registry first

`warm_ipfs.py` reads `curve.eth`'s contenthash from the ENS registry on
Ethereum — `resolver(namehash)` then `contenthash(namehash)`, two `eth_call`s
against a public endpoint — and waits for each gateway to serve *that* CID
before warming it.

This is not tidiness. eth.limo and eth.link cache their own ENS lookups for
minutes, so a warm started the moment the transaction lands pulls the build
being replaced through the edge, and looks from the outside like a warm that
did nothing. It happened, and the way it was found was reading `x-ipfs-path`
by hand. A gateway cannot be its own witness for "have you noticed the name
moved?", so the question goes to the chain.

`namehash` runs on `wallet.erc20.keccak256`, the pure-Python one the app
already carries because Pyodide has no wheel for a hash. `--cid` warms a CID
you name instead; `--no-wait` skips the registry entirely and warms whatever
is being served. A registry nobody can reach is a reason to skip the wait,
not to skip the work — the run says so and warms anyway.

### Warming again, later

Warming *decays*, and that is measured rather than feared: `main.dart.wasm`
is in the boot set and was warmed on the 15th, and on the 18th eth.limo
answered 504 for it after seventeen seconds. So there is a second script
that does nothing but warm, safe to run at any time and as often as
patience allows, because it only asks for files that are already published:

```
python tools/warm_ipfs.py                 # everything a visitor fetches
python tools/warm_ipfs.py --no-boot       # just the logos
python tools/warm_ipfs.py --boot-only     # just what decides it loads at all
python tools/warm_ipfs.py --tiers all     # every compiled size
python tools/warm_ipfs.py --chains xdai   # one chain's marks
```

**"Warmed" has to mean everything a visitor fetches**, which this did not
mean for one release and cost an afternoon. The boot set used to be opt-in
here on the grounds that it was 85% of the weight and that publishing warmed
it anyway. Both stopped being true: dropping canvaskit/ and pyodide/ took
54 MB out of it, and publishing only warms it if the run reached its warm
stage — which sits behind `wait_for_ens`, on one gateway, so a name moved by
hand after the script gave up leaves it cold.

What that looked like: a build published *and* warmed, with a 4 KB icon font
answering 504 after 17.6 seconds. Chrome drew the app with holes where every
glyph should be; Falkon did not load it at all. So the boot set is back in
the default run, and `publish_ipfs.py` now ends by naming this script.

```
boot set      59 files   21.2 MB    decides whether it loads
bundles      140 files   11.0 MB    decides whether it looks right
loose marks 3,358 files  10.9 MB    --all-marks, the fallback behind those
```

**It warms the bundles, not the loose marks.** A browser fetches one pair
per chain now, so that pair is what needs to be warm — 136 files and 11 MB,
against 3,358 marks and 22 MB behind them. The loose files stay reachable as
the fallback and `--all-marks` warms those too, eventually rather than first.

**With the network marks the exception**, at every tier and without being
asked. Their fallback is not a rainy-day path: the picker's field is built
in `CurveApp.__init__`, before any bundle can exist, and it asks for the top
tier because a decoration box stretches it. 160 files and 444 KB, for the
one family that appears on every screen.

Boot files come first within a run: they decide whether the site loads,
where the marks only decide whether it looks right, so an interrupted run
should have bought the first. `--no-boot` skips them for a run that only
wants the logos, and `--boot-only` is the fastest way back from a publish
that left the site dark.

It differs from `publish_ipfs --warm` in two ways, both deliberate.

**Both gateways.** `eth.limo` and `eth.link` are separate infrastructure
with separate caches behind one name, and a visitor does not choose between
them, so warming one leaves half the audience where it started. Measured on
the boot set, they fail and recover independently:

```
https://curve.eth.limo: 77 files       https://curve.eth.link: 77 files
  76/77 retrievable   0m45s              76/77 retrievable   0m35s
  77/77 retrievable   1m16s              76/77 retrievable   1m17s
                                         77/77 retrievable   1m40s
```

**The token marks**, which publishing deliberately skips. `LAZY_DIR` is
right that 6,716 files is an imposition to check on *every publish* — but
that reasoning is about publishing, and a job that runs occasionally can
afford what a deploy-time check cannot. Those files are also the ones
nothing had ever warmed, which is why a missing coin logo was the most
visible form this bug took. Marks are asked for at the two tiers real
screens land on (see `MARK_TIERS`); `--tiers all` does the other two.

The boot set goes first, so a run stopped after ten minutes has bought the
files that decide whether the site loads rather than a scatter of logos. A
non-zero exit means something is still cold, so a scheduled run can be
noticed when it stops being enough — except for a 404, which means `dist/`
has drifted from what is pinned and you are warming the wrong list.

**It reports every 64 files rather than once per pass.** A pass over the
77-file boot set is 45 seconds and reporting per pass is right; a pass over
3,435 files is **34 minutes** of an apparently frozen terminal, which is
exactly how the first version of this got reported as a hang.

**And it measures its rate rather than predicting it**, because two
readings of the same gateway hours apart came in at 686 KB/s and 2 KB/s — a
spread of three hundred times, where a prediction from either end would be
a confident lie about the other. So the line shows throughput and a
remaining time drawn from it, and both self-correct:

```
https://curve.eth.limo: 3358 files, 10.9 MB, 8 at a time
  [####------------------------]   512/3358 retrievable   3m20s  4.5 files/s  15 KB/s  ~10m left
```

**Files a second leads, and that is not cosmetic.** A mark is 3.2 KB and
its transfer takes 0.0001s against a 0.6s time-to-first-byte — the whole
cost is the gateway's lookup, so you would need 308 files a second to show
1 MB/s. A perfectly healthy run reported only in bytes advertised
"8 KB/s", which reads as a broken connection.

**The marks get eight workers, the boot set two.** Two was measured pulling
multi-megabyte boot files, where eight at once earned a run of 503s. A 3.2
KB mark is a different load, so it was re-measured — three disjoint slices
of forty cold marks, one per setting:

```
2 workers   0.59 files/s   67.9s   throttled 0
4 workers   0.71 files/s   56.3s   throttled 0
8 workers   1.11 files/s   35.9s   throttled 0
```

Nothing was throttled at any of them, and eight is nearly twice as fast. It
scales less than linearly because a fifth of cold marks answer 504 after
seventeen seconds whatever the concurrency — that is the block not being
found, and asking harder does not find it. `--workers` overrides either
default.

`--deadline` bounds each gateway rather than the whole run, and says how
many files it did not reach.

**A slow failure and a fast one are different diseases**, and the report
separates them, because only one of them is about time:

```
504 after ~17s   the block's providers are not announced yet -- retry
503 in ~0.2s     the gateway is rate-limiting us -- back off, then retry
404 in ~0.3s     the gateway is refusing this file -- waiting never helps
```

The middle one is separated from the bottom one because both are fast and
only one is about the file. Filed as a refusal it would never be retried,
and our own request rate would be reported as the gateway declining to serve
the app.

### One request per chain, not one per coin

The 6,716 mark files were 96% of the build's file count and the reason a coin
logo goes missing: each is fetched cold from a gateway on first demand, and
about a fifth of cold fetches answer 504 after seventeen seconds. So they are
also shipped concatenated, one file per chain per tier:

```
curve/tokens/xdai/marks@80.bin     105 KB, 25 marks end to end
curve/tokens/xdai/marks@80.json    where each one starts
```

**The PNGs are concatenated unchanged**, so every slice is already a valid
PNG — nothing is decoded at build time and nothing needs a decoder in
Pyodide. Verified byte-for-byte against the originals: 627/627 on Ethereum.

**Each slice reaches `ft.Image` as a `data:` URI, never as bytes.** `src` is
typed `str | bytes` and both draw on Blink, so `src=<slice>` shipped and the
marks vanished on every iPhone: WebKit paints an `Image` built from bytes as
nothing at all, and raises no error, so `error_content` does not stand in
either — a blank the size of a logo, on the one engine iOS allows. The same
PNG base64'd into a `data:` URI draws on both. Base64 costs a third more
memory than the raw slices; a missing logo costs the logo.

`.bin`, because gateways refuse archives **by suffix** — `.zip` or `.tar`
here would be silently unreachable.

**The network marks share one bundle too**, at `curve/chains/`: 160 files
and 444 KB down to two, 115 KB at tier 80. Same machinery, no ranking and no
split — the picker draws all 34 the moment it opens, and one file that size
is not worth two requests.

**And the picker is built again once it lands.** Its options are built in
`__init__` and again the moment the API names its chains, which is one small
request racing the two the bundle needs; whichever wins, the options built
first hold URLs and keep them for the session. Rebuilding costs one control
tree and no requests, and it is the difference between fetching the bundle
and drawing it.

**Ethereum ships two bundles**, because one of them was the first paint. It
has 627 marks where the next largest chain has 151, and nothing drew until
all 2,852 KB had landed:

```
marks@80.bin       658 KB   the 150 hottest tokens -- awaited
marks@80-rest.bin 2194 KB   the other 477 -- arrives behind it
```

Hot means how many pools hold a token, over pools ordered by volume, so it
is what a visitor is most likely to see rather than what is most valuable.
150 covers 93% of the marks on the first page for a quarter of the bytes.
Only chains past `SPLIT_ABOVE` are split; everything else is one file, and a
build that cannot reach the API to rank tokens says so and bundles whole.

**The tier a phone asks for is not always one that exists**, and getting
that wrong meant mobile had no bundles at all. A mark is drawn at 27 logical
pixels, so `mark_tier` rounds a 3× screen up to 160 — which is not bundled.
The fetch 404s, every mark drops back to its own file, and one cold block is
a missing logo: which is exactly how a USDC icon went missing on Gnosis on a
phone while the desktop beside it was fine.

`bundle_tier` clamps to the largest tier that exists, so a fetch always asks
for a bundle that is there:

```
ratio   device px   wants   gets
    1          27      40     40
    2          54      80     80
    3          81     160     80      <- clamped, 1.01x magnification
    4         108     160     80      <- clamped, 1.35x
```

At 3× — most phones — tier 80 art on 81 device pixels is essentially 1:1. A
true 4× screen is softer than ideal and far better than an absent logo.
Bundling 160 as well would serve both exactly and cost 19.1 MB of pin.

**Going through the same function is not the same as agreeing**, which is
the next form the same bug took. One directory is fetched at one tier and
read at several: the fetch picks its tier from `MARK_SIZE`, the 27px a coin
is drawn at in the list, while the network marks come out of that store at
18px and the picker's own field asks for the top tier because a decoration
box stretches it. At a ratio of 1.5 or 2 those round to different tiers — 80
written, 40 asked for — so an exact lookup missed, every network logo fell
back to its own unwarmed file, and one cold block was a blank circle in the
open menu. Ratios of 1, 2.25 and 3 happen to agree, which is what made it
look like weather.

So a mark is served from the smallest tier *that was actually fetched* and
still covers it, and from the largest fetched one when none does. Art in
hand beats a request, and the worst case is a reduction slightly past 2:1.

**Only tiers 40 and 80 are bundled**, and that is the whole design tension: a
bundle is a second copy, so bundling all four would double 31.4 MB of marks
and hand back most of what dropping canvaskit/ won.

```
tier    marks    bundle
  20     1.4       --
  40     3.2      3.2
  80     7.7      7.7
 160    19.1       --      19 MB for the rarest device ratio
```

Those two are what `mark_tier` rounds up to for a 22–34px mark at 1×, 2× or
3×. A 4× screen and the 14px marks fall back to individual files and lose
nothing but the single request.

**A cold bundle takes every mark on the page with it**, so it is asked for
twice. One request replacing 627 is also one request that can fail, and a
gateway which cannot find a block inside its retrieval budget answers 504
after about seventeen seconds — where the ask is itself what warms it.
Measured on the published site:

```
/curve/tokens/ethereum/marks@80.bin   504 unfound  17.7s   <- every phone
/curve/tokens/ethereum/marks@40.bin   200 served    1.0s   <- a 1x desktop
/curve/tokens/ethereum/marks@80.bin   200 served    1.1s   <- asked again
```

A mark is drawn at 27 logical pixels, so **the tier depends on the screen**:
a 1x desktop asks for 40 and every phone asks for 80. One cold block in the
tier nobody's laptop touches reads as "the icons are missing on mobile and
fine on the desktop beside it", which is exactly how it was reported.

The second ask is *behind* the first paint, not in front of it — seventeen
seconds of blank rows is the other way this shows up, and waiting twice
would be thirty-four. It is also bounded at two: a chain with no tail 404s
there, and that must not be re-asked on every reload.

**Nothing here may break a page.** A build with no bundles, a gateway that
will not serve one, a truncated index, a token that is not in it — all of
them return zero and every mark fetches its own file exactly as before, with
its retry intact. Desktop skips bundles entirely; it reads marks off its own
disk, where there is nothing to save.

```
                              files      MB
started at                     6971   108.3
after dropping CDN copies      6938    54.5
plus mark bundles              7074    65.6
```

### Half the pin was never fetched

```
before   6971 files   108.3 MB
after    6938 files    54.5 MB     canvaskit/ 38.5 MB, pyodide/ 15.3 MB
```

Neither is reached from the pin. A real page load makes 124 requests and
takes canvaskit from **gstatic** and Pyodide from **jsDelivr**. That is not
read off the network but out of the build, because Flet decides it and
writes the decision down — `flutter_bootstrap.js`:

```js
if (flet.noCdn) {
    flutterConfig.canvasKitBaseUrl = flet.canvasKitBaseUrl;
    flutterConfig.fontFallbackBaseUrl = flet.fontFallbackBaseUrl;
}
```

With `noCdn` false that branch never runs, so the `canvasKitBaseUrl:
"/canvaskit/"` sitting in `index.html` is inert and Flutter falls through
to the CDN. Halving the pin halves propagation, verification, warming, and
the surface on which a cold block can fail.

**`flet publish --no-cdn` reverses it**, and `cdn_build` asks the build
rather than assuming, so a self-contained publish keeps both directories
automatically. That is a real choice rather than a fallback: an app on IPFS
that needs gstatic is not reachable where gstatic is blocked. Right now the
pin has neither property — 54 MB pinned that nothing can reach for.
`--keep-cdn-copies` forces the old behaviour.

**`main.dart.wasm` stays**, which is the one that looks droppable and is
not. The build ships two targets:

```json
{"compileTarget":"dart2wasm","renderer":"skwasm","mainWasmPath":"main.dart.wasm"},
{"compileTarget":"dart2js","renderer":"canvaskit","mainJsPath":"main.dart.js"}
```

A WasmGC-capable browser takes the first and fetches that 8.4 MB from *our*
origin; only the skwasm renderer beside it comes from the CDN. It answered
504 once during this work, which is exactly what the warmer is for.

### What an IPFS gateway will not serve

Archives, broadly — not an eth.limo quirk; gateways decline them generally,
presumably so a pin cannot be used as a file-distribution host. **The rule is
the final extension, from a deny-list**, and nothing else:

```
refused:  .zip .tar .tgz .7z .rar .bz2 .xz .zst .jar
served:   .bin .png .json .dat .pack .gz .tar.gz .whl
```

Measured against eth.limo and eth.link, which agree exactly. `.tar.gz` serves
because its final extension is `.gz`; `.tar.bz2` and `.bin.tar` do not.

That question stood open for a long time, because every measurement moved
more than one variable at once:

```
gateway-probe.tar.gz      6 bytes, text        served
app.tar.gz              ~400 KB, real gzip     refused
packaging-*.whl           96 KB, real zip      served
python_stdlib.zip        2.5 MB, real zip      refused
```

Read the first pair and the bytes decide; read the second and the suffix
does; read the sizes and a threshold explains all four. The answer was to
stop designing an experiment and **ask for a file that does not exist**:

```
definitely-absent.zip    18B   "Resource Not Found"
definitely-absent.bin   220B   "failed to resolve /ipfs/<cid>/…: no link named"
```

A file that is not in the pin has no bytes and no size, so the only thing
that can tell those two apart is the name. The first response is canned and
arrives before the path is resolved at all; the second is the IPFS resolver
reporting honestly. And all four rows above fall out of it: `app.tar.gz` is
renamed to **`.tgz`** before pinning, which is denied, while the wheel is a
genuine zip under an allowed suffix and is served — so the **content is
never sniffed**, and neither is the size (`main.dart.js` is 9.5 MB).

This replaced a probe matrix that bolted five files and 9 MB onto every
publish and still could not separate the three explanations, because a file
that exists carries a size and a content along with its name. `--probe` now
asks both gateways directly, writes nothing, pins nothing, and takes a
second:

```
python tools/publish_ipfs.py --probe
https://curve.eth.limo refuses: .7z .bz2 .jar .rar .tar .tgz .xz .zip .zst
  and serves: .bin .dat .gz .json .pack .png .tar.gz .whl
```

One correction fell out of it: `.gz` had been on the refused list for as
long as the question was open, on the strength of `app.tar.gz` — and `.gz`
is served.

The only file that catches today is `pyodide/python_stdlib.zip`, and it is
**harmless**, for a reason worth knowing on its own: the published app does
not load Pyodide from the pin at all. `flet publish` overwrites its own
template default —

```js
pyodideUrl: "/pyodide/pyodide.mjs",                       // the template
flet.pyodideUrl="https://cdn.jsdelivr.net/pyodide/…";     // what publish writes
```

— so Pyodide and its standard library come from **jsDelivr**, and the 15 MB
`pyodide/` directory in the pin is never read. curve.eth.link loads fully
with that file 404ing throughout.

`refused_by_gateway` therefore prints a note and does not block. Predicting
damage to the app from a filename is how an accurate observation about one
file became a check that would have stopped a working publish; `verify`
measures the pin instead of guessing from it.

**That CDN dependency is worth its own look.** A build pinned to IPFS for
censorship-resistance that cannot start without jsDelivr has given most of
that away, and `flet.noCdn` is the switch. Turning it on would make the
bundled copy load-bearing — and would make the `.zip` refusal above matter
for the first time, so the two changes go together.

It builds with `--app-short-name`, which a plain `flet publish` does not:
the manifest's short name otherwise falls back to the *project's* name, so
an installed shortcut is labelled "flet-curve" on an Android home screen.

**The key does not go in `src/local_config.toml`.** That file is under `src/`
so that `flet publish` bundles it -- which is exactly why a real credential
cannot live there: it would be served to every visitor, and pinning it puts
it somewhere with no unpublish. It says as much in its own header. Put the
Pinata JWT at the repo root instead, or in the environment:

```sh
cp local_secrets.example.toml local_secrets.toml   # gitignored; then fill in jwt
export PINATA_JWT='...'                            # or this, which wins
```

The script greps the build for whatever key it is about to authenticate with
and refuses to upload if it finds it -- in a loose file or inside
`app.tar.gz`, which is where `src/local_config.toml` ends up. The difference
between the safe file and the unsafe one is one path component and the
mistake cannot be taken back, so it is checked rather than documented.

Two more things it does, both because a gateway serves a site under a
sub-path (`/ipfs/<cid>/`) rather than at a root:

- **`<base href="/">` becomes `<base href="./">`.** Otherwise the bootstrap,
  the wasm, canvaskit and `app.tar.gz` are all fetched from the gateway's
  root, where none of them are: a blank page and a pile of 404s. Relative is
  identical at a real root, so the local server is unaffected. The app's own
  asset URLs need nothing -- `ui/assets.py` builds them from the worker's
  `location`, which is already the right prefix.
- **it asks for a CIDv1.** Base32 and case-insensitive, so it fits in a
  hostname and `https://<cid>.ipfs.dweb.link/` works; a v0 hash is base58 and
  only resolves on a path gateway.
- **it cuts the icon font down to the icons this app draws** —
  `tools/subset_icons.py`, 1.26 MB to 4 KB. That font was the largest single
  thing a visitor downloaded from the pin, bigger than everything else put
  together, and it carried 8,624 glyphs to draw ten. It is also the one file
  the gateway will not compress, because it types `.otf` as an OpenDocument
  formula template — so subsetting fixes twice what gzip would have.

  The keep-list is *read out of `src/`* rather than written down, so adding
  an icon to a view adds it to the font with nothing to remember. What
  cannot be read that way is the handful Flutter's own widgets draw — the
  picker's chevron, the expansion tile's arrows — and those are named in
  `WIDGET_GLYPHS`. `tests/test_icons.py` holds the whole arrangement up:
  every icon named in the source must survive the cut, the scan must still
  match the way this app writes an icon, and no file may reach for one
  dynamically, which is the one usage the scan could not see.

### Routes live in the fragment

`/#/ethereum/0xC09e…`, not `/ethereum/0xC09e…`, set by
`route_url_strategy = "hash"` in `pyproject.toml`.

**A gateway is a filesystem, not a server.** It resolves the request path
inside the published directory and 404s when there is no such file, and there
is no file called `ethereum`. So every deep link this app exists to hand out
— the kind you paste to somebody — died on arrival at the gateway, while
working perfectly against `tools/serve.py`, which falls back to `index.html`
the way a normal SPA host does. That gap is why it survived: the dev server
is the one host that hides the bug.

A fragment is never sent to the server at all. The gateway is asked for `/`,
serves `index.html`, and the app reads the route from the fragment. It asks
nothing of the gateway, so it behaves the same on a path gateway, a subdomain
gateway and an ENS name through `eth.limo`.

**`_redirects` is the IPFS-native answer and it does not work here.** A
gateway will serve `index.html` for `/*` if you ship that file, but then the
document URL *is* `/ethereum/0xC09e…`, and the relative `<base href="./">`
above resolves `main.dart.js` against it — `/ethereum/main.dart.js`, which is
not there. Fixing that needs an absolute base, which is exactly what breaks
path gateways. The two cannot both be satisfied; the fragment sidesteps both.

`ui/routing.py` is unaffected — Flet reports the same `page.route` either
way, so nothing in the app knows which side of the `#` it is on. Verified
against a server that 404s everything but real files: `/ethereum/0x…` is a
404 and `/#/ethereum/0x…` opens the pool with no failed requests at all.

**It has to be passed as a flag; the `pyproject.toml` key does nothing.**
`flet publish` declares `--route-url-strategy` with `default="path"` rather
than `default=None`, so `options.route_url_strategy` is always truthy and the
`or get_pyproject("tool.flet.web.route_url_strategy")` beside it is
unreachable — unlike `--web-renderer`, which defaults to `None` and does read
its key. A build that trusts the key comes out on `path`. The key is left in
`pyproject.toml` because it is the documented way to say this and will start
working if that default is fixed; `tools/publish_ipfs.py` passes the flag and
then reads the built `index.html` back to check, the same way it checks for a
leaked key rather than documenting that one either.

**There is no IPFS detection, and there could not be** — the strategy is a
literal in `index.html`, read before the app boots. So this changes every
deployment: localhost shows `/#/ethereum/0x…` exactly as `eth.limo` does.
That is the point rather than a cost. This bug survived because the dev
server was the one host that hid it.

**Pinata will not serve the result over its own gateways.** Both refuse HTML
with `ERR_ID:00023` -- the public one says to use a dedicated gateway, and
the dedicated one says to put a custom domain on it. Everything that is not
HTML (the js, the wasm, `app.tar.gz`, the images) is served happily by both,
so the failure looks like a broken pin rather than a policy. Three things
that do work:

- any third-party gateway: `https://<cid>.ipfs.dweb.link/`;
- a custom domain attached to the dedicated gateway;
- an ENS name whose contenthash is `ipfs://<cid>`, through `eth.limo` -- the
  CID is v1 for this reason among others.

Pinata's current upload API (`uploads.pinata.cloud/v3/files`) takes one file
and not a directory, and a website is a directory, so this posts to the older
`pinFileToIPFS` -- which is what their own docs point to for folders. One
request, one `file` part per file, each named `<folder>/<path>`; that naming
is what rebuilds the tree on the other side, and why the CID that comes back
is a directory you can open.

The body is built by hand rather than handed to `httpx` as 1,800 open file
handles, which hits the descriptor limit long before the network. It streams
one file at a time with the length computed up front, so the request is not
chunked -- and `tests/test_ipfs.py` asserts the computed length is exactly
what the generator emits, because a body that disagrees with its own
`Content-Length` either truncates at 100 MB or hangs.

---

## The shape of it

```
src/curve/     no Flet anywhere in it — pure logic, directly testable
    api.py         Prices v2 (pools) + v1 (charts), and the paging cursor
    models.py      Pool/Coin/Incentive, and parsing the API's shapes
    merkl.py       campaigns Curve reports half of, and every points one
    external.py    point campaigns kept in curve-frontend and nowhere else
    sort.py        column -> the v2 sort field it maps to
    format.py      numbers -> the strings a dense table can show
    abi.py         calldata for the pool contracts
    pool.py        those calls, bound to a connected wallet
    http.py        the browser/desktop fetch seam

src/ui/        Flet controls. Imports curve/, never the reverse.
    pool_list.py   search, sortable columns, scroll-driven paging
    pool_detail.py chart + composition + yields + actions
    actions.py     deposit / withdraw / swap / stake
    candles.py     the price chart: candles, axes, crosshair
    viewport.py    pan/zoom window and the pixel<->data mapping

src/wallet/    unchanged from flet-pay-example
```

The direction of that dependency is the whole point: `curve/` never imports Flet,
so sorting, formatting, ABI encoding and API parsing are testable with plain
pytest and no display, no Flutter, and no browser.

## Talking to the pools

Curve is not one ABI. Two axes vary independently, and both were checked
against mainnet rather than inferred from the registry names:

| implementation | coin index | amount arrays |
| --- | --- | --- |
| `main`, `crvusd`, `factory` (old stable) | `int128` | `uint256[N]` |
| `stableswapng` | `int128` | **`uint256[]`** |
| `crypto`, `factory_tricrypto`, `twocryptong` | `uint256` | `uint256[N]` |

StableSwap-NG rewrote its amounts as a Vyper `DynArray`, so `add_liquidity`,
`remove_liquidity` and `calc_token_amount` take an offset and a length where
every other pool takes N inline words. A fixed-array call to one of those
pools reverts -- which is what "could not read the deposit estimate" was.

The registry says which to expect and `PoolContract` asks anyway: the quote
tries both spellings, and the one that answers is remembered on the pool,
because a transaction gets no second attempt. An unknown future factory is
therefore handled by asking rather than by guessing.

The estimates are not equally trustworthy, either, so the slippage the app
fills in is `fee + 0.005%` to deposit or withdraw and `0.2 * fee` to swap.
`get_dy` is exact -- the arithmetic the swap itself runs -- while
`calc_token_amount` is computed fee-free on the old StableSwap pools, so a
`min_mint` built from it reverts. Both constants were measured: deposits run
on a titanoboa fork across 44 pools, bisecting `min_mint` until the
transaction stopped reverting, and quote staleness against the archive.
[`docs/slippage.md`](docs/slippage.md) has the tables, the two measurement
traps that produced wrong answers first, and why the fee term is what lets
the constant stay at 0.005%.

### Price impact

Slippage is what a quote may lose before it lands. Price impact is what the
trade costs for being the size it is, and it is a separate number: a swap
big enough to move the pool along its own curve pays it whether or not a
single block goes by.

It is measured rather than modelled. The panel quotes the same action at a
twentieth of what was typed, scales that answer back up, and reports the
gap:

```
impact = (quote(amount / 20) * 20 - quote(amount)) / quote(amount)
```

A twentieth is small enough that the curve is near-flat across it, so its
rate stands in for the marginal one. The fee cancels -- both sides pay the
same proportion of it -- which leaves the curve on its own. One extra
`eth_call` per keystroke buys this, and that is the price of the rule that
every number on screen came from the pool rather than from a second
implementation of Curve's invariant in Python.

Deposits get the same treatment, because a one-sided deposit is a trade
against the pool in all but name. There a negative answer is a real one:
deposit whichever coin the pool is short of and it mints more than the
proportional share.

Past 1% the line turns red and its background pulses, five times, on the
crossing rather than on every keystroke -- a panel re-quotes on each
character typed, and a flash restarted that often never gets past its first
frame. The pulse is bounded rather than endless because a panel has no
teardown hook: the pool page rebuilds its tabs outright, and a loop waiting
for the number to come down would outlive the panel it was drawing on. What
is left behind is a steady tint, so the state stays visible after the
flashing has done its job.

The same band carries the messages that mean *stop* for a different reason:
a quote the pool refused (ask a tricrypto pool to price 10^15 USDT and it
reverts with `Unsafe values x[i]`), or a withdrawal larger than the LP
behind it, which the panel says before it is sent rather than after it
reverts. Those go where the estimate would have been, since they are what
there is to say instead of one, and they take the band with them: a failed
quote has no impact to measure, so the two can never ask for it at once.

Both ends need enough units to divide. The probe is `amount // 20` and the
pool answers in whole units, so each carries about `1 / units` of rounding;
below ten thousand that swamps the 0.01% the line is printed to, and the
line is left off instead. The far end is the one that bites, and it was
found on mainnet rather than reasoned about: one USDT into TricryptoUSDT
buys 1,530 units of WBTC, a twentieth of that is 76, and 76 rounded times
twenty read as a **0.59% price impact on a one-dollar swap**.

### Metapools

A metapool holds two coins: its own, and the base pool's LP token. Almost
nobody holds that LP token — what they have is USDC — so Deposit, Withdraw and
Swap each offer a **Pool tokens / Underlying** switch, defaulting to underlying.

Swapping is the easy half — on a StableSwap metapool. `exchange_underlying` is
on the pool itself, which does the base-pool leg internally, so it approves the
pool like any other swap and works on every chain, including the ones where no
zap was ever deployed.

A *crypto* metapool has no such function at all. Its **per-pool zap** does:
all seven carry `exchange_underlying` and `get_dy_underlying`, checked in their
deployed bytecode, so the route exists there too and the zap is what gets
approved. The factory zaps of either kind have no swap functions, so a crypto
metapool served only by one of those has no underlying swap — and says so
rather than sending calldata nothing implements.

Depositing and withdrawing need a zap, and `curve/zaps.py` is mostly a table of
them, because there turned out to be **four dialects** and none is inferable
from the others:

| | pool argument | array | `is_deposit` flag | indices |
|---|---|---|---|---|
| StableSwap-NG factory | yes | `uint256[]` | yes | `int128` |
| stable factory | yes | `uint256[N]` | yes | `int128` |
| crypto factory | yes | `uint256[N]` | **no** | `uint256` |
| per-pool crypto | **no** | `uint256[N]` | no | `uint256` |

The last row is the older crypto metapools, which each got a zap of their own,
so its calldata is exactly what the pool itself would take — just sent
elsewhere. That is also why there are three tables rather than one: what
*addresses* a zap differs, not only what it speaks.

The addresses come from `zapAddress` in the v1 main API, swept across all 21
chains and every registry, and each was then checked with an `eth_call` to that
zap on its own chain, quoting a real deposit. The Gnosis gap that prompted this
was a sweep bug: Curve's API calls that chain `xdai`, and asking for `gnosis`
quietly returned nothing.

**Quotes work with no wallet.** Nothing about `get_dy` or `calc_token_amount`
needs an account, so with nothing connected the panels read through public
endpoints instead — rates and the fee-derived slippage appear before anyone
connects anything, and only the buttons that move tokens stay off.

The endpoints come from [chainlist.org](https://chainlist.org)'s `rpcs.json`,
which is CORS-open so the browser build can read it too. It is a *list* because
they fall over: a request walks it until one answers, and the survivor is where
the next read starts, so a dead host at the top is paid for once rather than on
every keystroke. Entries this app cannot call are dropped up front — websockets,
API-key templates, plain `http://` — and endpoints that report keeping no logs
are tried first. A JSON-RPC *error* is not retried: a reverted `eth_call` is an
answer, and asking somebody else gets the same one.

The file is a couple of megabytes and there is no per-chain endpoint, so it is
fetched once, lazily, on the first read that needs it — a session with a wallet
connected never asks for it at all. Which is the other half of the rule:

**a connected wallet is preferred, but it is not the only thing asked.** It is
the node that will execute the transaction, so a quote read through it is the
quote least likely to surprise. And a read through the wallet's provider lands
on whatever network the *wallet* is on. Browsing Gnosis with a wallet on
Ethereum quotes Gnosis addresses against Ethereum, where they hold no code:
every estimate comes back "the pool did not answer", which reads as a pool this
app cannot handle.

So picking a network in the header now takes the wallet with it —
`wallet_switchEthereumChain`, which the wallet prompts for and may refuse. A
wallet that has never heard of the network answers 4902, and then it is
offered one: `wallet_addEthereumChain` with the chain's name, native currency,
explorer and endpoints, which the wallet shows for approval.

Where those come from depends on the chain. A Curve Lite deployment describes
itself — `get_platforms` publishes the RPC, explorer and native symbol, and is
the only place that has them. Everything else comes from the chainlist
directory `curve/rpc.py` already reads for public endpoints: the same
`rpcs.json` carries `nativeCurrency` and `explorers` beside the RPCs, which is
all EIP-3085 asks for. All 26 networks the app lists are in it.

Three endpoints are offered, not the eight the read path will happily fall
through, and privacy-ranked first — this list goes in front of a person
approving a network, so it is a list somebody reads. An entry missing a
currency symbol or an endpoint is not offered at all: the wallet would refuse
the request, and being refused reads as the app being broken rather than the
directory being thin. That is the one case still answered with "your wallet
does not know this network", which used to be the answer for every chain that
was not Lite — Fraxtal on a fresh MetaMask being the report that started this.

Declining the offer is not an error and says nothing: the wallet asked, and no
is an answer. Only on a deliberate pick, never on load, where the wallet's own
network is a choice the app follows rather than overrides.

When they still disagree — a refusal, or a wallet moved by hand — each action
panel says which network to be on and offers the switch, with its estimate
cleared and its buttons greyed, since nothing can be read or sent across that
boundary.

### Where a read actually goes

`FallbackProvider` (`curve/rpc.py`) holds the wallet and the public endpoints in
one object and walks them in order. Which order depends on the connector:

| connector | reads | signs |
|---|---|---|
| injected (MetaMask, Rabby extension) | wallet, then public nodes | wallet |
| WalletConnect | public nodes, then wallet | wallet |
| none | public nodes | nobody |

An injected wallet is a node in the same browser, so it goes first. A
WalletConnect "wallet" is a phone on the far end of a relay built to carry
signing prompts — and a portfolio scan is six Multicall3 batches of three
hundred entries, tens of kilobytes each. Pushing one through that link is how a
scan came back `Load failed` (WebKit's fetch error) on DuckDuckGo/iOS talking to
Rabby, with the portfolio showing only "Could not read this chain". So the
batches do not go there any more. The wallet stays *last* in the list rather
than being dropped: on a chain chainlist has never heard of, it is the only
thing that can answer at all.

Two rules hold whichever way the reads go:

- **Only reads fail over.** `eth_sendTransaction`, `personal_sign` and the chain
  switches go to the wallet or they fail. A public node has no key, and
  reordering reads is not a licence to reorder anything else.
- **`eth_chainId` never fails over**, and it is the one that would have done
  damage. It does not read the chain — it asks a *source* which chain **it** is
  on, and every source here has a different honest answer. `network_ok` above
  uses it to decide whether the wallet must switch networks before it can act;
  answered by a public node pinned to the chain already on screen, that check
  passes every time and the panel in the previous paragraph never appears
  again. `tests/test_rpc.py` pins this with a wallet on chain 10 behind a node
  on chain 1.

A JSON-RPC error still ends the walk instead of continuing it, for the reason
`PublicNode` does not retry one either: a revert is a *reply*, another endpoint
gives the same reply more slowly, and a rejected request asked twice is a second
prompt.

**Falling over needs a clock**, which this did not have, and the bug it left
looked nothing like a transport problem: the pool parameters simply never
loaded. A wallet gets 120 seconds to answer a request — right for a signature,
where a human is reading a prompt, and absurd for an `eth_call` nobody typed.
So a wallet whose node had gone away answered *nothing*, and the walk sat on it.
`PoolContract.parameters` is one Multicall3 plus, when that comes back empty,
thirteen single reads: fourteen requests at two minutes each is **twenty-eight
minutes** of "Reading pool parameters…", with a public endpoint one step behind
it that would have answered in a second.

So a read gets `READ_DEADLINE` — eight seconds, the same budget `ENDPOINT_TIMEOUT`
gives a public endpoint — and a source that misses it is skipped for
`SOURCE_COOLDOWN` seconds, because otherwise the deadline is paid fourteen times
over. Two edges matter:

- **the last source in the order has no deadline.** There is nowhere to fall to,
  and a clock there converts a slow answer into no answer;
- **a success clears the mark at once**, so a laptop coming off standby is asked
  again on its next read rather than being written off for the session.

The panel keeps its own backstop (`PARAMETER_DEADLINE`, 45s) for the transport
nobody has thought of yet: it resolves into values or into a sentence, never
into reading forever. And anything a transport raises that is not a `WalletError`
is reported the same way — an uncaught one kills the task silently, which is the
state that made this look like a hang rather than a failure.

A zap that will not answer costs nothing, since the route is gated on a working
quote — no approve step appears and the pool-token route stays. One family is
still unsupported for deposits: the `main`-registry metapools (GUSD/3Crv and
friends), whose per-pool deposit contracts answered none of the spellings
probed. Their underlying coins can still be swapped.

## Reading Curve

Public APIs, no keys. Pool data comes from the **Prices API v2**; charts from
**v1**, which is the only one with OHLC. Two sources that are not Curve's fill
in the rewards it does not report — see
[below](#the-rewards-curves-api-does-not-report). The full survey is in
[`docs/curve-api.md`](docs/curve-api.md); the parts that shape the code:

- **v2 returns everything about a pool in one object** — TVL, volume, base APR,
  the CRV boost range, reward tokens and merkle rewards. The older main API split
  those across `getPools` and `getVolumes` and needed a join by address; v2 is
  also ~4× smaller (351 KB against 1.3 MB for Ethereum) and adds `merkle_apr`,
  which v1 had no equivalent for — though that one turns out to be half a
  campaign with no token named, which is what sent this app to Merkl.
- **`pagination` is capped at 50**, and there is no "give me everything" call.
  That one limit is why the list is a paged cursor and why the ordering moved
  server-side — see below.
- **The list endpoint omits `lp_token_address`, the reserves and per-coin
  prices**, so opening a pool costs one more request. Without it there is nothing
  to withdraw or stake.
- **`gauges` has two shapes**: objects with a kill flag on the list endpoint,
  bare strings on the detail endpoint.
- v2 covers **12 chains against v1's 21**. All six offered here are in the twelve;
  anything outside needs v1.
- Every host sends `access-control-allow-origin: *`, so the browser build needs
  no proxy.
- **The v1 main API 403s the default `Python-urllib/*` User-Agent.**
  `requests`/`aiohttp` are unaffected, but the desktop transport here *is*
  urllib, so every desktop request sets a name of its own. **The browser half
  must not send one** — see below.

### The header that broke iOS

Sending that same `User-Agent` from the browser build cost a day, so it is
worth writing down. A cross-origin request carrying only CORS-safelisted
headers is a *simple* request and goes straight out. Name any header outside
that list and the browser must first ask the host's permission with an
`OPTIONS` preflight, which the host is free to refuse.

`User-Agent` is such a header. Setting it on a `fetch` is legal per the current
Fetch standard — it was taken off the forbidden-header list — so a browser that
follows the standard puts it on the wire and the request stops being simple.

**Chrome hid this for months.** Chrome still strips `User-Agent` from `fetch`,
so the header never reached the wire and the request stayed simple. Every
WebKit browser sends it, and on iOS *every* browser is WebKit — Brave and
Chrome included, because Apple requires it. Firefox sends it too, which is what
makes this reproducible on a desktop.

What it broke: `chainlist.org` answers `OPTIONS` with `access-control-allow-origin: *`
and no `access-control-allow-headers` at all, so the preflight failed and
`rpcs.json` would not load. With no endpoint directory there is no public node
for any chain, so with no wallet connected *every* read failed — and because
the directory was only ever fetched once, it stayed failed for the whole
session. On a phone the pool panel came up with its addresses and
"This pool answered none of them", which reads as a fact about the pool and
sent the search in entirely the wrong direction.

So the browser half now sends no header it does not have to: nothing at all on
a GET, and `Content-Type` alone on a JSON-RPC POST, which already costs a
preflight that every endpoint serving browsers answers. Nothing is lost — a
browser sends its own `User-Agent` and will not let a page forge one.

Two smaller things fell out of the same hunt, both of which helped it hide:

- a failed directory fetch used to be **permanent**, so one blip cost the whole
  session. It is retried after `curve.rpc.RETRY_AFTER` instead — still not on
  every keystroke in an amount field, which is what the wait is for;
- a pool read that never reached the chain was reported as a pool with no
  parameters. `PoolContract._maybe` now swallows only `PoolCallFailed` — the
  pool's own answer — and lets a transport failure through to be shown.

**Firefox reproduces this and iOS-only bugs like it**, which is worth
remembering the next time something works on a desktop and not on a phone.

### Keeping the headline figures current

TVL and 24h volume on the bar were read once, when the chain loaded, and
never again -- a page left open all day showed the morning's numbers.
`refresh_totals` reads them every ten minutes for as long as the app is
open.

It sleeps until they are actually due rather than ticking on a fixed
schedule, because a chain switch reads them itself: a blind tick landing
seconds later would pay for the read twice over. And each read is not
cheap -- `chain_totals` costs 2.4 MB on Ethereum, because the per-chain
endpoint answers with the chain's whole pool list attached (1,070 pools)
and there is no leaner route to the two figures. The `/chains/` index that
orders the picker is one small response but carries `pool_tvl` only, no
volume.

The read is quiet: nobody asked for it, so a chain that will not answer
leaves the last good figures up rather than putting an error banner over a
page that was fine. A chain switched while the read is in the air throws
the answer away -- the new chain's own load draws its figures.

**The rows come down with it.** Those 1,070 attached pools carry each
one's `tvl_usd`, `trading_volume_24h` and `base_weekly_apr` -- the three
figures the list draws that move -- so `pool_figures` keeps them from the
same fetch and the list takes them on for nothing. Only those three: a
chain payload has no incentives in it, that being a v2 field, so the CRV
range beside them keeps whatever the last real load said. Nothing is
reordered either. The order is the server's, and a row jumping past its
neighbour because its volume ticked over is worse than a list briefly
ordered by figures a few minutes old.

The two payloads agree on TVL and volume to the cent and disagree on base
APR by exactly 100x: **v1 reports the fraction where v2 reports the
percentage** -- 0.007309821255934601 against 0.7309821255934601 for the
same pool in the same minute, matching digit for digit once scaled.
`BASE_APR_SCALE` is where that is corrected. Taken raw it was invisible in
the tests and obvious on screen: every Base APY shrank by two decimal
places on the first refresh, crvUSD/USDC going from 0.73% to "< 0.01%".

### Back, off a pool opened from the portfolio

A pool is not a page. It does not claim a nav link, so `_page_name` still
says "portfolio" while one opened from there is on screen, and `_opened_from`
is what the in-app back arrow reads to know where to return to.

The browser's own Back button goes nowhere near that arrow: it is a route
change and nothing else. `apply_route` asked "am I already on the portfolio?"
by the name alone, said yes, and did nothing -- leaving the pool on screen
under a `/ethereum/portfolio` address. Press Back again and the chain route
found a detail view open and went to the list, which is how backing out of
the portfolio landed on Pools. The pools branch had the second half of the
question all along (`self._detail is not None or ...`); the portfolio branch
now has it too, and reloads only when it was not already the page you were on
-- backing out of a pool has rows to come back to, arriving from elsewhere
does not.

### Paging, and why sorting is the server's job

The 50-row cap left two options: pull every page before painting anything (eight
requests for Ethereum), or page as the list scrolls. This does the second — the
first page appears after one request and the rest arrive as they are needed.

The consequence is that ordering cannot be done on the client, because a client
cannot sort a list it has not fully loaded. So changing the sort or the search
resets the cursor and asks the server again. That is a round trip per sort, and
in exchange the top of the list is always the true top rather than the top of
whatever happened to be in memory. Search is debounced and sent as
`search_string`, so it covers the whole chain rather than the rows on screen.

The cross inside the box appears only once there is a query to clear, and its
tap skips the debounce -- the wait is there to sit out typing, and a tap has
already finished. Both the tap and every keystroke claim the search *as the
event arrives* rather than when their task gets a slice: a clear that happened
second must not be overtaken by the keystroke that happened first.

`curve/sort.py` maps each column to a v2 `sort_by` field. "Incentives" maps to
`aggregate_apr`, the API's combined base + CRV + tokens + merkle figure — there
is no rewards-without-base field, and the difference is immaterial when base APR
is low single digits and incentive APRs run to hundreds of percent.

### The rewards Curve's API does not report

Three of them, and none is a rounding error. `merkle_apr` is a bare percentage
with no token attached to it, and it turns out to be **half of one campaign**:

```
merkle_apr (v2)                                                325.0632316262278
Merkl "Stake into the Curve frxUSP gauge"                      325.0632316262278
Merkl "Provide liquidity to Curve frxUSD-USP"                  325.1121240372897   <- nowhere in Curve
```

A Merkl campaign watches a **token**, and for a Curve pool that is either the
LP token — paid whether or not you stake — or the gauge, paid only on what is
staked. Merkl usually runs both, and Curve reports the second. The difference
is normally a rounding error, and occasionally it is the whole reward: a
campaign paying only unstaked liquidity is one that **staking switches off**,
which the pool page says in those words because the Stake button is right
there.

Then **points**, which no APR field anywhere can carry, because a point has no
price. Merkl marks them `POINT` and quotes `apr: 0`; the rest live in a
directory of JSON files inside curve-frontend, which is the only
machine-readable record that Ethena counts a Curve position at 30x. Those get
a line naming who is paying, a multiplier where there is one, and a link to
whoever is counting — a percentage invented for them would be worse than the
nought.

So the rewards column and the pool page read two more sources, `curve/merkl.py`
and `curve/external.py`, and there are three things worth knowing about how:

- **the requests go out beside the pool list, not after it.** Both are on the
  first page's critical path, so `list_pools` gathers all three and pays the
  slowest rather than the sum, on a five-second timeout for the same reason
  `LITE_TIMEOUT` is five. Neither is load-bearing: every path returns an empty
  index rather than raising, and **the emptiness is cached**, so a host that is
  down is asked once per TTL and not once per page of pools;
- **Merkl replaces `merkle_apr` rather than adding to it.** They are the same
  money read two ways, so `Pool.campaign_apr` takes Merkl's where it has one
  and Curve's otherwise. Adding both would report 650% on a pool paying 325%
  and sort it above pools that genuinely pay more;
- **the lookup runs twice on a pool page.** A campaign can be watching the LP
  token, and an old-registry pool's LP token is a different contract from the
  pool — which the *list* endpoint does not carry. So the pool page asks again
  once its detail lands. Both sources are cached by then, so it costs nothing.

**And the token a campaign names is not always the token it pays.** A Merkl
*wrapper* is an ERC-20 with an `onClaim` hook: the campaign is denominated in
the wrapper, and what reaches the wallet is the underlying — pulled from the
incentiviser, withdrawn from Aave, unwrapped from wETH, or deposited into a
vault, depending on which of Merkl's four templates was used. The pyUSD/crvUSD
pool advertises `ybwcrvUSD`, which is "Yield Basis crvUSD (Merkl wrapper)",
and pays **crvUSD**; three of the fourteen tokens paying live Curve campaigns
were wrappers when this was measured. Rows therefore read as what arrives, and
the wrapper is named in the tooltip and written out on the pool page — Merkl's
own page still calls it `ybwcrvUSD`, and the two have to reconcile for anyone
who follows the link.

`underlyingTokenId` is how that is found, and it costs one extra request for a
whole chain, because `/v4/tokens` takes `id` more than once. One trap in it:
`WFRAX` and `tGBP` carry that field set to their **own** id, which means "not a
wrapper" in the same field that elsewhere means "here is what a claim really
pays" — follow it and you print "WFRAX pays WFRAX".

One consequence to be aware of: the incentives sort is still `aggregate_apr`,
computed server-side from Curve's own fields, so a pool whose campaign only
Merkl knows about is ordered by the smaller number even though the row shows
the larger one. Fixing that means sorting a list the client has not loaded,
which is the constraint the whole cursor exists for.

**`campaignEnd` in the external files is not a date anybody maintains**, and
it is worth saying because the obvious code is wrong. 121 of the 122 pool
entries had an end already in the past when this was measured, 119 of them the
same round `1770000000`, while Curve's site showed all of them: upstream skips
the check entirely when `campaignStart` is `"0"`, and reads seconds as
milliseconds when it does run it. Enforcing that field correctly empties the
feature. It is carried and not enforced; `campaignStart` *is* honoured, which
costs nothing today and is right the first time somebody schedules one.

### Curve Lite, and showing less on purpose

A **Curve Lite** deployment is the factory contracts and a gauge without the
indexing the big chains have — fifteen mainnets, from Etherlink and Monad down
to pools worth a few hundred dollars — and it is served by a different API,
`api2.curve.finance`. They are in the same chain picker; `curve/lite.py` has
the client and `CurveApi` dispatches on chain id, so `PoolFeed` and the list
view never learn which kind of chain they are showing.

What that API does not have is the interesting part. **No volume, no base APR,
no CRV boost range, and no OHLC at all.** Those are not zeroes — nothing
measures them — so rather than print noughts that read as measurements:

- the Volume and Base APY **columns come out** of the table, and their sort
  options with them. The list opens on TVL, since sorting by a volume that is
  unknown everywhere orders the page arbitrarily;
- the chain header drops its volume clause, and so does the pool page;
- the chart is replaced by one line saying why there isn't one;
- a reward whose token has no price contributes nothing, rather than an APR
  guessed from the emission rate.

Three shape differences are handled in `Pool.from_lite`: raw integer balances
with string decimals (v2 sends them scaled), a third spelling of the registry
ids (`factory_stable_ng` where v2 says `stableswapng` — folded by
`Pool.registry_key`, and getting it wrong would send fixed-array calldata to a
`DynArray` pool), and metapool coins that are *not* decomposed, which is also
why no zap route is offered there.

Two other things this API decides rather than the app: pools marked `is_broken`
and the `get_hidden_pools` list are both dropped, as Curve's own frontend drops
them. And the TVL floor is zero here where the big chains use $10,000 — whole
Lite deployments are smaller than that floor, so the same cut would empty the
list. Sorting by TVL is what keeps the dust at the bottom.

Paging is local: one request returns the whole chain, and `curve/lite.py`'s
`select` filters, orders and slices it to the same `(page, total)` contract the
server gives for v2.

### The address bar

On web, a pool page has an address worth sending to somebody:

```
/                       the list, on the default chain
/ethereum               the list, on that chain
/ethereum/0xC09e82…     that pool
```

Flet gives the browser's URL as `page.route`, pushes history entries with
`page.go`, and calls `on_route_change` when either the app or the *user*
navigates — the Back button included. There is no way to tell those two apart,
and no need to: `apply_route` compares the route with what is on screen and
moves only if they differ, so the same handler serves a click, a deep link and
a Back press without looping.

Chain names are the API's own (`xdai`, `x-layer`), because they are what every
other part of this app keys by. A deep link asks the API for that *one* pool
rather than paging until it turns up — it may be below the TVL floor or on page
nine — and a rotted link lands on the list with a message rather than nowhere.

Two consequences worth knowing. The published build routes on the URL **path**,
which a static server knows nothing about, so `tools/serve.py` falls back to
`index.html` for any path that is not a file; deploying elsewhere needs the same
one-line rule. And the in-app back arrow *pushes* the list route rather than
popping history, because Flet exposes no pop — so after using it, the browser's
Back returns to the pool you just left.

None of this touches the desktop build, which has no address bar; `page.route`
is simply never anything but `/`.

## The chart

`flet-charts`' `CandlestickChart` draws the candles and axes. It has no pan,
no zoom and no crosshair, so those are added around it the way the pyqtgraph
dashboard this is modelled on does:

```
GestureDetector        drag to pan, wheel to zoom, hover for the crosshair
  Stack
    CandlestickChart   the candles and axes
    Canvas             a transparent overlay — crosshair only
```

That split is the point. The chart never repaints for a mouse move; only the
overlay does. And the overlay *is* a canvas, because a crosshair is two lines
and a label — which is what canvas is for, unlike the candles, which were not.

- **Drag** pans both axes. Content follows the cursor, and dragging down raises
  prices, because screen y grows downward and a chart that inverts that is
  unreadable.
- **Wheel over the plot** zooms in time, anchored on the candle under the
  pointer so it stays under the pointer.
- **Price follows the visible candles.** Zooming into ten candles rescales the
  price axis to those ten — without it they keep the whole series' range and
  stay squashed into a few pixels, which defeats the point of zooming in.
  pyqtgraph calls the same thing `enableAutoRange`, and the Qt version this is
  modelled on turns it on too.
- **Wheel over the price gutter** scales price on its own, leaving time alone —
  the way a trading chart does it. A Flet `ScrollEvent` carries no modifier
  keys, so the cursor's position is the only thing available to dispatch on,
  and the axis gutter is the conventional target anyway.
- **Dragging vertically** takes the price axis over manually. Any manual price
  gesture switches auto-fit off, so the chart stops fighting you; double-tap
  (or a new series) hands it back.
- **Hover** draws the crosshair: dashed lines through the cursor, the price
  boxed against the left axis, the timestamp boxed on the date axis, and the
  hovered candle's OHLC in the top-left corner rather than trailing the pointer.
  Hover is throttled to 25/s; every event is a round trip into Python, and the
  Qt version throttles for the same reason.
- **Double-tap** refits the whole series.
- **Candle size**, not window: 15m / 30m / 1h / 4h / 6h / 12h / 1d / 7d / 14d, the
  way Curve's own chart does it. Every pair maps to a verified
  `(agg_number, agg_units)` on `lp_ohlc`; `agg_units` accepts only `minute`,
  `hour`, `day`.

**Pool parameters come off the pool, in one call, when you open the fold.**
It reads `A`, `gamma`, `fee`, `mid_fee`, `out_fee`, `fee_gamma`,
`offpeg_fee_multiplier`, `price_oracle`, `price_scale`, `get_virtual_price`
and `stored_rates` from the contract — the API supplies the pool and gauge
addresses and nothing else there. Which of them a pool implements is the
pool's answer to what family it belongs to, not the registry name's, so all of
them are asked and whatever answers is shown.

*When you open the fold*, because this is reference material and almost nobody
unfolds it. The batch used to go out for every pool page anybody landed on,
against a public endpoint whose budget is a stranger's goodwill; now the
addresses paint from the API for free and the chain is asked once, on the first
expand. Reopening does not ask again — but a read that failed for want of a
wallet or a node is retried, because both can be fixed from outside the page
while it is still on screen.

That is thirteen questions (two have a second, indexed spelling on tricrypto),
and they go in **one** `eth_call` through
[Multicall3](https://github.com/mds1/multicall) — same address on every chain
that has it, `aggregate3` so that a call which is *expected* to fail does not
take the batch down with it. Measured against a public endpoint:

```
multicall       0.05s   1 request    9 values
one at a time   0.52s  14 requests   9 values
```

A chain without Multicall3 is a normal case rather than an error, and nothing
can distinguish it from a batch that answered nothing, so an empty answer falls
back to asking one at a time. The scales differ per parameter — fees are
fractions of 1e10, `gamma`/`fee_gamma`/prices are 1e18 fixed point, the off-peg
multiplier is 1e10 read as a multiplier — and `curve/parameters.py` carries the
mainnet readings the table was built from.

The virtual price is the one entry there that is not a parameter of the curve
but a result of it, and it is shown to twelve decimal places rather than the
six significant digits the other 1e18 values get. `1.039823717357`, not
`1.03982`: it leaves 1.0 slowly — about 1.9e-8 per block for a pool earning 5%
a year — so the digits that would be rounded away are the entire point of
looking. Implemented on every family, but not answered by every pool: it
divides by `totalSupply`, so a pool nobody has deposited into reverts, and the
row is then simply absent.

`stored_rates` is the minority row, and the awkward one. It is the rate the
pool prices each of its coins at, shown **against the first coin** and labelled
that way, so it reads as a price rather than a multiplier you divide yourself:

```
osETH/rETH   External oracle rETH/osETH     1.085918349945
DOLA/sUSDe   External oracle sUSDe/DOLA     1.243624562186
sPool        External oracle sDAI/sUSDe     0.948314718136
             External oracle sFRAX/sUSDe    0.933039820747
PayPool      (no rows)
```

The prefix earns its width by separating these from `Price oracle` two rows
above, which is the pool's *own* moving average of its *own* trades. Both are
oracles; they measure different things from different places, and a bare
`rETH/osETH` says which pair but not which kind. Rendered at 360px, the widest
real pair sits on one line with room to spare.

**Dividing is not cosmetic.** `stored_rates` is denominated in the pool's own
accounting unit, not in coin 0, and the two coincide only where coin 0 has no
oracle of its own. Across all 2,009 mainnet pools, 1,011 answer this method and
**298 of them — 29% — have a first rate that is not 1.0**: `osETH/rETH` reads
`1.0772` and `1.1697`, `ETHx/wstETH` reads `1.2417` and `1.0951`, `wbIB01` reads
`121.52`. Printing rETH's raw `1.1697` under a `rETH/osETH` label would claim a
price the pool does not hold — it prices rETH at `1.0859` osETH. Where coin 0
*is* the numeraire, the other 71%, dividing by one changes nothing.

Coin 0 gets no row: against itself it is 1.0 by construction. And a pool whose
rates are all identical gets no rows at all — 541 of the 1,011 — because a
column of `1.000000000000` only restates that this is an ordinary pool.

Two more things it does not share with any other row. It answers **an array**,
in either of the two encodings Vyper produces — a bare `uint256[N]` from the
stETH-ng pool, an offset-and-length `DynArray` from a stableswap-ng one — so
`abi.decode_uint_array` sniffs the shape rather than trusting a declaration.
Decoding it as a single word would return the array's *offset*, 32, and print a
confident `0.000000000000`. And **each coin has its own denominator**: the
contract scales everything to 36 decimals, so USDC's flat 1.0 arrives as 1e30
where an 18-decimal coin's arrives as 1e18. A shared 1e18 would price WETH at
1e-12 in USDC. When the rate count and the coin count disagree — a metapool's
two against the four its coin list decomposes into — the rows are dropped
rather than paired with the wrong decimals.

**A pair is charted the way it is written.** "WBTC/USDC" is WBTC priced in
USDC, so it should read ~64,000 and not ~0.0000154. The `/ohlc` endpoint's
parameters are the other way round from how they read — it prices
`reference_token` *in* `main_token` — so the quote coin is what goes in
`main_token`. Taking those names at face value inverts every pair chart, which
is easy to miss unless one side is a stablecoin. The measurement is in
[`docs/curve-api.md`](docs/curve-api.md).

**How many candles is a function of the plot width, not a fixed number.**
`CandlestickChart` draws bodies at a fixed width — measured at ~3 logical
pixels, and unchanged whether it is handed 20 spots or 365 — so the only lever
on how the chart reads is how many candles share the width. A fixed 200 looked
cramped at one candle size and sparse at another. The count is now
`plot_width / TARGET_PITCH_PX` (5.5px), which puts a 3px candle in a 2.5px gap:
gaps never wider than the candles, candles never hairlines. Two consequences
fall out of it — a candle is the same size at every candle size, and widening
the chart shows *more* candles rather than the same ones stretched, which is
why a material resize refetches.

The exception is history: 7d and 14d on a young pool return fewer candles than
the chart has room for (81 weeks is all that exists), so those spread out. That
is the data running out, not the pitch.

No animation on any of it. A 250ms ease flatters a data swap and is actively
wrong under direct manipulation: every drag frame sets a new window, so the
chart spends its time easing towards where the cursor *was*. It felt like
dragging through treacle until the animation came out.

Only the visible window (plus a small margin) is sent to the chart, so a drag
at 1Y serialises ~20 spots rather than 365.

**One bad wick will set the whole scale.** Strategic USD Reserves has a daily
candle whose low is `0.024` against a body of `1.0158` — an API glitch, not a
two-cent trade in a USDC/USDT pool — and fitting the axis to the absolute
min/max flattened 200 days of history into a line at the top of the chart. The
price axis is therefore fitted to the candle *bodies* plus any wick within
`WICK_HEADROOM` (3×) of that range. The rule is relative to how much the series
actually moves, so a genuine 1.2% dip on the same pool still sets the scale
while the 97% one does not; a body is never excluded; and the outlier is not
deleted, just drawn clipped, so panning down still reaches it.

**A candle thinner than a pixel is drawn as nothing.** Not a hairline, not a
dot — a gap. On a stable pool that is most of them: Strategic USD Reserves over
7 days has **101 of its 169 hourly candles under one pixel** of high-to-low, so
the chart looked like it was missing data when the data was complete and
gapless. Every candle handed to the chart is therefore floored to
`MIN_CANDLE_PX` of extent, widened about its own midpoint. The floor applies
only to the chart's copy — `_candles` keeps the true values, so the crosshair
still reads out real numbers.

**Known limitation: candle width does not scale with zoom.**
`CandlestickChart` draws candles at a fixed pixel width — there is no width
property on the chart or on `CandlestickChartSpot`, and the rendered width is
unchanged whether it is handed 365 spots across 90 days or 20 across 17. So
zooming in spreads the candles apart instead of fattening them. Fixing it
properly means painting the bodies onto the overlay canvas and leaving the
control to draw only the axes and grid — a real option, since the overlay and
the pixel mapping already exist, but it gives up the control for the part it
was chosen for.

The window is clamped to keep the data on screen, with half a window of
overscroll at each end — stopping dead on the last candle reads as the chart
being stuck — and never narrower than five candles, or one scroll burst zooms
until the chart is a single bar.

`viewport.py` holds all of that arithmetic, which makes the awkward cases —
zooming past the ends, panning off the data, a plot box too small to divide by
— cheap to test without a mouse. One honest limitation: `CandlestickChart` does
not expose where it drew its plot area, so `Plot` reconstructs it from the axis
label sizes this app itself sets. The crosshair readout is therefore accurate to
a pixel or two rather than exact.

### Axis gotchas

Both found by looking at the rendered result, and neither is obvious:

- Axis labels must land on **multiples of `label_spacing`**. The chart ticks at
  multiples of the interval counted from zero, so labels at `min + i*step` are
  dropped and the axis shows only its endpoints. `nice_interval` picks a round
  step (1, 2, 2.5 or 5 × 10ⁿ) and labels go on multiples of it. The date axis
  never hit this — its values are integer multiples of the stride already.
- Derive label precision from the **interval**, not the span, or an axis
  stepping by 0.0001 prints "1.026800" where "1.0268" is the number.

### Trades and liquidity, where the chart was

Every price series in the picker is named by its marks: the pool's own stack
for the LP token, the two coins for a pair, on the menu entry and on the
closed field alike. The field's copy is larger and sits in a box of its own:
Material drops a leading icon into a slot meant for one 24px glyph, and a
stack left raw in it rides the top-left corner against the frame. A box
wider and taller than the widest stack centres it in the field — and holds
the label still while the selection moves between two coins and three. The
picker is 270px to fit both, and 200px on a phone, where the candle size
beside it would otherwise go off a 330px edge and the LP series drops its
"(USD)" to fit.

The marks are built fresh for each place they appear, because a control
belongs to one place in the tree — and Flet skips a write whose control compares
*equal* to the one already there, so on a two-coin pool the field does not
change between the LP token and the only pair, both being the same two marks.

The picker ends in two entries under a rule: **Trades** and
**Liquidity**. Having no coins to be named by, they are named by a glyph
instead -- swapped arrows and a drop -- boxed to the width of a pair's two
overlapping marks, because Material starts a row's label after whatever its
leading control is and one glyph is narrower than two marks. Without the
box their names sat left of every price row's; without the glyph at all,
they were the only rows in the menu with an empty leading slot, and the
field's label jumped sideways whenever a table was picked.

They are not a third way of drawing the price, they replace the
chart with what actually went through the pool — a swap per row, or a deposit
or withdrawal — each row a link to the transaction on the chain's explorer.
The candle-size picker goes away with the chart, having nothing to size, and
the table takes the chart's exact height so the page does not jump.

They are laid out as tables rather than as rows of content: four columns for
a swap (sold, arrow, bought, when) and three for liquidity (what moved, who
moved it, when), each cell a `Container` with a fixed width or a flex, the
way `_composition` builds its own table. Amounts are drawn at `BODY`, the
size the composition table gives its symbols -- 13px read as fine print next
to it. The provider address is written out in full and left to Flutter to
elide: the column is weighted to fit all 42 characters on a wide window and
cuts itself short where it cannot.

A phone gets less of it. The coin symbol goes -- the mark carries it as a
tooltip anyway -- and the two sides of a swap share one wrapping column, so
they stay on one line while they fit and take a second when they do not. The
address falls back to the `0x0c93…7f34` form, there being no width to elide
into. The rows are rebuilt on a change of width rather than refetched, which
is why the fetched trades are kept beside the table.

Both come from prices v1. Liquidity is one request per pool: it answers with
one amount per coin and a zero for the ones untouched, and an event type that
says whether it went in or came out.

Trades are **one request per pair**, which is the only awkward part of this.
`/trades/{chain}/{pool}` requires `main_token` and `reference_token` and
answers for that pair alone -- both directions, but that pair. So a three-coin
pool is three requests and a four-coin pool is six; they go out together and
the answers are merged newest first. A pair that fails is left out rather than
taking the table with it, and only *every* pair failing is an error -- because
then there is nothing to show and there is a reason for it, which is a
different thing from "no swaps yet".

**The end of the table pulls the next page in.** Forty rows is what the first
ask gets; scrolling within a couple of hundred pixels of the bottom reads
forty more, under a "Loading…" line that sits at the end of the rows. Neither
endpoint sends a total, so a page that does not fill is how the end of the
history announces itself. The cursor lives on the view rather than on the
fetch, one per table, so glancing at the chart -- or at the other table --
and coming back keeps whatever was scrolled to instead of asking for it
again.

Merging the pairs a page at a time is the part that needed thinking about.
Reading page two of every pair and showing what came back would put a quiet
pair's month-old swap above a busy pair's newest, because the pairs trade at
wildly different rates and each pages on its own clock. So a trade is handed
over only once no unread page could hold a newer one: every pair remembers
the oldest trade it has read, the newest of those is a line, and nothing
below the line is safe to show yet. Reading the next page of the pair
*sitting* on the line is the only thing that lowers it -- so that is the only
pair a scroll asks, and a page of the table usually costs one request rather
than one per pair. What has been read but is still below the line waits in
that pair's buffer for the scroll after. A pair that fails deeper in ends
there rather than emptying the table, the same tolerance the first page has.

The rows carry pool indices rather than symbols (`sold_id`, `bought_id`), and
which index is which comes from the `main_token`/`reference_token` the answer
echoes back. An id that matches neither -- a metapool reporting an underlying
-- draws the main token rather than raising in the middle of a table.

Charts are also the one place `flet publish` bit: it resolves dependencies
relative to the **script's** directory, so `flet publish src/main.py` never saw
the root `pyproject.toml`, fell back to bare `flet`, and the published app died
in Pyodide with `ModuleNotFoundError: No module named 'flet_charts'`. Publish
from the project root instead — `flet publish`, no path.

## Logos

Chain marks, token images and the Curve logo come from
[curve-assets](https://github.com/curvefi/curve-assets), carried as a submodule
at `vendor/curve-assets`. Upstream is 67 MB across 38 networks, so
`tools/build_assets.py` compiles in only what this app can draw — every chain
logo (388 KB for all 40), the wordless Curve mark, and the token images for
**every chain upstream has**, read from the directory listing rather than a
list kept in the tool. That is ~29 MB in `src/assets/curve/`, generated and
gitignored.

The listing matters: a list kept in the tool goes stale silently, because a
token with no image draws its initials and a chain missing *entirely* looks
exactly the same. That is how Gnosis ended up with nothing but lettered
circles — it was never in the list, and nothing said so. Note upstream calls
that chain `xdai`, as Curve's API does.

`build_icons.py` also writes `icons/loading-animation.png`, which is what the
page shows while the Python runtime starts — Flet puts its own logo there, and
it is overridden the same way the favicon is: same file name, copied over
theirs at publish time.

A token with no image upstream still draws initials, but quietly: the hue
derived from its symbol tints the disc and its border, and the letters take
the theme's own colour. White letters on a saturated disc read as a brand
rather than as a missing logo, which was loudest in the swap pickers where one
coin would shout and the other would not.

The app's own icon is the same mark, rendered out of that SVG by
`tools/build_icons.py` (librsvg + Pillow) into `src/assets/favicon.png`,
`icon.png` and `icons/*.png`. Those **are** committed, unlike everything else
derived from the submodule: a site needs a favicon whether or not whoever
cloned it ran `git submodule update --init`, and `flet build` cannot read an
SVG. The names are Flet's own — `flet publish` copies `src/assets` over its web
root, so a file only replaces the stock Flet icon by landing at the same path.
The maskable and Apple variants carry a white backdrop and sit inside the
middle 78%, because those get cropped to a circle or a squircle and iOS
composites transparency onto black.

**Seeing the favicon.** `flet publish` from the repo root, then
`python tools/serve.py 8033`.

It did not show up at first, and the reason is worth keeping. The file was
built, copied and served correctly — `/favicon.png` returned it on demand —
but the tab stayed blank because **the link tag was not in `<head>`**. The
comment at the top of `index.html` explains which markers `patch_index.py`
rewrites, and it spelled out an HTML comment terminator while warning against
writing one. The browser ended the comment there, found bare prose inside
`<head>`, and did what the parser is specified to do: implicitly closed the
head and opened the body. The base tag, the title, the manifest link and both
icon links landed in `<body>`, where a favicon link is ignored — so Chrome fell
back to `/favicon.ico`, got a 404, and drew nothing.

Nothing looks wrong from the outside: the file reads correctly, the icon is
served correctly, and `document.querySelector('link[rel=icon]')` finds it.
`document.head.children` is what gives it away, and
`tests/test_index_html.py` now parses the file the way a browser does and fails
on any bare text inside the head.

The URL carries a `?v=1` as well, since browsers keep favicons in a store keyed
by URL that no cache header reaches; bump it when the mark changes. There is a
real `favicon.ico` too, for the path every browser probes before reading the
link.

**Seeing it on the desktop.** `flet run` gets it too, on X11: the Flutter host
sets no `_NET_WM_ICON` at all and Flet's own `window.icon` is Windows-only, so
`ui/window_icon.py` sets the property itself through libX11 at startup, using
pixels `build_icons.py` pre-decoded into `assets/window_icon.argb` (no image
library in the app, which is what keeps this off the browser build). It finds
the host window by `WM_CLASS` and narrows to the one in its own **process
group** — `flet run` spawns the app and the host as siblings, and a second Flet
app started from another shell must not be stamped, since every Flet window
shares that class. Check it with
`xprop -id $(wmctrl -lx | awk '/flet.Flet/{print $1; exit}') _NET_WM_ICON`, which
prints the six sizes it now carries.
Everywhere else — Wayland without XWayland, macOS, a headless run — it does
nothing at all, and the supported route is `flet build`, which reads
`assets/icon.png`.

A pool draws its coins as overlapping discs, the way Curve's list does, and for
a **metapool that means the underlying assets**: v2 returns
`[metaToken, basePoolLpToken, …underlying]`, so the World Liberty pool reports
`USD1, crv2pool, USDC, USDT` and shows `USD1 · USDC · USDT`. The LP token in the
middle is plumbing, not an asset. It is dropped by *position* rather than by
address — on newer pools the base LP token is the base pool contract and could
be matched, but on older ones (3Crv, crvFRAX) it is a separate contract and
cannot; a Curve metapool always has exactly two real coins, so index 1 is the
reliable part.

**That distinction turned out to be a live bug, not a cosmetic one.** `coins` is
the decomposed list; the *contract* has `n_coins` of them. `add_liquidity` takes
a `uint256[N]` whose N is part of the function signature, so a metapool deposit
built from the decomposed list was calldata for a function the pool does not
have — and the deposit form showed four fields for a two-coin pool. Everything
that reaches the chain now uses `pool.pool_coins` (`coins[:n_coins]`), and
everything the user reads uses `pool.display_coins`. `balances` from the API
line up with the former.

Two mechanical notes worth keeping:

- **On web, an asset needs a real URL.** Flet treats an `Image.src` that does
  not look like a URL as a path into the Flutter *asset bundle*; `flet publish`
  copies `src/assets/**` to the site root instead, which is not in that
  manifest. A relative path finds nothing and a leading slash is not enough
  either, so the browser build builds an absolute URL from the worker's own
  `location` — there is no `window` in a Web Worker, but there is a `location`.
  Desktop keeps the relative path, which `assets_dir` resolves.
- **Do not wrap a positioned `Stack` child in another `Container`.** The first
  version nested the mark inside a positioning container; the images fetched
  with `200`s and the row reserved the right width, but nothing painted and
  `error_content` never fired either. Setting `left`/`top` directly on the mark
  fixed it.

Every logo degrades to a lettered disc, coloured from the symbol so a token
looks the same everywhere. That is not just insurance against a skipped build
step — plenty of long-tail tokens have no image upstream.

## Themes

Three, cycled by the one button in the header: **light**, **dark**, and
**Chad**. The first two are Material's — one seed colour, and the generator
works out the other forty-five slots. Chad is not generated: it is a hand-set
palette taken from [linux.org.ru](https://www.linux.org.ru), which is the
Tango palette — warm aluminium greys under chocolate, butter and orange
accents.

**Getting the palette right took two attempts, and the failure is instructive.**
The obvious move is to read the stylesheet: pull `combined.css`, find the
`:root` block, copy the hex. That produced a theme that was *plausible and
wrong* — every variable name matched, every value was a different colour. Two
reasons. The site ships several sheets and the default is `tango/`, not the
`waltz/` one linked from its settings page; and within tango the `:root` block
appears **twice**, dark first, light second. A grep finds whichever it finds.

The values below were read off the live page instead —
`getComputedStyle(document.documentElement)` on `/forum/talks/` — which is the
only way to know which sheet and which block actually win:

| variable | | role |
| --- | --- | --- |
| `--main-background` | `#D3D7CF` | the page behind everything |
| `--article-background` | `#EEEEEC` | panels, boxes, dialogs |
| `--text-color` | `#3B4245` | body text |
| `--table-border-color` | `#BABDB6` | the rule between rows |
| `--table-hover-background` | `#AD7FA8` | the row under the pointer |
| `--icon-button-active-color` | `#C17D11` | an active control |
| `--tagpage-group-label-background` | `#E9B96E` | a label that wants noticing |
| `--main-menu-color` | `#8F5902` | the navigation |
| `--tag-color` | `#CE5C00` | tags |
| `--link-color` | `#204A87` | an ordinary link |

The mapping into Material's slots is by *role*, not by name, and `ui/theme.py`
lists each one against the variable it came from. The **row highlight is the
tell**: `#AD7FA8`, a flat plum, is the single most recognisable thing about
that site and the one colour no seed-generated palette arrives at. The first
version had it as a pale amber, which is what the wrong stylesheet says.

Material's ink overlay will not produce it on its own — its default hover is a
translucent tint of the surface — so the Chad theme sets Flutter's own
`hover_color`, scoped to the rows by a nested `ft.Theme` on the container that
holds them. Two earlier attempts at that hover are in `git log`, and both are
worth knowing about:

- **`Event.data` for `on_hover` is a bool in Flet 0.86.** Older Flet sent
  `"true"`/`"false"`. Comparing against the string is a handler that fires and
  does nothing, with no error anywhere.
- **A keyed control is frozen once a rebuild has re-diffed it.** Rows carry
  `key="pool-row-N"` so the integration tests can find them; when Flet matches
  an old row to a new one by key it marks the result `_frozen`, and *any*
  assignment to it then raises `Frozen controls cannot be updated`. So an
  `on_hover` that painted `bgcolor` worked until the first theme change or
  window resize and threw on the next hover. Anything a handler needs to
  change must live on a control that is **not** keyed and outlives the
  rebuild — which is why the theme carries the hover colour and why
  `rebuild()` no longer re-makes the rows at all.

**The shadows are the other half of it.** Material's elevation draws a blurred
gradient; Chad draws a hard offset instead — `blur_radius=0`, one constant
opacity, 3px down and right, 2px for things inside a panel, and 3px *straight
down* for the top bar, which reaches both window edges and so has no side to
cast from. That is what a
shadow under a bordered box looked like before shadows became soft. (The site
itself has no shadows at all — `box-shadow` is `none` everywhere on that page.
These are an addition, in the spirit of the rest.) Because the same shadow
under a Material surface would read as a mistake, every caller asks
`theme.panel_shadow(page)`, which returns `None` unless Chad is on.

Two consequences worth knowing:

- **Switching theme rebuilds the view, not just the colours.** Shadows and the
  row hover are set when a control is built, so `_rebuild_view()` re-makes
  whichever view is on screen. Colour alone would repaint fine.
- **Which theme is on is read off the page**, by `theme.is_chad(page)`, rather
  than tracked in a variable — a control built at any moment then asks the same
  question and gets the current answer.

The button shows the theme you are **in**: a sun for light, a moon for dark,
and the Chad himself for Chad — `chad.png` from
[curve-frontend](https://github.com/curvefi/curve-frontend/blob/main/packages/ui/src/images/chad.png),
which is why it is committed to `src/assets` rather than compiled out of the
curve-assets submodule like everything else. Showing the theme a click would
*get* you is what this did first, and it is unreadable: a moon on a plainly
light screen says the opposite of what is true. The destination goes in the
tooltip, where there is room to say it in words. Drawing an image is also why
the button is a `Container` and not an `IconButton`, which takes only an icon.

The choice is remembered in `SharedPreferences` under `flet-curve.theme` — the
browser's storage on web, a file on the desktop — and put back on load. Both
halves of that API are **coroutines**, and calling one without `await` fails
silently: the write never happens and the read returns a coroutine object that
no `isinstance` will match. The restore therefore runs as a task, so the first
paint is in the default theme and the saved one arrives just after; failure at
either end is swallowed, because a private window with no storage should still
open the app.

## Responsive layout

Every responsive decision comes from one pure function, `layout_for(width)` in
`ui/responsive.py`, and each view is *told* the layout rather than measuring
anything itself. Three breakpoints:

| width | pool list | pool page |
|---|---|---|
| ≥ 1000 | five columns | chart beside the actions |
| 900–1000 | drops **Base APY** | chart beside the actions |
| 760–900 | drops **Base APY** | chart above the actions |
| < 760 | **cards**, sort dropdown | chart above the actions |

Base APY goes first because it is the least decisive number on the row. Below
760px no amount of width-juggling saves five columns, so a row becomes a card:
identity on one line, the figures underneath, each with its own label since
there are no column headers left to read them against — and the headers are
replaced by a sort dropdown, because you cannot click a column that is not
there.

Two things this exposed, both real bugs rather than cosmetics:

- **`page.on_resize` fires on changes, not at startup**, so a window that
  *opened* narrow never learned it was narrow. The layout is now applied on
  first load as well.
- **A flex child inside a scrolling Column is a Flutter layout error**, not a
  visual glitch. The stacked pool page scrolls the page, so the action panel
  there takes a fixed height instead of `expand` — the two arrangements need
  opposite scrolling, which is why `_arrange` rebuilds rather than reflows.

### Testing it without a window

The breakpoints are a pure function of a number, so `tests/test_responsive.py`
checks them exhaustively — at real device widths, at the exact boundaries, and
that columns only ever *shrink* on the way down — with no window at all.
`tests/test_views.py` then checks that each view actually reconfigures.

That matters because **Flet's integration tests cannot resize the page in
device mode** (`flet_app.page` is not bound; `resize_page` raises "page is not
initialized", and host mode wants a Flutter test host this project does not
provision). The UI suite therefore runs at whatever the test surface is — which
turns out to be under 760px, so **those seven tests exercise the phone
layout**. They caught the stacked-layout crash above. The wide layout is
covered by the unit tests plus a browser pass.

## Talking to the pools

`curve/abi.py` computes selectors with keccak-256 instead of hard-coding them,
which is the opposite of what `wallet/erc20.py` does — and deliberate. ERC-20 has
five fixed signatures; Curve's depend on the pool:

| | StableSwap | CryptoSwap |
|---|---|---|
| `pool_type` (v2) | `main`, `factory`, `crvusd`, `stableswapng` | `crypto`, `factory_crypto`, `factory_tricrypto`, `twocryptong` |
| coin index type | `int128` | `uint256` |
| `exchange` selector | `0x3df02124` | different |

`add_liquidity` takes a *fixed-size* array, so a 2-coin and a 3-coin pool are
different functions again. That is dozens of variants, and the failure mode is
not loud:

> **Calling a function a Curve pool does not implement returns empty data, not a
> revert.** `decode_uint("0x")` is `0`, so a mis-typed pool would quote every swap
> at zero output rather than failing.

Confirmed against mainnet: a StableSwap-signature `get_dy` sent to tricrypto2
returns `0x`. Every read in `curve/pool.py` therefore rejects empty return data,
and a real 32-byte zero is still accepted as the legitimate answer it is.

The encoding was verified against a live node before any of it was wired to a
button — `calc_token_amount` for 1000 DAI into 3pool returned 962.16 LP, which is
exactly 1000 ÷ the pool's 1.0398 virtual price.

Two smaller decisions worth stating: approvals are for the **exact amount**, not
`MAX_UINT256`; and gas and nonce are never set, because every wallet in scope
fills them in and knows the chain better than this app does.

## Checks

```bash
uv pip install --python .venv/bin/python mypy ruff hypothesis   # once
.venv/bin/python tools/check.py                       # ruff, mypy, pytest
.venv/bin/python tools/check.py --fix                 # let ruff fix first
```

Both tools are configured in `pyproject.toml`, so an editor and this script
agree by construction. Ruff earned its place immediately: it found an
`except WalletError` in a module that never imported the name, so the handler
written to swallow a failed disconnect would have raised `NameError` instead.
That one is now pinned by a test.

`ruff format` is deliberately **not** part of this. The formatting here is
hand-set — aligned comments, tables in docstrings, wrapped prose — and letting
a formatter reflow it would cost more than it returns.

Mypy checks `src` and `tools` with nothing excused. The tests are checked too,
but with the error codes a test double trips by existing switched off
(`arg-type`, `attr-defined`, `method-assign` and friends): a fake API passed
where `CurveApi` is declared is the point of the file, not a mistake in it.

One thing worth knowing about Flet's own hints, since they are good but not
complete: `ft.ControlEvent` is `Event[BaseControl]` to a type checker, and
`Event` is invariant, so a handler annotated with Flet's own alias cannot be
passed to `TextField(on_change=…)`, which wants `Event[TextField]`. Naming the
concrete control does not work either, because several handlers here are shared
between a TextField, a Dropdown and a RadioGroup. `ui.AnyEvent` is the accurate
type — `Event[Any]`, which is what the alias resolves to at runtime anyway.

## Testing

Four layers, and the first three need nothing at all:

```bash
.venv/bin/python -m pytest tests/ -q                      # 634 tests, ~9s
HYPOTHESIS_PROFILE=deep .venv/bin/python -m pytest tests/test_stateful.py
.venv/bin/python -m pytest tests/integration -m flet_ui   # 6 tests, ~25s each
```

**1. Logic tests.** `curve/` imports no Flet, so its ABI encoding, parsing,
sorting and formatting test as ordinary Python. `test_pool.py` drives
`PoolContract` against a fake EIP-1193 provider that records calldata and answers
from a script, covering every transaction without a wallet. `test_feed.py` covers
the paging cursor, including the race where a page arrives after the query
changed and must be discarded rather than appended to a different sort.

**2. Constructor tests.** `test_views.py` builds every view against a stub page.
Flet validates control arguments in `__init__`, so this catches the whole class of
"wrong keyword for this Flet version" bug in half a second — it found
`on_scroll_interval` (it is `scroll_interval`) and `ft.Tab(content=…)` immediately.
What it cannot see is layout, hit-testing or paint.

**Looking at it.** Three environment variables open the app somewhere other
than the front page, which is the difference between one command and a
sequence of hovers and clicks — and on the desktop build there is no address
bar to shortcut with:

```bash
CURVE_ROUTE=/ethereum/portfolio CURVE_THEME=chad .venv/bin/flet run src/main.py
CURVE_WINDOW=390x844 .venv/bin/flet run src/main.py       # a phone
```

`CURVE_ROUTE` takes any route the address bar accepts; `CURVE_THEME` takes
`light`, `dark` or `chad` and skips the remembered one; `CURVE_WINDOW` takes
`WIDTHxHEIGHT`. All three are ignored when unset, so a normal launch is
unchanged.

`CURVE_WINDOW` is not the same test as resizing a window down to a phone's
width, and the difference is the point: opening narrow paints once, resizing
paints twice, and a control that is *told* about the new layout but never
*asked to redraw* looks correct in the first case and wrong in the second.
That is exactly the shape of the bug it was added to chase down.

That matters more than it sounds, because **the desktop window can be captured
from the X server** and the browser cannot be trusted to screenshot itself:

```bash
wmctrl -lx | grep flet.Flet             # find the window
import -window 0x07a00003 shot.png      # ImageMagick, whole window
```

Chrome's DevTools screenshots of this app intermittently come back missing
every token logo — text renders, images do not — which sent a long hunt after
a bug that was never in the app. An `import -window` capture of the real
window has never lied. It is also how the logo sampling was chosen: the same
mark rendered eight ways at 27px, captured, and magnified.

**3. Stateful tests — `test_stateful.py`.** The layers above check one
transition each. This one checks that no *ordering* of transitions leaves the app
broken, which is a different question and the one that had been going unasked:
the bug that shipped was "switch theme a few times, then hover a row", and every
step of it passed its own test.

A Hypothesis `RuleBasedStateMachine` drives the real `CurveApp` — theme cycling,
sorting, searching, resizing, chain switches, opening a pool, Back, deep links —
and fires handlers it picks out of the live control tree by index rather than by
name, so it reaches handlers written after it. Invariants assert what must always
hold: the theme's decorations match the theme, the route matches what is on
screen, and nothing the app will later assign to has been frozen.

**What makes it more than a smoke test is that it runs Flet's real diff.**
`tests/fake_session.py` calls `ObjectPatch.from_diff` and then serialises what
the diff reports as added — the two halves of a real update — so a keyed control
that a rebuild re-made ends up `_frozen` exactly as it does behind a browser.
Put the shipped hover bug back and the machine finds it in about four seconds,
shrunk to a handful of steps. It also found one that had not been noticed:
switching theme while a pool page was open left the *list* wearing the old
theme, so pressing Back landed on a table with no border, no shadow and the
wrong hover.

Two profiles: the default keeps it to a few seconds so it stays part of
`check.py`; `HYPOTHESIS_PROFILE=deep` runs 500 examples of 80 steps (~7 minutes)
for when something smells.

**4. UI tests — `flet.testing`.** Seven tests that start the real app and drive it:
`find_by_key`, `tap`, `enter_text`, `pump_and_settle`, screenshots. They are
marked `flet_ui` and excluded from the default run.

> An earlier version of this README claimed these needed a pre-installed Flutter
> SDK. **That was wrong.** `flet-cli` downloads and provisions Flutter itself (to
> `~/flutter/`) on first use. Budget ~5 minutes for that first run; warm runs are
> ~25s per test.

They earn their keep: every bug in this project so far has lived in exactly the
layer only they can reach.

- A `TextButton` column heading that hovered correctly but never fired
  `on_click` in a published build — no exception, the event simply never arrived.
- `ft.Tab(content=…)`, which blew up only when a pool page was opened.
- **`ft.TabBarView(height=520)` raised a widget exception in a Flutter debug
  build.** The browser release build rendered it perfectly, so nothing but this
  suite was ever going to catch it. Sizing the view by `expand` inside an
  expanded `Column` fixes it. Bisecting to that took a while — the first two
  suspects (the composition `DataTable`, the fixed-width action panel) were both
  wrong, though replacing the table with plain Rows did fix a real `$1.`
  formatting bug on the way past.

Two limits worth knowing before adding to `tests/integration/`:

- In device mode (the default) `flet_app.tester` is a `RemoteTester`, whose API
  is a **subset** of `Tester` — `find`/`tap`/`enter_text`/`take_screenshot` are
  there, **`drag` is not**. So scrolling cannot be driven from a UI test, and the
  scroll-triggered paging is covered by a unit test plus a manual browser pass
  instead.
- `pump_and_settle` returns when animations stop, which is long before a network
  call answers. Every wait in that file is a polling loop.

`tests/integration/conftest.py` raises `FletTestApp`'s output cap, because the
default 256 KB keeps only a tail of the Flutter process's very chatty debug log —
and the exception that actually failed the test scrolls off it, leaving nothing
but `Test failed. See exception logs above.` Set `FLET_TEST_VERBOSE=1` to stream
it live instead.

## Flet 0.86 notes

Things that cost a debugging round here, beyond the ones already in
flet-pay-example's README:

- **A `key` makes a control read-only after its first rebuild.** When Flet
  re-diffs a list and matches an old item to a new one by `key`, the survivor
  is marked `_frozen`, and every property assignment on it then raises
  `Frozen controls cannot be updated` — from inside an event handler, where it
  surfaces as an unhandled error and not as anything the caller can catch. Keys
  are for finding controls (integration tests, in this app); state that
  handlers mutate belongs on an unkeyed control that outlives the rebuild.
- **`SharedPreferences.get`/`set` are coroutines**, and `page.shared_preferences`
  is deprecated in 0.86 (removed in 0.90) in favour of constructing
  `ft.SharedPreferences()`, which registers itself with the page. Calling either
  method without `await` fails silently — see the themes section.
- **Charts are not in core — they are in `flet-charts`.** An earlier version of
  this app drew candles by hand on `flet.canvas` because core has no chart
  controls and I did not check for a separate package. `flet-charts` is official,
  released on the same version line, and has `CandlestickChart` among others.
  It is pure Python — the Dart side ships with the standard client — so
  `flet publish` still needs no Flutter build. See the chart section above.
- **`ChartAxis` labels must sit on multiples of `label_spacing`.** The chart ticks
  at multiples of the interval counted from zero and only renders a label whose
  value lands on a tick; labels at `min + i*step` are silently dropped, leaving
  an axis showing just its min and max.
- **`GestureDetector` is how you add pan/zoom/hover to anything.** `on_pan_update`
  carries `local_delta`, `on_scroll` carries `scroll_delta` plus `local_position`,
  and `on_hover`/`on_exit` carry `local_position` — enough to drive a viewport
  without the wrapped control knowing. `drag_interval`/`hover_interval` throttle
  at the Dart end, and it is worth throttling again in Python.
- **A canvas overlay does not need to be hit-testable.** Stack the crosshair
  canvas *over* the chart and wrap the whole stack in one `GestureDetector`:
  the overlay never intercepts a drag, and the chart never repaints on a
  mouse move.
- **`Tabs` was restructured.** `ft.Tab` no longer takes `content` — it is only the
  button. The container is `Tabs(length=N, content=…)` holding a `TabBar` of
  `Tab`s and a `TabBarView` of bodies, and `length` must match both. Size the
  `TabBarView` with `expand`, not a fixed `height`: a fixed height raises a
  widget exception in a Flutter debug build while rendering fine on web.
- **`ListView` uses `scroll_interval`, not `on_scroll_interval`**, and it
  virtualises — only the rows currently on screen exist in the widget tree, so
  `find_by_key` cannot see a row that has scrolled out of view.
- **`Container` has no `scroll`**; wrap the child in a `Column` that does.
- **`control.page` raises `RuntimeError` when the control is not mounted**, rather
  than returning `None`. So `if self.page: self.update()` raises the very error it
  looks like it is guarding. There is no public `is_mounted`; `ui.safe_update()`
  attempts the update and swallows that one case.
- **Subclassing a control means `page` is taken.** `ft.Column` defines it as a
  read-only property, so a view that stores its own `self.page = page` dies with
  "property 'page' of … has no setter".
- **A `TextButton` in the table header hovered but never fired `on_click`** in the
  published web build — no exception, the event simply never arrived, while the
  identical handler on a `Container` in the same list worked. The column headings
  are `Container(on_click=…, ink=True)` for that reason; the full-cell hit target
  is better anyway.
- **The web build's font has no arrow glyphs.** `→` and `↓` render as tofu boxes
  in the browser and fine on desktop. User-visible strings stay ASCII (`·` and `–`
  are verified exceptions) and the sort arrow is a Material icon.
  `test_user_visible_strings_stay_within_ascii` pins it.
- Axis labels need precision derived from the **span**, not the magnitude: a
  stable pool ranging over 1.0268–1.0271 prints "1.027" three times at four
  decimals.
- `SegmentedButton.selected` is a `list[str]`, not a set.
- `page.run_task` wants a coroutine *function* plus its arguments; hand it a bare
  coroutine object and it raises `TypeError`.
- `DataTable` sizes itself from its content and will not shrink, so it overflows
  a narrow parent. Plain `Row`s with fixed-width `Container` cells flex down.
- **`flet publish <path>` resolves dependencies relative to that path's
  directory**, not the repo root — so it silently ignored the root
  `pyproject.toml`, shipped a requirements list of just `flet`, and the app
  failed in the browser with `ModuleNotFoundError`. Run `flet publish` from the
  project root with no path; it reads `[tool.flet.app] path` and writes `./dist`.

## What was verified

Not claims — these were run:

- **The API client against the live endpoints**: 385 Ethereum pools over the TVL
  floor, all four server-side sorts, paging to 150 rows, search, the detail
  endpoint, chain totals, and both candle series (`lp_ohlc` and `ohlc`). Numbers
  match Curve's own UI — 3pool at $160.0m TVL, crv2pool's CRV range at
  1.56%→3.90% against Curve's 1.57%→3.91%.
- **The calldata against a mainnet node**, before it was wired to anything:
  `get_dy` (both index widths), `calc_token_amount` (both spellings) and
  `calc_withdraw_one_coin`, plus the confirmation that a wrong-width `get_dy`
  returns `0x` rather than reverting.
- **All twelve function selectors** against the values deployed on 3pool and
  tricrypto2.
- **The browser build driven in Chrome**: Pyodide boots, `pyfetch` reaches both
  APIs, the list renders and reorders, scrolling to the end pulled pages 2-5
  ("250 of 385 pools"), a pool opens onto a live candlestick chart, the
  timeframe buttons re-fetch, and all four action tabs render with their
  controls correctly disabled while no wallet is connected.
- **The chart, driven in Chrome** from the published build: wheel-zoom narrowed
  the window from May–August to 31 May–20 June anchored on the cursor, dragging
  panned both time and price, and the crosshair read out `1.0250`, `05 Jun
  00:00` and `O 1.0261 H 1.0262 L 1.0140 C 1.0254` for the candle under it.
  Axis labels correct at every scale; switching timeframe re-fetches and
  re-draws.
- **154 unit tests** with no display and no Flutter, plus **7 UI tests** driving
  the real app through Flet's own framework.

Not yet exercised: a signed transaction. The read path, the encoding and the
approve/submit gating are all verified, but nothing here has been broadcast from
a funded account — deposit, withdraw, swap and stake have not been run end to
end against a real balance.

## The Swap tab

Any coin to any coin, across pools, through
[electric-router](https://github.com/michwill/electric-router) -- which is a
different program from the rest of this app and is vendored as a submodule.
It models the pool universe as a linear resistor network with diodes, solves
for the flow, and settles the result through `ElectricRouter.execute` in one
transaction.  Its own `docs/theory.md` is what it is; this is how it got here.

### Three costs, paid at three rates

    warm       once per chain, ~25 s     6,174 slots, 388 pools, 866 arcs
    set_pair   when a coin changes, ~60 ms
    quote      per keystroke, 100-400 ms

Warming sweeps every storage slot the universe reads into an in-process EVM,
after which a `get_dy` costs microseconds instead of a round trip -- which is
what makes quoting as someone types possible at all, and what makes the
wei-exact model gate affordable enough to run in a browser rather than trust
from a file.

**The sweep should cost what the CLI's costs**, and checking that it did found
two reasons it did not.  `RouterSession._batched` chunked by the transport's
batch size and awaited each chunk before building the next, so a transport
that chunks and streams internally never had more than one request in flight;
and `router/rpc.py` assumed Erigon's ceiling of 100 requests a batch, where
the endpoint that actually ships serves 2,000.  Between them, 6,174 slots took
16.9 s against `erouter route`'s 1.3 s over the same endpoint at the same
block.  The ceiling is now asked for once -- one request, with the method
about to be sent, because a node may cap by payload size or by method -- and
the sweep goes over in groups of `batch_size * max_streams`.  1,369 ms, which
is the CLI's number.

`router/host.py` owns that timing, and its rules are what make three costs
read as one thing: the newest amount wins with no queue and no debounce, an
amount typed while the bar is still moving is answered when it stops, an
answer for a pair the reader has left is dropped rather than drawn, and a warm
that could not read everything refuses to quote at all rather than quoting
against zeros.

One rule belongs to the view rather than the host: **nothing that arrives
while someone is typing may update the subtree the amount field is in.**  A
Flet update sends the *server's* copy of a control back to the client, and the
server's copy of a field lags the keystrokes still in flight -- so the stacked
route, which used to be added to the column when the first quote arrived,
turned "2000000" into "2" at the exact moment its first answer appeared.  The
frame is in the tree from the start now and only its own `visible` changes.

### What is compiled, and where it comes from

The solver and the EVM are Rust.  A desktop build loads them as two CPython
extensions; a browser cannot -- a PyO3 wheel would have to match Pyodide's own
Emscripten build *and* a pyo3 that targets its CPython -- so the browser loads
one `wasm-bindgen` module (1.43 MB, 467 kB gzipped) and `erouter.wasm`
registers it under the same two names before anything imports them.

    python tools/build_router.py            # package + data + wasm
    python tools/build_router.py --native   # and the desktop extensions

All three outputs are gitignored build products, like `src/assets/curve`.  The
toolchain is user-local and needs no root; `vendor/electric-router/rust/README.md`
has the four commands.

### Slippage is per leg, and it is not a number you type

Every leg carries its own minimum rate, derived from the *least* its own pool
can charge rather than what this trade pays -- an attacker front-runs in small
balanced trades near `mid_fee` while the leg they wrap around pays the dynamic
fee at its own size, which on TricryptoUSDC is 3 bp against 13.  A single
end-to-end bound would let a route be robbed in one pool and made whole in
another, which is the shape of a sandwich.  The widget shows what the bounds
add up to: `auto · 5.20 bp` is how far under the quote the call is allowed to
settle, in total.

### What it costs, before the approval

The gas figure comes from executing the whole call locally, not from
`eth_estimateGas` -- the chain will not estimate a transaction whose token has
not been approved yet.  Neither will a local run, for the same reason: it
reverts at `transferFrom`.  So the local run gets the approval it is missing.
`gas_probe.Funder` finds the token's allowance slot by writing a marker and
asking the token's own `allowance` whether it landed, which needs no advance
knowledge of any token's layout, and the figure is marked `≈` because it was
measured with an approval that is not there yet.

**Only the approval, and only for a wallet that already holds the coin.**  A
wallet that does not gets no figure rather than a figure for a trade it cannot
make; impersonating a real holder is a fork trick with a great deal behind it
that this does not need.  Both slots the search touches are re-read from the
chain afterwards -- the search writes markers into the balance slot to identify
it, and left behind either would make the next *honest* dry run agree to a
transaction that cannot go through.

The figure includes setting the router's own approvals to the pools
(`set_approvals`, which the call carries), so it is the conservative number: a
route through pools the router has already approved costs less.

Getting there needed the discovery to be faster than it was.  A local EVM can
only report the layer of calls it stopped at, so the miss loop bought exactly
one layer per round trip and a sixteen-leg route is twenty-four of them.
`eth_createAccessList` answers the same question in one -- it needs the
endpoint's key to be scoped for the router, which the committed one now is --
and what it does not cover, because the call it is asked about reverts for
want of that allowance, the loop still finds.  A route's first plan costs
6.3 s against 8.7 s, and every plan after it on the same route costs 1.1 s.
`FILL_ROUNDS` also went from 12 to 64: twelve was not a backstop but a ceiling
the route hit, and it gave up mid-route reporting a Maker slot as unreadable
that the endpoint answers happily.

### After an approval, before the swap

The router reads through a load balancer, which is many nodes at slightly
different heights.  A node still on block N-1 cannot see an approval that
confirmed in block N -- so the plan is priced against a chain where it has not
happened, and the dry run reverts on an allowance that is there.  The tab then
says the route would not go through, which is simply wrong, and it depends on
which node answered.

So the tab remembers the block each of its own transactions confirmed in, and
`plan_call` takes it as `not_before`: the newest block is asked for again until
the endpoint is at least there.  Briefly -- this is a second or two of lag, not
a reorg -- and an endpoint that never catches up is planned against anyway,
because a plan on a stale block is one the dry run will speak up about and
refusing would be deciding that a slow endpoint is a broken one.

An approval also re-*plans* rather than only re-checking the allowance: the
plan in hand was built before it, and its dry run says the route reverts.

### Before it is signed

The route is re-priced against state read at the newest block, the whole call
is executed locally, and the transaction is only offered if that execution
succeeded.  This is not belt and braces: a leg's minimum rate is derived from
what its pool would really pay, and `docs/router.md` measures 37.9 bp of drift
per leg against a 13.9 bp tolerance -- a bound set against stale state is a
promise about a number nothing checked.

It also means the tab knows *why* a route will not go through.  With the mock
wallet, which reports an allowance it does not have on mainnet, clicking Swap
answers `This route would not go through: ERC20: transfer amount exceeds
allowance` and sends nothing.

### Where the pool list comes from

`CurveApi.chain_totals` already downloads every pool on the chain -- 2.4 MB on
Ethereum -- to read two numbers off the top, so the router routes over the rest
of it and the coin picker is ordered by the summed 24h volume of the pools
holding each coin.  What someone means by a coin is the one being traded; TVL
says which is being *held*, which is a different question.  One pass over rows
that are already in hand -- a dict of address to summed volume, then one sort
-- so the pickers are filled before the backend has loaded, let alone warmed.

**The coins someone already holds come first, on the side being sold.**
Volume is the right order for somebody looking for a market and the wrong one
for somebody looking for their own coins, which are the ones they came to
spend -- so `router/holdings.py` reads what the wallet has across the whole
list and lifts anything worth more than a dollar to the top of the *sell*
picker, ordered by what it is worth, with the amount and the dollars in the
row.

The buying side keeps the plain order.  What somebody already holds says
nothing about what they want to buy, and a balance shown against a coin they
are buying is answering a question they did not ask.

`token_amount` gives a quantity four decimal places *or* as many as it takes
to show three significant figures, whichever is more.  Eight-decimal coins
make the second case ordinary: $1.45 of tBTC is 0.0000188 of one, which at
four places is "0" -- and a zero says the wallet holds nothing, which is a
different thing from holding a little.  Trailing zeros still go, so a quantity
that *is* 0.0001 is not padded out to pretend at precision it does not have.

That change had a reader: `claimable` decided whether a reward was worth a
transaction by asking whether the formatter printed "0", which was the same
answer for as long as four places was all a quantity ever got.  It is
`format.is_dust` now, in one place, asked as the question about size it always
was -- a gauge accrues CRV every block, so an account that claimed a minute
ago is owed a few wei of it and should not be offered a transaction that costs
more than it collects.

A dollar rather than a non-zero balance, because a token's own units say
nothing: 1 wei and 1 USDC are both "1", and a dusty airdrop above the busiest
market on the chain would be the list lying.  A coin with *no* price is not
promoted either -- worth nothing that can be measured is not the same as worth
a lot.

Two things it does not do.  It does not ask per coin: three hundred coins is
three hundred requests that way, so the `balanceOf` calls go through
Multicall3 the way `curve.portfolio` already reads a wallet's positions --
measured at 303 coins in 2 requests and half a second, plus one for the
chain's prices, which the Prices API serves in bulk.  And it does not go
through the router's endpoint: that key is scoped to reads and `eth_call`
against the quoter and the router, and answers a token's `balanceOf` with a
403.

It also runs *behind* the pair rather than before it.  Which coins someone
holds decides the order of a list that is already usable, and two requests for
an ordering should not hold up the pickers being filled.

The picker itself is a `SearchBar` rather than the `Dropdown` the pool page
uses, because a chain has hundreds of coins and a pool has three; but it is
*dressed* as that dropdown, since a control that does the same job in the same
app should not look like a different kind of control.  That means the same
corner, the same height, the same weight of text, the same 20px mark -- and
`theme.field_border()`, because a Material text field draws its outline with
Flutter's `const BorderSide()` rather than with a scheme colour, and matching
it needs the constant rather than a token that merely resembles it in one of
the themes.  Written as hex, at that: `Colors.BLACK` resolves to *nothing* on
a `SearchBar`'s `bar_border_side` and the frame is simply not drawn, where
`#000000`, `with_opacity(1, BLACK)` and every scheme token all draw.  A probe
of the five side by side is what found it.

The rest of the widget follows the pool page too.  The balance is the amount
box's own hint rather than a caption under it -- a hint shows only while the
box is empty, which is exactly when the balance is worth reading, and it buys
back two lines on a widget that has to fit a phone.  Just the figure, in ink
paler than a typed one: the box has the coin named beside it, so "Balance" and
"USDC" were two of three words already on screen, and what is *not* obvious is
that the number is not an amount being swapped -- which is a job for the
colour, not for a caption.

Connecting *after* the tab is open works too, which it did not: everything
wallet-shaped here is read through a callable, so nothing was ever stale -- it
was simply never asked again.  `CurveApp._wallet_changed` told the pool page
and the portfolio and not this one, so someone who opened Swap first and
connected second got no balance, no MAX, and an approval step decided when
there was no account to decide it for.  All four wallet events reach it now,
disconnection included: a figure left on screen after the wallet has gone is a
figure for nobody.

It is there before the warm is, and so is MAX.  What a wallet holds is a
question for the wallet and needs none of the twenty seconds of pool state, so
`_read_balances` runs before `host.open` rather than after it: the figure and
the button are ready while the bar is still moving, which is when someone is
deciding what to type -- and an amount typed then is answered the moment the
warm ends.

The amount box, the coin beside it and the two buttons under it are all one
height, because they are what the widget is for; the five lines of detail
between them are not.

The green confirmation under them is flat, like the bands above it.  It
carried Chad's inset shadow, which is the idiom for a *well* -- something
pressed into the panel, the way a button is -- and a line of text is not one;
beside the price impact, which is the same kind of thing said the same way, it
read as a different control that happened to be tinted.  `StatusPanel` is
shared, so the pool page's and the portfolio's confirmations lost it too, and
each of those already sat beside flat bands of its own.

The price impact sits in
the same flashing band the pool page uses, from the same `ui/alarm.py`: two
tabs making the same judgement about the same figure should not have two
timings the moment either is tuned.  Every figure under the amounts is a band
and only that one is ever tinted, so the row does not grow the moment it has
something to say.

### The diagram

`ui/routegraph.py` is the geometry with no Flet in it, and it is tested without
a window for the reason `viewport.py` is.  Its one subtlety: `share_pct` is a
share of what leaves a leg's *own* node, so the last leg of a 60/40 split reads
100 -- drawn as it comes it would look like the whole trade.  The flow is
carried forward instead, in one pass, because the bus order is topological.

The rest is a Sankey, and the parts of one worth naming:

- **Columns are layers.**  A route is a DAG, not a chain, so bus `k` in column
  `k` let a leg run backwards.  Each bus sits in the column of its *longest*
  path from the source, over a topological order rather than over the list of
  legs -- that list is ordered for execution, and reading it directly put a
  token in the column before the token it is made from.  A leg that closes a
  cycle (the router does say "4 pool(s) used more than once") is left out of
  the layering; relaxing over one pushed every bus rightwards until the whole
  picture was crushed into the last fifth of the frame.
- **A leg that spans several columns gets a lane through each of them.**
  Without one it was a single curve between its two ends, drawn straight over
  whatever lived in between -- which is what a sixteen-leg route mostly looked
  like.  It now has a point on each side of every column it passes, and those
  points are ordered along with the buses, so it threads between them.
- **Ordering within a column is Sugiyama's**, and it needs all three of its
  parts.  Barycentre sweeps in both directions place things at the average
  height of what they join; an adjacent-swap pass then fixes what a
  barycentre cannot see, because a barycentre is a *position* and what is
  being minimised is crossings; and the best order seen is kept, counted
  rather than assumed, since neither heuristic improves monotonically.  The
  swap pass also steps sideways -- takes a swap that changes nothing -- once
  per pair, because some improvements need two columns to move together and
  neither move pays on its own.  On the route this was reported against that
  was the difference between two crossings and none.
- **A bus's ribbons leave and arrive in the order of the bus at the other
  end**, so two legs sharing a node do not swap places crossing it.

Optimal ordering is NP-hard; all of the above is the cheap part of it, on a
graph of a few dozen items.  It stops as soon as nothing crosses, which most
routes reach on the first pass -- worth doing, because this runs on every
keystroke and on every frame of a window drag.  Five real routes, eight to
seventeen legs: 2.3 ms each, no crossings in any of them.  Before the swap
pass the same five had four; before the lanes, most of a sixteen-leg picture.

The two ends are named under their bars, with the token's logo beside the name
-- looked up by the address the router says the rail holds, because a symbol is
ambiguous across chains and is not what the asset bundle is keyed on.  Only the
two ends: what the trade is *between* is the pair, the columns in between are
accounted for by the pools on the ribbons reaching them, and naming every one
of them put a name every twenty pixels on a long route.

Each ribbon carries the pool it goes through, with that pool's coins stacked in
front of the name the way the pool list draws them, so a pool reads as the same
object in both places.  The name is written along its longest straight
run rather than at its midpoint: a leg spanning several columns has its middle
over one of them as often as not, and a name there sits on a bus instead of on
the flow.  Biggest ribbon first, since where two names will not both fit the
one carrying more of the trade is the one worth reading, and a ribbon too thin
to hold the text keeps quiet.

The registry's name loses its boilerplate ("Curve.fi Factory Plain Pool: " is
on a great many of them), and a leg whose name is just the two tokens either
side says what it *is* instead -- a vault deposit is listed as "crvUSD ->
scrvUSD", which the picture has already said twice, where "deposit" it has not
said at all.

Both kinds of label claim a *box* rather than a distance along the row, and
give way to whatever claimed the space first: the destination's is nudged back
inside the frame, and against a fixed step that nudge landed it on its
neighbour.  Each sits on a chip, because a name that lands on a ribbon is
otherwise unreadable.

The picture can also be saved.  `routegraph.to_svg` is a second renderer over
the same `layout` -- text, identical on both platforms, and it scales, which a
screenshot of the canvas would not.  It names every column, unlike the screen:
there are no marks in a file, so a name is all a token in the middle has.

The button sits in the picture's own top corner rather than the widget's, and
only once there is a picture: it acts on the route, so it belongs on it, and
an empty frame has nothing to save.  Positioned in the frame's stack rather
than given a row, which would take height off the drawing.

`ui/download.py` hands it over, and neither platform was quite the obvious
thing.  A desktop build opens the save dialog every other program does, and
the bytes go to `FilePicker.save_file` itself so there is no window in which a
path exists with nothing in it; a dismissed dialog answers `None`, which is a
decision and not a failure, and the tab says nothing rather than reporting a
file that is not there.  Flet's picker shells out to **Zenity** on Linux,
though, and without it the dialog silently never opens -- so that is checked
for up front and a build without it writes the file and names the path.

On the web it took a third attempt.  Flet
runs this app's Python in a module Web Worker and a worker has no `document`,
so the obvious `<a download>` cannot be built there.  A blob URL made in the
worker is valid on this origin, but Flet's `launch_url` will not open one --
and will not open a `data:` URL either, since Flutter's launcher takes http-ish
schemes and drops the rest without a word.  So the file goes over a
`BroadcastChannel` to `download_bridge.js`, which is how the wallet already
crosses the same gap; `tests/test_download_bridge.py` drives that half under
node.  A desktop build just writes the file, and says where it put it.

### Native and wrapped, which is not a route

WETH is not a pool.  `deposit()` mints one wrapped token per wei and
`withdraw(n)` burns them back, exactly, for ever -- there is no curve, no fee,
no slippage and nothing to solve.  The router *can* carry it as a leg, but
doing so costs an approval on the wrapped side and sends a 1:1 identity
through a contract that has to be told about it.

So `router/wrapping.py` short-circuits: the same widget, the same picture, and
a call straight to the wrapper.  **No approval either way** -- a deposit rides
on `msg.value` and a withdraw burns the caller's own balance -- which is the
difference between one transaction and two.  `RouterContract.needs_approval`
is told so explicitly, because a withdraw does spend an ERC20 and asked the
usual way it would report a missing allowance with the wrapped token as its
own spender.

The figures say what is true rather than dashes: no pool, no slippage, no
impact, and a rate of one.  And it needs no warm at all, so ETH to WETH is
answered while the router is still reading state -- which is also why the
detection lives in the page rather than in the host, since it needs nothing
the host has.

### Marks that are not there

`build_assets` bundles a chain by globbing its whole mark directory, so once
the second half has landed the bundle's keys are every mark that exists.  A
desktop build could always tell -- `_exists` looks for the file -- but a
browser cannot, so an address the bundle did not know was asked for one by
one, and each one 404'd and was retried.  The pool list never noticed: it
shows a page of pools at a time, and their coins are the ones in the hot half.
The Swap tab's picker offers *every routable coin on the chain*, hundreds of
them, and turned that into a screenful of 404s every time it opened.

So `assets.have_every_mark` records which bundles are complete, and
`token_logo` stops asking once one is.  A 404 on the second half counts as
complete too: only a chain too big for one bundle gets a `-rest`, so its
absence says the first half was everything.  A *dropped* second half does not
-- a connection that went away says nothing about whether the file exists --
which is why `ApiError` now carries its status.  Measured on Ethereum, 627
marks against a picker of many more: 48 requests to open the picker, then
none.

### When it will not route

"It failed once" is not a report, so a failure writes itself down.  The line
on screen ends with the block it happened at -- `erouter route --block N`
takes exactly that number -- and `router/incidents.py` keeps the rest in
`$XDG_STATE_HOME/curve-flet/swap-failures.jsonl`: chain, block, both token
addresses, the amount as typed, and which solver answered.  One JSON object
per line, appended, said to stderr as well, and it never raises: this runs on
the failure path, and failing to write down a failure must not become the
failure anyone sees.  A browser gets the console line only, since Pyodide's
filesystem does not outlive the tab.

Written after a morning of not reproducing one.  A browser saw USDC to USDT
come back "src not connected to dst through the active set" for sizes that had
routed a minute earlier; 1,368 quotes across sixty blocks, both solvers, every
ordering of sizes, and six refresh cycles would not do it again.  What the
message *does* mean is now on the record: it is what the solver says when no
path through the active set can carry the size asked for, which for a hundred
trillion USDC is the right answer and for a million is not.

The same run turned up something else: 62 of those plans were refused for a leg
carrying two wei through a tricrypto pool, and **no quote ever produced such a
leg** -- 591 quotes with planning off found none.  The dust appears when
`plan_call` re-prices the chosen route at a newer block, not when the route is
chosen.

The router has since answered the refusal itself.  A leg's bound was a fraction
of its pool's fee, and on a leg carrying a few raw units of an eight-decimal
token that fraction is smaller than one unit -- a rate that does not exist, so
the leg was called unbounded and the whole route refused, which is the wrong
answer to a trade that is simply small.  It now takes the tightest rate that
still admits the quote, and `unbounded` means what it says: the floor really
rounds to zero.  Measured here, $14.48 of tBTC to USDT was refused before the
change and encodes after it, at 5.00 bp with nothing unbounded.

### What is not there yet

- **Custom slippage.** "Auto" is the router's own per-leg bound and is the only
  setting; a manual one would replace a measured number with a typed one and
  has to be designed rather than exposed.
- **A gas figure for a wallet that does not hold the coin.** The estimate
  below grants the approval locally; it will not grant a *balance*, because
  that would be quoting the cost of somebody else's swap.
- **Chains without a deployed quoter.** The tab needs `Chain.quoter` and a
  committed slot cache, which is fifteen chains today.

## Deliberately not built

- **~~No router.~~** There is one now -- see "The Swap tab" above. The *pool
  page's* swap is still `exchange` on that one pool, which is what someone
  looking at a pool means; the Swap tab is the cross-pool one.
- **No balanced-deposit helper.** Deposits go to `add_liquidity` with explicit
  per-coin amounts. (Metapool underlying deposits *are* built, through the
  zaps — see below.)
- **Withdrawal floors on the balanced path** are derived from the reserves the API
  reports rather than from `calc_token_amount(…, is_deposit=False)`. Sending zero
  floors would be simpler and is what many UIs do; it also offers no protection
  against a sandwich.
- **No claim-rewards button.** Staking and unstaking are there; `mint`/
  `claim_rewards` are not.
