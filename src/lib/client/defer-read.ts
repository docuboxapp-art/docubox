/** Defer a read until the effect survives setup/cleanup (including Strict Mode).
 * The read owns its error handling; no result or authorization is cached.
 */
export function deferRead(read: () => void | Promise<unknown>): () => void {
  let active = true;
  void Promise.resolve().then(() => {
    if (active) return read();
  });
  return () => {
    active = false;
  };
}
