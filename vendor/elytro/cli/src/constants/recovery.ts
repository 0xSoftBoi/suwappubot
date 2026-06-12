import type { Hex } from 'viem';

/** Recovery App base URL for share links. */
export const RECOVERY_APP_URL = 'https://recovery.elytro.com/';

/**
 * keccak256(toBytes('GUARDIAN_INFO'))
 * Used as the category key in the InfoRecorder contract for guardian data events.
 */
export const GUARDIAN_INFO_KEY =
  '0x1ace5ad304fe21562a90af48910fa441fc548c59f541c00cc8338faaa3de3990' as Hex;

/**
 * InfoRecorder contract address.
 * Same for both v0.7 and v0.8 entrypoint versions.
 */
export const INFO_RECORDER_ADDRESS = '0xB21689a23048D39c72EFE96c320F46151f18b22F';

/**
 * On-chain recovery operation states.
 * Maps to the SocialRecoveryModule's `getOperationState` return values.
 */
export enum RecoveryOperationState {
  Unset = 0,
  Waiting = 1,
  Ready = 2,
  Done = 3,
}
