import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** Drop-in for qrcode.react's QRCodeSVG using terminal's existing `qrcode` dependency. Always dark-on-white so it scans on the dark theme. */
export function QRCodeSVG({ value, size = 128 }: { value: string; size?: number; level?: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    QRCode.toString(value, { type: 'svg', margin: 1, width: size, color: { dark: '#000000', light: '#ffffff' } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(''))
    return () => { live = false }
  }, [value, size])
  return <div role="img" aria-label="QR code" className="bg-white rounded-sm overflow-hidden mx-auto" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}
