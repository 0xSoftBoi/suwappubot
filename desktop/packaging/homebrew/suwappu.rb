cask "suwappu" do
  version "0.1.0"
  sha256 :no_check

  on_arm do
    url "https://github.com/0xSoftBoi/suwappubot/releases/latest/download/Suwappu-#{version}-arm64.dmg"
  end

  on_intel do
    url "https://github.com/0xSoftBoi/suwappubot/releases/latest/download/Suwappu-#{version}-x64.dmg"
  end

  name "Suwappu"
  desc "Cross-chain DEX trading terminal"
  homepage "https://suwappu.bot"

  livecheck do
    url "https://github.com/0xSoftBoi/suwappubot/releases/latest"
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :ventura"

  app "Suwappu.app"

  zap trash: [
    "~/Library/Application Support/bot.suwappu.desktop",
    "~/Library/Caches/bot.suwappu.desktop",
    "~/Library/Preferences/bot.suwappu.desktop.plist",
    "~/Library/Saved Application State/bot.suwappu.desktop.savedState",
    "~/Library/Logs/Suwappu",
  ]
end
