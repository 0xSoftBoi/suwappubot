export default function Footer() {
  return (
    <footer className="border-t border-white/[0.04] bg-[#07070e]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16 md:py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
          {/* Column 1: Product */}
          <div>
            <h3 className="text-sm font-medium text-[#e8e6e3] mb-4">Product</h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://t.me/suwappu_bot"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  Telegram Bot
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  Mini App
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  SDK
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  MCP Server
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  REST API
                </a>
              </li>
            </ul>
          </div>

          {/* Column 2: Chains */}
          <div>
            <h3 className="text-sm font-medium text-[#e8e6e3] mb-4">Chains</h3>
            <ul className="space-y-3">
              <li>
                <span className="text-sm text-[#4a4a5e]">Ethereum</span>
              </li>
              <li>
                <span className="text-sm text-[#4a4a5e]">Base</span>
              </li>
              <li>
                <span className="text-sm text-[#4a4a5e]">Arbitrum</span>
              </li>
              <li>
                <span className="text-sm text-[#4a4a5e]">Solana</span>
              </li>
              <li>
                <span className="text-sm text-[#4a4a5e]">Polygon</span>
              </li>
              <li>
                <span className="text-sm text-[#4a4a5e]">BSC</span>
              </li>
              <li>
                <span className="text-sm text-[#4a4a5e]">Avalanche</span>
              </li>
            </ul>
          </div>

          {/* Column 3: Developers */}
          <div>
            <h3 className="text-sm font-medium text-[#e8e6e3] mb-4">
              Developers
            </h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://docs.suwappu.bot"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  Documentation
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/0xSoftBoi/suwappubot"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  API Reference
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  Changelog
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Community */}
          <div>
            <h3 className="text-sm font-medium text-[#e8e6e3] mb-4">
              Community
            </h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://t.me/suwappu_bot"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  Telegram
                </a>
              </li>
              <li>
                <a
                  href="https://x.com/suwappubot"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  X (Twitter)
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                >
                  Discord
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 pt-8 border-t border-white/[0.04] flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="font-display text-lg text-[#e8e6e3]">Suwappu</p>
          <p className="text-sm text-[#4a4a5e]">
            &copy; 2026 Suwappu. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
