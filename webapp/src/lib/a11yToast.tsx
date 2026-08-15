/**
 * a11yToast - Accessible wrapper around react-hot-toast.
 *
 * Why this exists:
 *  - react-hot-toast's <Toaster> mounts a SINGLE live region once at app load
 *    (so screen readers stay registered). We keep using it — never create a
 *    live region on demand. (Sara Soueidan, ARIA live regions.)
 *  - But its defaults announce EVERYTHING as aria-live="polite". Errors that
 *    interrupt the user must be role="alert" (assertive). We set ariaProps per
 *    severity. (MDN alert_role, W3C ARIA22.)
 *  - Errors must NOT auto-dismiss before they can be read, and every toast must
 *    have a real close button (>=44px touch target) for tremor / low-vision
 *    users. (WCAG 2.2 time limits; Adrian Roselli "Defining Toast Messages".)
 *  - Severity is never signalled by color alone: every toast pairs color with
 *    an icon AND a word ("Failed" / "Done" / "Heads up"). (WCAG 1.4.1.)
 */
import toast, { type Toast } from 'react-hot-toast'
import { toPlainLanguage } from './plain-language'

export type ToastSeverity = 'success' | 'error' | 'info' | 'warning'

interface SeverityMeta {
  /** Visible word shown next to the message. Never color alone. */
  word: string
  /** Decorative glyph (aria-hidden) reinforcing the word. */
  icon: string
  /** Background utility class (design-token colors). */
  bgClass: string
  /** Foreground / text utility class. */
  textClass: string
  /** Accent class for the icon chip. */
  accentClass: string
}

export const SEVERITY_META: Record<ToastSeverity, SeverityMeta> = {
  success: {
    word: 'Done',
    icon: '✓',
    bgClass: 'bg-white border border-suwappu-success/40',
    textClass: 'text-suwappu-text',
    accentClass: 'bg-suwappu-success/25 text-suwappu-text',
  },
  error: {
    word: 'Failed',
    icon: '✕',
    bgClass: 'bg-white border border-suwappu-error/40',
    textClass: 'text-suwappu-text',
    accentClass: 'bg-suwappu-error/25 text-suwappu-error',
  },
  warning: {
    word: 'Heads up',
    icon: '!',
    bgClass: 'bg-white border border-suwappu-warning/40',
    textClass: 'text-suwappu-text',
    accentClass: 'bg-suwappu-warning/25 text-suwappu-text',
  },
  info: {
    word: 'Info',
    icon: 'i',
    bgClass: 'bg-white border border-suwappu-magenta-mid/30',
    textClass: 'text-suwappu-text',
    accentClass: 'bg-suwappu-magenta-mid/15 text-suwappu-magenta-mid',
  },
}

export interface A11yToastOptions {
  /** Override severity (defaults inferred from the helper used). */
  severity?: ToastSeverity
  /**
   * Duration in ms. Ignored for errors — errors are persistent by default so
   * they cannot disappear before a screen reader / slow reader gets to them.
   */
  duration?: number
  /** Optional id for deduping / programmatic dismissal. */
  id?: string
}

/**
 * react-hot-toast pauses a toast's timer while it is hovered or focused, but
 * only when it is rendered inside the default container with pointer handlers.
 * Our custom node forwards those handlers via the render-prop `t` object.
 */
function renderToast(t: Toast, severity: ToastSeverity, message: string) {
  const meta = SEVERITY_META[severity]
  const isError = severity === 'error'

  return (
    <div
      // IMPORTANT: react-hot-toast only applies `ariaProps` inside its default
      // ToastBar — for toast.custom() nodes (which we use) ariaProps is ignored,
      // so the live-region semantics MUST be set directly on this node. Errors
      // interrupt (assertive/alert); everything else is announced politely.
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={[
        'pointer-events-auto flex items-start gap-3 w-[min(92vw,28rem)]',
        'rounded-suwappu-xl shadow-suwappu-3 px-3 py-3',
        meta.bgClass,
        meta.textClass,
        // Respect reduced motion: skip the slide/scale entrance under the
        // user's OS setting (handled by the motion-safe/reduce variants).
        t.visible ? 'motion-safe:animate-[toast-in_0.18s_ease-out]' : 'opacity-0',
      ].join(' ')}
      data-severity={severity}
    >
      <span
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base font-bold ${meta.accentClass}`}
        aria-hidden="true"
      >
        {meta.icon}
      </span>
      <div className="flex-1 min-w-0 pt-0.5">
        {/* Word + color + icon together — severity is never color alone. */}
        <p className="font-heading font-semibold text-sm leading-tight">
          {meta.word}
        </p>
        <p className="text-sm text-suwappu-text-secondary mt-0.5 break-words">
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(t.id)}
        // >=44px touch target for tremor / low-vision users (WCAG 2.5.8).
        className="shrink-0 -mr-1 -mt-1 w-11 h-11 flex items-center justify-center rounded-full text-suwappu-text-secondary hover:text-suwappu-text hover:bg-suwappu-sakura-light/40 transition-colors"
        aria-label="Dismiss notification"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function show(severity: ToastSeverity, message: string, options: A11yToastOptions = {}) {
  const isError = severity === 'error'
  // Errors persist until dismissed; others auto-dismiss (and pause on hover).
  const duration = isError ? Infinity : options.duration ?? 4000

  // Translate DeFi/finance jargon into plain language for the copy users are
  // most likely to be confused by (failures and warnings). Success/info copy is
  // author-controlled and left verbatim. (WCAG 3.1.5 Reading Level.)
  const copy =
    severity === 'error' || severity === 'warning' ? toPlainLanguage(message).text : message

  return toast.custom((t) => renderToast(t, severity, copy), {
    id: options.id,
    duration,
    // Per-severity live-region semantics. Errors interrupt (assertive/alert),
    // everything else is polite.
    ariaProps: isError
      ? { role: 'alert', 'aria-live': 'assertive' }
      : { role: 'status', 'aria-live': 'polite' },
  })
}

/** Accessible toast API. Mirrors react-hot-toast's call sites (success/error/...). */
export const a11yToast = {
  success: (message: string, options?: A11yToastOptions) => show('success', message, options),
  error: (message: string, options?: A11yToastOptions) => show('error', message, options),
  info: (message: string, options?: A11yToastOptions) => show('info', message, options),
  warning: (message: string, options?: A11yToastOptions) => show('warning', message, options),
  /** Manually dismiss a toast by id (or all toasts if no id given). */
  dismiss: (id?: string) => toast.dismiss(id),
}

export default a11yToast
