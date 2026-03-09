import React, { useState } from 'react'

const isDesktop = !!(
  typeof window !== 'undefined' &&
  (window as any).__SUWAPPU_DESKTOP__?.isDesktop
)

type ExportFileType = 'csv' | 'json' | 'pdf'

interface ExportButtonProps {
  filename: string
  fileType: ExportFileType
  getData: () => string | Promise<string>
  label?: string
  className?: string
}

export function ExportButton({
  filename,
  fileType,
  getData,
  label,
  className,
}: ExportButtonProps) {
  const [exporting, setExporting] = useState(false)
  const [success, setSuccess] = useState(false)

  if (!isDesktop) return null

  const handleExport = async () => {
    const bridge = (window as any).__SUWAPPU_DESKTOP__
    if (!bridge?.exportFile) return

    setExporting(true)
    setSuccess(false)

    try {
      const data = await getData()
      const result = await bridge.exportFile(filename, data, fileType)

      if (result.success) {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      }
    } catch (err) {
      console.error('[ExportButton] Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  const buttonLabel = label || `Export ${fileType.toUpperCase()}`

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className={
        className ||
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-heading font-semibold bg-suwappu-sakura-50 text-suwappu-text-secondary rounded-lg hover:bg-suwappu-sakura-100 transition-colors disabled:opacity-50'
      }
    >
      {exporting ? (
        <>
          <div className="w-3 h-3 border-2 border-suwappu-text-muted/30 border-t-suwappu-text-muted rounded-full animate-spin" />
          Saving...
        </>
      ) : success ? (
        <>
          <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Saved
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {buttonLabel}
        </>
      )}
    </button>
  )
}
