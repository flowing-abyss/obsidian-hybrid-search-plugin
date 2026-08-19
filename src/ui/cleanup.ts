/**
 * Runs every cleanup step, then rethrows the first failure.
 *
 * Cleanup paths must release independent resources even when one third-party hook or child
 * component misbehaves. Preserving the first error keeps the existing diagnostic contract.
 */
export function runAllCleanupSteps(...steps: Array<() => void>): void {
  let failed = false;
  let firstError: unknown;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }
  if (failed) throw firstError;
}
