/*
 * A stand-in for @walletconnect/ethereum-provider.
 *
 * The bridge reads its module URL from `config.walletConnectModuleUrl`,
 * which is the seam that makes the whole connect / disconnect / reconnect
 * cycle testable without a phone, a relay or a projectId.
 *
 * Every interesting call is recorded on window.__wc so a test can assert
 * on what the bridge did rather than on what it looked like.
 */
window.__wc = { init: 0, enable: 0, disconnect: 0, events: [] };

class FakeProvider {
  constructor() {
    this.session = null;          // no pairing until enable() succeeds
    this.accounts = [];
    this.chainId = 1;             // a NUMBER, as the real one reports it
    this._handlers = {};
  }

  static async init(_options) {
    window.__wc.init += 1;
    window.__wc.events.push("init");
    return new FakeProvider();
  }

  async enable() {
    window.__wc.enable += 1;
    window.__wc.events.push("enable");
    // What scanning the QR amounts to, from this side.
    this.session = { topic: "fake" };
    this.accounts = ["0x7a16fF8270133F063aAb6C9977183D9e72835428"];
    return this.accounts;
  }

  async disconnect() {
    window.__wc.disconnect += 1;
    window.__wc.events.push("disconnect");
    this.session = null;
    this.accounts = [];
  }

  on(event, handler) {
    (this._handlers[event] ||= []).push(handler);
  }

  removeListener() {}

  async request({ method }) {
    window.__wc.events.push("request:" + method);
    switch (method) {
      case "eth_chainId":
        return this.chainId;       // a number, deliberately
      case "eth_accounts":
      case "eth_requestAccounts":
        return this.accounts;
      case "eth_getBalance":
        return "0x0";
      default:
        return null;
    }
  }
}

export const EthereumProvider = FakeProvider;
