export default function Footer() {
  return (
    <footer className="bg-suwappu-dark-bg border-t border-white/5 text-white py-16 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-12 mb-12">
          <div>
            <h3 className="font-heading font-bold text-lg mb-3">Suwappu</h3>
            <p className="text-suwappu-dark-text-muted text-sm leading-relaxed max-w-xs">
              Swap tokens across 15 chains from Telegram, WhatsApp, Discord, or the iOS app. Non-custodial.
            </p>
          </div>
          <div>
            <h4 className="font-heading font-semibold text-xs mb-4 text-white/50 uppercase tracking-wider">Product</h4>
            <ul className="space-y-2.5">
              {['Features', 'Demos', 'How it works', 'FAQ'].map((l) => (
                <li key={l}><a href={`#${l.toLowerCase().replace(/ /g, '-')}`} className="text-sm text-white/40 hover:text-white transition-colors">{l}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-heading font-semibold text-xs mb-4 text-white/50 uppercase tracking-wider">Connect</h4>
            <ul className="space-y-2.5">
              {[
                { label: 'Telegram', href: 'https://t.me/suwappu_bot' },
                { label: 'Discord', href: '#' },
                { label: 'Twitter/X', href: '#' },
                { label: 'GitHub', href: '#' },
              ].map((l) => (
                <li key={l.label}><a href={l.href} target="_blank" rel="noopener noreferrer" className="text-sm text-white/40 hover:text-white transition-colors">{l.label}</a></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="section-divider mb-8" />
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/25">&copy; {new Date().getFullYear()} Suwappu. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="text-xs text-white/25 hover:text-white/50 transition-colors">Privacy</a>
            <a href="#" className="text-xs text-white/25 hover:text-white/50 transition-colors">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
