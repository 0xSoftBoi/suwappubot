// Runs wallet_bridge.js under node with just enough browser to boot it,
// announces two EIP-6963 wallets, and drives it as two separate clients.
//
// Prints one JSON line: which wallet answered each client's request.

import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";

const bridgePath = process.argv[2];

class FakeProvider extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.calls = [];
  }
  async request({ method, params }) {
    this.calls.push(method);
    return `answered by ${this.name}`;
  }
  removeListener(name, handler) {
    super.removeListener(name, handler);
  }
}

const listeners = new Map();
const channels = [];

class FakeChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    channels.push(this);
  }
  postMessage(data) {
    for (const other of channels) {
      if (other !== this && other.onmessage) other.onmessage({ data });
    }
  }
}

globalThis.BroadcastChannel = FakeChannel;
globalThis.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.get(k) ?? null; },
  setItem(k, v) { this.store.set(k, v); },
  removeItem(k) { this.store.delete(k); },
};
globalThis.document = { title: "test" };
// node defines `navigator` as a getter; the bridge only reads `.locks`.
if (!globalThis.navigator) globalThis.navigator = {};
globalThis.window = {
  FLET_PAY: {},
  location: { hostname: "localhost", href: "http://localhost/" },
  addEventListener(name, handler) {
    listeners.set(name, [...(listeners.get(name) || []), handler]);
  },
  dispatchEvent(event) {
    for (const handler of listeners.get(event.type) || []) handler(event);
    return true;
  },
};
globalThis.addEventListener = globalThis.window.addEventListener;
globalThis.dispatchEvent = globalThis.window.dispatchEvent;
globalThis.console = { ...console, log: () => {} };

const providers = {
  alpha: new FakeProvider("alpha"),
  beta: new FakeProvider("beta"),
};

// The bridge listens for the announcement in response to its request.
globalThis.window.addEventListener("eip6963:requestProvider", () => {
  for (const [name, provider] of Object.entries(providers)) {
    globalThis.window.dispatchEvent({
      type: "eip6963:announceProvider",
      detail: {
        info: { uuid: `uuid-${name}`, name, rdns: `dev.${name}`, icon: "data:," },
        provider,
      },
    });
  }
});

// Boot the bridge.
new Function(readFileSync(bridgePath, "utf8"))();

// The page that hosts the bridge is also a client of the same channel.
const app = new FakeChannel("flet-wallet");
let next = 1;
const pending = new Map();
app.onmessage = ({ data }) => {
  if (data.dir !== "res") return;
  const waiting = pending.get(data.id);
  if (waiting) {
    pending.delete(data.id);
    waiting(data);
  }
};

function ask(client, method, params = []) {
  const id = String(next++);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    app.postMessage({ v: 1, dir: "req", id, client, method, params });
  });
}

const out = {};
await ask("A", "bridge_listWallets");
out.selectA = await ask("A", "bridge_selectWallet", ["uuid-alpha"]);
out.selectB = await ask("B", "bridge_selectWallet", ["uuid-beta"]);
out.afterA = await ask("A", "eth_chainId");
out.afterB = await ask("B", "eth_chainId");
out.alphaCalls = providers.alpha.calls.length;
out.betaCalls = providers.beta.calls.length;

console.error(JSON.stringify(out));
