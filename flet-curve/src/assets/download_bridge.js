// download_bridge.js -- the main-thread half of "save this picture".
//
// Flet runs Python in a Web Worker, and a worker has no DOM: `document` is
// not defined, so the usual `<a download>` cannot be built there.  A blob URL
// made in the worker is valid on this origin but Flet's `launch_url` will not
// open one, and it will not open a `data:` URL either -- Flutter's launcher
// takes http-ish schemes and quietly drops the rest.
//
// So the worker posts the file here and this side does the click, the same
// way `wallet_bridge.js` relays the wallet.  Loaded before the Flutter
// bootstrap, so it is listening by the time Pyodide is up.
//
// Wire protocol -- src/ui/download.py is the other side of it:
//   in   {v:1, dir:"save", name, text, media}

(() => {
  "use strict";

  const CHANNEL_NAME = "flet-download";
  const VERSION = 1;

  function save(message) {
    const name = String(message.name || "download");
    const media = String(message.media || "application/octet-stream");
    const blob = new Blob([String(message.text || "")], { type: media });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Late enough that the download has taken its copy, and not left for the
    // life of the document: a route diagram is small but this can be clicked
    // all day.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    console.log("[download-bridge] saved:", name, blob.size + " bytes");
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const message = event.data;
    if (!message || message.v !== VERSION || message.dir !== "save") return;
    try {
      save(message);
    } catch (error) {
      console.error("[download-bridge] failed:", error);
    }
  };
  console.log("[download-bridge] ready on BroadcastChannel:", CHANNEL_NAME);
})();
