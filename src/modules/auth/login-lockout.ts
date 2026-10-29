import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

/** Lockout fields shared by tenant users and platform admins (F02 AC-03). */
export interface LockoutState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface LockoutPolicy {
  maxAttempts: number;
  lockMinutes: number;
}

export function assertNotLocked(state: LockoutState) {
  if (state.lockedUntil && state.lockedUntil > new Date()) {
    throw new AppException(HttpStatus.LOCKED, ErrorCode.ACCOUNT_LOCKED, 'Account temporarily locked, try again later');
  }
}

/** Fields to persist after a failed attempt. */
export function onFailedAttempt(state: LockoutState, policy: LockoutPolicy): LockoutState {
  // A lock that has expired starts a fresh window
  const previous = state.lockedUntil && state.lockedUntil <= new Date() ? 0 : state.failedLoginCount;
  const attempts = previous + 1;
  return attempts >= policy.maxAttempts
    ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + policy.lockMinutes * 60_000) }
    : { failedLoginCount: attempts, lockedUntil: null };
}

export const RESET_LOCKOUT: LockoutState = { failedLoginCount: 0, lockedUntil: null };

export const invalidCredentials = () =>
  new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
