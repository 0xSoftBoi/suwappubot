export default function Footer() {
  return (
    <footer className="border-t border-zinc-800/50 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16 md:py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
          {/* Column 1: Product */}
          <div>
            <h3 className="text-sm font-medium text-zinc-50 mb-4">Product</h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://t.me/suwappu_bot"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Telegram Bot
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Mini App
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  SDK
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  MCP Server
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  REST API
                </a>
              </li>
            </ul>
          </div>

          {/* Column 2: Chains */}
          <div>
            <h3 className="text-sm font-medium text-zinc-50 mb-4">Chains</h3>
            <ul className="space-y-3">
              <li>
                <span className="text-sm text-zinc-500">Ethereum</span>
              </li>
              <li>
                <span className="text-sm text-zinc-500">Base</span>
              </li>
              <li>
                <span className="text-sm text-zinc-500">Arbitrum</span>
              </li>
              <li>
                <span className="text-sm text-zinc-500">Solana</span>
              </li>
              <li>
                <span className="text-sm text-zinc-500">Polygon</span>
              </li>
              <li>
                <span className="text-sm text-zinc-500">BSC</span>
              </li>
              <li>
                <span className="text-sm text-zinc-500">Avalanche</span>
              </li>
            </ul>
          </div>

          {/* Column 3: Developers */}
          <div>
            <h3 className="text-sm font-medium text-zinc-50 mb-4">
              Developers
            </h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://docs.suwappu.bot"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Documentation
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/0xSoftBoi/suwappubot"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  API Reference
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Changelog
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Community */}
          <div>
            <h3 className="text-sm font-medium text-zinc-50 mb-4">
              Community
            </h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://t.me/suwappu_bot"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Telegram
                </a>
              </li>
              <li>
                <a
                  href="https://x.com/suwappubot"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  X (Twitter)
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Discord
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 pt-8 border-t border-zinc-800/50 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="font-serif text-lg text-zinc-50">Suwappu</p>
          <p className="text-sm text-zinc-600">
            &copy; 2026 Suwappu. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
