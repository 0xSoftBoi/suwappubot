// Boot download_bridge.js under node with just enough browser around it to
// see whether a save reaches the DOM, and report what it built.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const [bridgePath] = process.argv.slice(2);
const saved = [];
let revoked = 0;

class FakeChannel {
  constructor(name) {
    this.name = name;
    FakeChannel.open.push(this);
    this.onmessage = null;
  }
  postMessage(data) {
    for (const other of FakeChannel.open) {
      if (other !== this && other.name === this.name && other.onmessage) {
        other.onmessage({ data });
      }
    }
  }
  close() {
    FakeChannel.open = FakeChannel.open.filter((c) => c !== this);
  }
}
FakeChannel.open = [];

const anchors = [];
const context = {
  console: { log() {}, error(...a) { console.error(...a); } },
  BroadcastChannel: FakeChannel,
  Blob: class {
    constructor(parts, options) {
      this.text = parts.join("");
      this.size = Buffer.byteLength(this.text);
      this.type = (options || {}).type || "";
    }
  },
  URL: {
    createObjectURL(blob) {
      const url = `blob:fake/${saved.length}`;
      saved.push({ url, text: blob.text, media: blob.type, size: blob.size });
      return url;
    },
    revokeObjectURL() { revoked += 1; },
  },
  document: {
    body: { appendChild() {} },
    createElement() {
      const anchor = { href: "", download: "", clicked: 0,
                       click() { this.clicked += 1; }, remove() {} };
      anchors.push(anchor);
      return anchor;
    },
  },
  setTimeout,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(bridgePath, "utf8"), context);

const client = new FakeChannel("flet-download");
client.postMessage({ v: 1, dir: "save", name: "route.svg",
                     text: "<svg/>", media: "image/svg+xml" });
client.postMessage({ v: 1, dir: "ignore", name: "no.svg", text: "x" });
client.postMessage({ v: 2, dir: "save", name: "old.svg", text: "x" });

process.stderr.write(JSON.stringify({
  saved,
  downloads: anchors.map((a) => ({ download: a.download, clicked: a.clicked,
                                   href: a.href })),
}) + "\n");
// The bridge leaves a minute-long timer behind to revoke the object URL, and
// node waits for it.  Nothing here is waiting on anything else.
process.exit(0);
