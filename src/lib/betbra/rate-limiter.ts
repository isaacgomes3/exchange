let lastRequestAt = 0;
let chain: Promise<void> = Promise.resolve();

export function scheduleRequest<T>(
  fn: () => Promise<T>,
  spacingMs: number
): Promise<T> {
  const run = chain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, spacingMs - (now - lastRequestAt));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
    return fn();
  });

  chain = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}
