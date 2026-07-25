/**
 * Foundation barrel — shared terminal primitives.
 *
 * Prefer `import { TerminalSkeleton } from '../foundation'` in new code; the
 * per-file imports (`../foundation/TerminalPrimitives`) keep working.
 */
export {
  TerminalPage,
  TerminalEyebrow,
  TerminalPanel,
  TerminalInset,
  TerminalPanelHeader,
  TerminalMetricCard,
  TerminalStatusPill,
  TerminalDivider,
  TerminalEmptyState,
} from "./TerminalPrimitives";

export {
  TerminalButton,
  TerminalIconButton,
  TerminalKeyHint,
  TerminalTextField,
  TerminalSegmentedTabs,
  TerminalSelectPill,
  TerminalTokenPill,
} from "./TerminalControls";

export {
  TerminalChainBadge,
  TerminalDeltaText,
  TerminalKeyValueRow,
} from "./TerminalDataDisplay";

export {
  TerminalSkeleton,
  TerminalSkeletonText,
  TerminalSkeletonRows,
} from "./TerminalSkeleton";
