/** Demo mode is read at call time so tests can toggle it. */
export function isDemo(): boolean {
  return process.env.DEMO_MODE === "1";
}
