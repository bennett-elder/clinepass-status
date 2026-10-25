import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_TOLERANCE,
	PACED_WINDOWS,
	WINDOW_MS,
	computeAllPace,
	computePace,
} from "../src/pace.mjs";

const NOW = Date.parse("2026-07-16T12:00:00Z");

/** A window whose reset is `remainingFraction` of the window away. */
function windowAt(usedPercent, remainingFraction, windowMs = WINDOW_MS.weekly) {
	return {
		usedPercent,
		resetsAt: new Date(NOW + windowMs * remainingFraction).toISOString(),
	};
}

test("window lengths match the ClinePass windows", () => {
	assert.equal(WINDOW_MS.fiveHour, 5 * 60 * 60 * 1000);
	assert.equal(WINDOW_MS.weekly, 7 * 24 * 60 * 60 * 1000);
	assert.equal(WINDOW_MS.monthly, 30 * 24 * 60 * 60 * 1000);
	assert.equal(DEFAULT_TOLERANCE, 5);
});

test("only weekly and monthly get a verdict", () => {
	assert.deepEqual(PACED_WINDOWS, ["weekly", "monthly"]);
});

test("halfway through a window with half the quota used is on pace", () => {
	const pace = computePace(windowAt(50, 0.5), { windowMs: WINDOW_MS.weekly, nowMs: NOW });

	assert.equal(pace.state, "on");
	assert.equal(pace.expected, 50);
	assert.equal(pace.delta, 0);
	assert.equal(pace.elapsedFraction, 0.5);
});

test("five bands run from cold to hot", () => {
	const at = (usedPercent) =>
		computePace(windowAt(usedPercent, 0.5), { windowMs: WINDOW_MS.weekly, nowMs: NOW });

	// Halfway through the window, expected is 50%.
	assert.deepEqual(
		[
			[at(30).state, at(30).level], // -20
			[at(40).state, at(40).level], // -10
			[at(50).state, at(50).level], //   0
			[at(60).state, at(60).level], // +10
			[at(70).state, at(70).level], // +20
		],
		[
			["cold", -2],
			["cool", -1],
			["on", 0],
			["warm", 1],
			["hot", 2],
		],
	);
});

test("band edges are inclusive at one and three tolerances", () => {
	const at = (usedPercent, tolerance = 5) =>
		computePace(windowAt(usedPercent, 0.5), {
			windowMs: WINDOW_MS.weekly,
			nowMs: NOW,
			tolerance,
		});

	// ±1t is still goldilocks.
	assert.equal(at(55).state, "on");
	assert.equal(at(45).state, "on");
	assert.equal(at(55.1).state, "warm");
	assert.equal(at(44.9).state, "cool");

	// ±3t is the last warm/cool step before the extreme band.
	assert.equal(at(65).state, "warm");
	assert.equal(at(35).state, "cool");
	assert.equal(at(65.1).state, "hot");
	assert.equal(at(34.9).state, "cold");

	// Widening the tolerance scales every band, not just the middle.
	assert.equal(at(58, 10).state, "on");
	assert.equal(at(78, 10).state, "warm");
	assert.equal(at(95, 10).state, "hot");
});

test("pace is unknowable at the edges", () => {
	const opts = { windowMs: WINDOW_MS.weekly, nowMs: NOW };

	// Too early in the window to judge.
	assert.equal(computePace(windowAt(5, 0.99), opts), null);

	// Reset already passed (stale data).
	assert.equal(computePace({ usedPercent: 5, resetsAt: "2026-07-16T11:00:00Z" }, opts), null);

	// No reset time at all.
	assert.equal(computePace({ usedPercent: 5, resetsAt: null }, opts), null);
	assert.equal(computePace(null, opts), null);

	// Reset further out than one window (clock skew).
	assert.equal(computePace(windowAt(5, 1.5), opts), null);
});

test("computeAllPace skips the 5-hour window", () => {
	const limits = {
		fiveHour: windowAt(90, 0.5, WINDOW_MS.fiveHour),
		weekly: windowAt(70, 0.5, WINDOW_MS.weekly),
		monthly: { usedPercent: 20, resetsAt: null },
	};

	const pace = computeAllPace(limits, { nowMs: NOW });

	assert.equal("fiveHour" in pace, false);
	assert.equal(pace.weekly.state, "hot");
	assert.equal(pace.monthly, null);
});

test("computeAllPace tolerates missing windows", () => {
	assert.deepEqual(computeAllPace({}, { nowMs: NOW }), {
		weekly: null,
		monthly: null,
	});
});
