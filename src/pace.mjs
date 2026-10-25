/**
 * Pace: are we burning the window faster or slower than its clock?
 *
 * The reset timestamp anchors the window start:
 *
 *   start    = resetsAt - windowMs
 *   expected = (now - start) / windowMs * 100     // % we "should" have used
 *   delta    = usedPercent - expected             // + = over pace, - = headroom
 *
 * So halfway through the week with 25% used is comfortably under pace, while
 * halfway through a 5-hour window with 80% used is over.
 */

export const WINDOW_MS = {
	fiveHour: 5 * 60 * 60 * 1000,
	weekly: 7 * 24 * 60 * 60 * 1000,
	// Approximate: the monthly reset is a billing anniversary, not a fixed
	// 30-day month, so treat this as a good-enough denominator.
	monthly: 30 * 24 * 60 * 60 * 1000,
};

export const DEFAULT_TOLERANCE = 5;

/**
 * Only the slower windows get a pace verdict.
 *
 * The 5-hour window resets four-plus times a day, so a single burst of work
 * paints it "over" for an hour and then erases itself. Weekly and monthly are
 * the windows where the reading is actually actionable.
 */
export const PACED_WINDOWS = ["weekly", "monthly"];

/**
 * Below 2% of a window there is not enough signal: one request right after a
 * reset would otherwise read as wildly over pace.
 */
const MIN_ELAPSED_FRACTION = 0.02;

/**
 * @returns {{state: "cold"|"cool"|"on"|"warm"|"hot", level: -2|-1|0|1|2,
 *            delta: number, expected: number, elapsedFraction: number} | null}
 *   null when pace is unknowable.
 */
export function computePace(
	window,
	{ windowMs, nowMs = Date.now(), tolerance = DEFAULT_TOLERANCE } = {},
) {
	if (!window || !window.resetsAt || !Number.isFinite(windowMs)) return null;

	const resetsAt = Date.parse(window.resetsAt);
	if (!Number.isFinite(resetsAt) || resetsAt <= nowMs) return null;

	const startedAt = resetsAt - windowMs;
	const elapsed = nowMs - startedAt;
	if (elapsed <= 0) return null; // clock skew: window hasn't started yet
	if (elapsed < windowMs * MIN_ELAPSED_FRACTION) return null;

	const elapsedFraction = Math.min(1, elapsed / windowMs);
	const expected = elapsedFraction * 100;
	const delta = window.usedPercent - expected;

	const { state, level } = classify(delta, tolerance);

	return { state, delta, expected, elapsedFraction, level };
}

/**
 * Five bands, anchored to the tolerance so `--tolerance` scales the whole
 * gradient rather than just the middle:
 *
 *   cold  [-2]  delta <= -3t   lots of headroom
 *   cool  [-1]  -3t < delta <= -t
 *   on     [0]  -t < delta < +t      goldilocks
 *   warm  [+1]  +t <= delta < +3t
 *   hot   [+2]  delta >= +3t   will run dry before the reset
 */
function classify(delta, tolerance) {
	const magnitude = Math.abs(delta);

	if (magnitude <= tolerance) return { state: "on", level: 0 };

	const extreme = magnitude > tolerance * 3;
	if (delta > 0) {
		return extreme ? { state: "hot", level: 2 } : { state: "warm", level: 1 };
	}
	return extreme ? { state: "cold", level: -2 } : { state: "cool", level: -1 };
}

/** Pace for the windows where it means something. */
export function computeAllPace(limits, options = {}) {
	const pace = {};
	for (const key of PACED_WINDOWS) {
		pace[key] = computePace(limits?.[key], {
			windowMs: WINDOW_MS[key],
			...options,
		});
	}
	return pace;
}
