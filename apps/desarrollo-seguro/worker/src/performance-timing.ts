export type LongTaskTiming = { startTime: number; duration: number };
export type ResourceTiming = { startTime: number; responseEnd: number };

const TTI_QUIET_WINDOW_MS = 5_000;

/** Finds the first Lighthouse-style 5 s quiet window and its TBT interval. */
export function calculateTotalBlockingTime(
  fcpMs: number,
  tasks: readonly LongTaskTiming[],
  resources: readonly ResourceTiming[],
  observedUntilMs: number,
): number | null {
  if (![fcpMs, observedUntilMs].every(Number.isFinite) || observedUntilMs < fcpMs + TTI_QUIET_WINDOW_MS) return null;

  const taskEnds = tasks.map(({ startTime, duration }) => startTime + duration);
  const resourceEnds = resources.map(({ responseEnd }) => responseEnd);
  const candidates = [...new Set([fcpMs, ...taskEnds, ...resourceEnds])]
    .filter((value) => value >= fcpMs && value <= observedUntilMs - TTI_QUIET_WINDOW_MS)
    .sort((left, right) => left - right);
  const ttiMs = candidates.find((candidate) => isQuietWindow(candidate, tasks, resources));
  if (ttiMs === undefined) return null;

  return Math.round(tasks.reduce((total, task) => {
    const overlap = Math.min(task.startTime + task.duration, ttiMs) - Math.max(task.startTime, fcpMs);
    return total + Math.max(0, overlap - 50);
  }, 0));
}

function isQuietWindow(
  startMs: number,
  tasks: readonly LongTaskTiming[],
  resources: readonly ResourceTiming[],
): boolean {
  const endMs = startMs + TTI_QUIET_WINDOW_MS;
  if (tasks.some(({ startTime, duration }) => startTime < endMs && startTime + duration > startMs)) return false;

  const boundaries = [...new Set([
    startMs,
    ...resources.flatMap(({ startTime, responseEnd }) => [startTime, responseEnd])
      .filter((value) => value > startMs && value < endMs),
  ])].sort((left, right) => left - right);
  return boundaries.every((boundary) => resources.filter(({ startTime, responseEnd }) =>
    startTime <= boundary && responseEnd > boundary).length <= 2);
}
