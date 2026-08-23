// wallet_bridge.js -- the main-thread half of the browser wallet transport.
//
// Flet runs Python in a Web Worker; wallets live on the main thread. This
// relays EIP-1193 calls between them over a BroadcastChannel, and is loaded
// before the Flutter bootstrap so it is listening by the time Pyodide is up.
//
// Wire protocol -- src/wallet/browser.py is the other side of it:
//   in   {v:1, dir:"req", id, method, params}
//   out  {v:1, dir:"res", id, result} | {v:1, dir:"res", id, error:{code,message}}
//   out  {v:1, dir:"evt", event, data}
//
// A connector is one entry in CONNECTORS with `list()` and `resolve()`;
// everything below that array is connector-agnostic.

(() => {
  "use strict";

  const CHANNEL_NAME = "flet-wallet";
  const VERSION = 1;

  // Which wallet was last connected, so closing the tab does not mean
  // starting over.
  const REMEMBER_KEY = "flet-wallet:last";

  function remember(info) {
    try {
      localStorage.setItem(
        REMEMBER_KEY,
        JSON.stringify({ rdns: info.rdns || "", connector: info.connector || "" })
      );
    } catch (_) {
      // private mode, or storage disabled: connecting still works
    }
  }

  function remembered() {
    try {
      return JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function forget() {
    try {
      localStorage.removeItem(REMEMBER_KEY);
    } catch (_) {
      // nothing to clean up
    }
  }

  // : Ending a WalletConnect session, as opposed to forgetting about it.
  async function endWalletConnect() {
    const provider = wcProvider;
    if (!provider) return;
    wcProvider = null;
    try {
      if (provider.session) await provider.disconnect();
    } catch (error) {
      log("WalletConnect would not disconnect (letting it go):", error);
    }
  }

  // A BroadcastChannel is shared by every page on the origin, so a second
  // tab running this app hears -- and would answer -- the first tab's
  // requests.
  let active = true;
  if (navigator.locks?.request) {
    active = false;
    navigator.locks
      .request("flet-wallet-bridge", () => {
        active = true;
        log("serving this origin");
        // Held until the page goes away, which releases it for the
        // next tab.
        return new Promise(() => {});
      })
      .catch(() => {
        // No lock support, or it was denied: better a bridge that
        // answers than a page that cannot reach a wallet at all.
        active = true;
      });
  }

  // Mutable: Python fills this in via bridge_configure at startup.
  const config = window.FLET_PAY || (window.FLET_PAY = {});
  const channel = new BroadcastChannel(CHANNEL_NAME);

  // uuid -> {info, resolve} for everything any connector has offered.
  const catalogue = new Map();
  // client -> {provider, info, detachers}. One entry per app, not one for
  // the origin: a single `selected` meant two tabs shared it, so the tab
  // that connected last took over the other tab's requests, and a wallet
  // switch that the Python side then abandoned left the bridge pointing
  // at the wallet that was never connected.
  const byClient = new Map();

  const log = (...args) => console.log("[wallet-bridge]", ...args);

  // ====================================================================
  // Connector 1: injected wallets, discovered via EIP-6963
  // ====================================================================
  // EIP-6963 replaced the old "everyone fights over window.ethereum"
  // mess: each wallet announces itself with an event carrying a stable
  // rdns id.

  const announced = new Map();

  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = event.detail;
    announced.set(info.uuid, { info, provider });
    log("announced:", info.name, info.rdns);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  function legacyInjected() {
    // Pre-EIP-6963 wallets only set window.ethereum.
    if (!window.ethereum) return null;
    for (const { provider } of announced.values()) {
      if (provider === window.ethereum) return null; // already announced
    }
    const eth = window.ethereum;
    const name = eth.isMetaMask
      ? "MetaMask (legacy)"
      : eth.isRabby
        ? "Rabby (legacy)"
        : eth.isFrame
          ? "Frame (legacy)"
          : "Injected wallet";
    return { info: { uuid: "legacy:window.ethereum", name, rdns: "legacy" }, provider: eth };
  }

  const injectedConnector = {
    id: "injected",
    async list() {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      // Announcements are synchronous in practice, but a freshly-
      // installed or still-initialising extension can miss the first
      // dispatch.
      await new Promise((resolve) => setTimeout(resolve, 350));

      const entries = [...announced.values()];
      const legacy = legacyInjected();
      if (legacy) entries.push(legacy);

      return entries.map(({ info, provider }) => ({
        info: {
          uuid: info.uuid,
          name: info.name,
          rdns: info.rdns,
          icon: info.icon || null,
          connector: "injected",
        },
        resolve: async () => provider,
      }));
    },
  };

  // ====================================================================
  // Connector 2: WalletConnect v2 -- mobile wallets by QR / deep link
  // ====================================================================
  // `EthereumProvider` from @walletconnect/ethereum-provider is itself an
  // EIP-1193 provider, which is why it drops straight into this design:
  // resolve() returns it and the forwarding code below is unchanged.

  // Read at call time, not load time, so every knob in window.FLET_PAY
  // behaves the same way and can be changed from the console while
  // debugging.
  const wcModuleUrl = () =>
    config.walletConnectModuleUrl || "https://esm.sh/@walletconnect/ethereum-provider@2";

  // Which chains a WalletConnect session is proposed for.  The session is
  // proposed once, at connect time, and a chain left out of it cannot be
  // switched to afterwards -- the wallet answers "the chain is not approved"
  // and a Safe says the dApp does not support its network.
  //
  // So the app sends the list its own picker offers (see
  // `_offer_chains_to_wallet`), and this is only what to propose when it has
  // not had the chance: the majors, which is better than nothing and worse
  // than the real thing.
  const wcChains = () => config.walletConnectChains || [1, 10, 137, 8453, 42161];

  let wcProvider = null;

  // WalletConnect's EthereumProvider.request() forwards *everything* to
  // the wallet over the relay -- nothing is answered locally.
  const WC_LOCAL_METHODS = new Set([
    "eth_accounts",
    "eth_requestAccounts",
    "eth_chainId",
    "net_version",
  ]);

  function wrapWalletConnect(provider) {
    return {
      on: (...args) => provider.on(...args),
      removeListener: (...args) => provider.removeListener(...args),
      async request({ method, params }) {
        if (WC_LOCAL_METHODS.has(method)) {
          switch (method) {
            case "eth_accounts":
            case "eth_requestAccounts":
              return provider.accounts || [];
            case "eth_chainId":
              return `0x${Number(provider.chainId).toString(16)}`;
            case "net_version":
              return String(provider.chainId);
          }
        }
        return await provider.request({ method, params });
      },
    };
  }

  const walletConnectConnector = {
    id: "walletconnect",
    async list() {
      if (!config.walletConnectProjectId) return [];
      return [
        {
          info: {
            uuid: "walletconnect",
            name: "WalletConnect",
            rdns: "org.walletconnect",
            // Injected wallets announce their own icon under
            // EIP-6963.
            icon: config.walletConnectIcon || null,
            connector: "walletconnect",
            // Resolving this one is not free. `resolve()` below
            // fetches the module graph -- some nine hundred
            // requests through esm.sh -- constructs the
            // Web3Modal, and then opens a QR code.
            deliberate: true,
          },
          resolve: async ({ silent } = {}) => {
            // Only the *initialisation* is cached. This used to
            // return `wcProvider` here and be done with it,
            // which was wrong twice over on a second connect:
            // it handed back the bare provider instead of the
            // wrapper below -- so `eth_chainId` stopped being
            // intercepted and answered with a JavaScript
            // number, which reaches Python as `int(1, 16)` and
            // "int() can't convert non-string with explicit
            // base" -- and it skipped the session check, so a
            // wallet that had been disconnected was never
            // offered a QR code to pair again.
            if (!wcProvider) {
              const moduleUrl = wcModuleUrl();
              log("loading WalletConnect from", moduleUrl);
              const { EthereumProvider } = await import(
                /* @vite-ignore */ moduleUrl
              );

              wcProvider = await EthereumProvider.init({
                projectId: config.walletConnectProjectId,
                // metadata.url must match the serving
                // origin or wallets will show a domain-
                // mismatch warning.
                metadata: {
                  name: document.title || "Flet Pay",
                  description: "Send tokens from a Flet app written in Python",
                  url: window.location.origin,
                  icons: [
                    `${window.location.origin}/icons/apple-touch-icon-192.png`,
                  ],
                },
                optionalChains: wcChains(),
                optionalMethods: [
                  "eth_sendTransaction",
                  "personal_sign",
                  "eth_signTypedData_v4",
                ],
                optionalEvents: ["accountsChanged", "chainChanged"],
                showQrModal: true,
              });
            }

            // enable() is the EIP-1193-compatible connect: it
            // opens the QR modal and resolves once the phone
            // has approved.
            if (!wcProvider.session) {
              // init() restores a session from
              // WalletConnect's own storage if the phone is
              // still paired.
              if (silent) {
                throw { code: 4900, message: "No WalletConnect session to restore" };
              }
              await wcProvider.enable();
            }
            log("session established, accounts:", wcProvider.accounts);
            return wrapWalletConnect(wcProvider);
          },
        },
      ];
    },
  };

  // ====================================================================
  // Registry -- add a connector by adding an entry here.

  const CONNECTORS = [injectedConnector, walletConnectConnector];

  async function discover() {
    const results = await Promise.allSettled(CONNECTORS.map((c) => c.list()));

    catalogue.clear();
    const wallets = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        // One broken connector must never take down discovery.
        log(`connector "${CONNECTORS[index].id}" failed:`, result.reason);
        return;
      }
      for (const entry of result.value) {
        catalogue.set(entry.info.uuid, entry);
        wallets.push(entry.info);
      }
    });
    return wallets;
  }

  // ====================================================================
  // Event forwarding
  // ====================================================================

  function emit(event, data, client) {
    // Addressed to whoever selected this wallet, not broadcast: another
    // tab's app must not act on an account change it did not ask for.
    channel.postMessage({ v: VERSION, dir: "evt", event, data, client });
  }

  function release(client) {
    const held = byClient.get(client);
    if (!held) return;
    for (const detach of held.detachers) detach();
    byClient.delete(client);
  }

  function attach(provider, info, client) {
    release(client);
    const held = { provider, info, detachers: [] };
    byClient.set(client, held);
    if (!provider || typeof provider.on !== "function") return held;

    for (const name of ["accountsChanged", "chainChanged", "disconnect", "connect"]) {
      const handler = (data) => {
        log("event:", name, data);
        emit(name, data, client);
      };
      provider.on(name, handler);
      held.detachers.push(() => {
        try {
          provider.removeListener(name, handler);
        } catch (_) {
          // not every provider implements removeListener
        }
      });
    }
    return held;
  }

  async function selectWallet(uuid, client, options) {
    const entry = catalogue.get(uuid);
    if (!entry) throw { code: 4001, message: `Unknown wallet: ${uuid}` };

    // resolve() may open a modal and wait on a phone, so it is async
    // and may reject (user closed the QR).
    const provider = await entry.resolve(options || {});
    attach(provider, entry.info, client);
    remember(entry.info);
    log("selected:", entry.info.name);
    return {
      uuid,
      name: entry.info.name,
      rdns: entry.info.rdns,
      connector: entry.info.connector || "",
    };
  }

  // ====================================================================
  // Request handling
  // ====================================================================

  async function handle(method, params, client) {
    // Bridge-only methods: answered here, never forwarded to a wallet.
    if (method === "bridge_configure") {
      // Settings arrive from Python (wallet/settings.py) rather than
      // a JS file, so that a plain `flet publish` yields a configured
      // build.
      const incoming = params[0] || {};
      for (const [key, value] of Object.entries(incoming)) {
        if (config[key] === undefined || config[key] === "") config[key] = value;
      }
      log("configured:", Object.keys(incoming).join(", ") || "(nothing)");
      return { ok: true, keys: Object.keys(incoming) };
    }
    if (method === "bridge_hello") {
      return {
        ok: true,
        wallets: await discover(),
        selected: byClient.get(client)?.info?.uuid ?? null,
        remembered: remembered(),
      };
    }
    if (method === "bridge_selectWallet") {
      return await selectWallet(params[0], client, params[1] || {});
    }
    if (method === "bridge_forget") {
      forget();
      // A deliberate disconnect, so the pairing goes too -- and with it
      // this client's selection, or its next request would be answered by
      // the wallet that was just disconnected. Another tab's selection is
      // not this one's to end, so only WalletConnect, which is one session
      // for the origin, is torn down.
      release(client);
      await endWalletConnect();
      return { ok: true };
    }
    if (method === "bridge_listWallets") {
      return await discover();
    }

    if (!byClient.has(client)) {
      const wallets = await discover();
      if (wallets.length === 0) {
        throw { code: 4900, message: "No wallet available in this browser" };
      }
      await selectWallet(wallets[0].uuid, client);
    }

    // The entire connector integration, once resolved: one EIP-1193
    // call.
    return await byClient.get(client).provider.request({ method, params });
  }

  channel.onmessage = async (event) => {
    const message = event.data;
    if (!message || message.v !== VERSION || message.dir !== "req") return;

    // Dormant: another tab's bridge holds the lock and is answering.
    if (!active) return;

    const client = message.client ?? null;
    if (message.method === "bridge_release") {
      // The page is going away: drop its selection and its listeners.
      release(client);
      return;
    }

    const { id, method, params } = message;
    try {
      const result = await handle(method, params || [], client);
      channel.postMessage({ v: VERSION, dir: "res", id, result: result ?? null, client });
    } catch (error) {
      // Normalise the shapes wallets throw: EIP-1193
      // ProviderRpcError, a plain {code,message} object, and a bare
      // Error.
      channel.postMessage({
        v: VERSION,
        dir: "res",
        id,
        client,
        error: {
          code: Number.isInteger(error?.code) ? error.code : -32603,
          message: String(error?.message || error || "Wallet request failed"),
          data: error?.data ?? null,
        },
      });
    }
  };

  log(
    "ready on BroadcastChannel:",
    CHANNEL_NAME,
    "| connectors:",
    CONNECTORS.map((c) => c.id).join(", "),
    config.walletConnectProjectId ? "" : "(WalletConnect idle: no projectId)"
  );
})();
