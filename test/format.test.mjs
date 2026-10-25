import assert from "node:assert/strict";
import test from "node:test";
import {
	cellWidth,
	formatCountdown,
	formatPace,
	formatPercent,
	formatStatusLine,
	formatTable,
	padCells,
	severity,
	stripAnsi,
} from "../src/format.mjs";

const NOW = Date.parse("2026-07-16T12:00:00Z");

const LIMITS = {
	fiveHour: { usedPercent: 12.5, resetsAt: "2026-07-16T15:00:00Z" },
	weekly: { usedPercent: 25, resetsAt: "2026-07-20T14:00:00Z" },
	monthly: { usedPercent: 40, resetsAt: null },
};

test("formatPercent trims meaningless decimals", () => {
	assert.equal(formatPercent(25), "25%");
	assert.equal(formatPercent(12.5), "12.5%");
	assert.equal(formatPercent(0), "0%");
	assert.equal(formatPercent(100), "100%");
});

test("formatCountdown handles days, hours, minutes", () => {
	assert.equal(formatCountdown("2026-07-16T15:00:00Z", NOW), "3h");
	assert.equal(formatCountdown("2026-07-20T14:00:00Z", NOW), "4d 2h");
	assert.equal(formatCountdown("2026-07-16T12:42:00Z", NOW), "42m");
	assert.equal(formatCountdown("2026-07-16T14:05:00Z", NOW), "2h 5m");
});

test("formatCountdown returns empty for unusable timestamps", () => {
	assert.equal(formatCountdown(null, NOW), "");
	assert.equal(formatCountdown("", NOW), "");
	assert.equal(formatCountdown("not-a-date", NOW), "");
	assert.equal(formatCountdown("2026-07-16T11:00:00Z", NOW), "");
});

test("severity follows traffic-light thresholds", () => {
	assert.equal(severity(0), "green");
	assert.equal(severity(69.9), "green");
	assert.equal(severity(70), "yellow");
	assert.equal(severity(89.9), "yellow");
	assert.equal(severity(90), "red");
	assert.equal(severity(100), "red");
});

test("formatStatusLine renders all three windows", () => {
	assert.equal(
		formatStatusLine(LIMITS, { nowMs: NOW }),
		"5h 12.5% in 3h  wk 25% in 4d 2h  mo 40%",
	);
});

test("formatStatusLine skips missing windows and empty countdowns", () => {
	assert.equal(
		formatStatusLine({ weekly: LIMITS.weekly }, { nowMs: NOW }),
		"wk 25% in 4d 2h",
	);
	assert.equal(formatStatusLine({}, { nowMs: NOW }), "");
	assert.equal(formatStatusLine(null, { nowMs: NOW }), "");
});

test("formatStatusLine short mode drops labels and countdowns", () => {
	assert.equal(formatStatusLine(LIMITS, { nowMs: NOW, short: true }), "12.5% / 25% / 40%");
});

test("formatStatusLine color output strips back to the same text", () => {
	const colored = formatStatusLine(LIMITS, { nowMs: NOW, color: true });
	assert.match(colored, /\u001b\[/);
	assert.equal(stripAnsi(colored), formatStatusLine(LIMITS, { nowMs: NOW }));
});

test("formatTable renders a header and one row per window", () => {
	const table = formatTable(LIMITS, { nowMs: NOW, updatedAt: "22:14:03" });

	assert.equal(
		table,
		[
			"ClinePass usage  updated 22:14:03",
			"5h  [#---------]  12.5%  3h",
			"wk  [###-------]   25%  4d 2h",
			"mo  [####------]   40%",
		].join("\n"),
	);
});

test("formatTable bar fills proportionally and stays 10 wide", () => {
	const row = formatTable({ fiveHour: { usedPercent: 100, resetsAt: null } })
		.split("\n")[1];
	assert.match(row, /\[#{10}\]/);

	const half = formatTable({ fiveHour: { usedPercent: 50, resetsAt: null } })
		.split("\n")[1];
	assert.match(half, /\[#{5}-{5}\]/);

	const tiny = formatTable({ fiveHour: { usedPercent: 1, resetsAt: null } })
		.split("\n")[1];
	assert.match(tiny, /\[#-{9}\]/);
});

test("formatPace emits a bare face, no magnitude", () => {
	assert.equal(formatPace({ state: "cold", delta: -27.5 }), "🥶");
	assert.equal(formatPace({ state: "cool", delta: -8.2 }), "😌");
	assert.equal(formatPace({ state: "on", delta: 1 }), "😎");
	assert.equal(formatPace({ state: "warm", delta: 6.4 }), "😅");
	assert.equal(formatPace({ state: "hot", delta: 22 }), "🥵");
	assert.equal(formatPace(null), "");
	assert.equal(formatPace(undefined), "");
});

test("formatPace can fall back to words", () => {
	const noEmoji = { emoji: false };

	assert.equal(formatPace({ state: "cold", delta: -27.5 }, noEmoji), "cold");
	assert.equal(formatPace({ state: "on", delta: 1 }, noEmoji), "on pace");
	assert.equal(formatPace({ state: "hot", delta: 22 }, noEmoji), "hot");
});

test("cellWidth counts emoji as two columns", () => {
	assert.equal(cellWidth(""), 0);
	assert.equal(cellWidth("abc"), 3);
	assert.equal(cellWidth("😎"), 2);
	assert.equal(cellWidth("on pace"), 7);
});

test("padCells pads to a cell width, not a character count", () => {
	assert.equal(padCells("😎", 4), "😎  ");
	assert.equal(padCells("cool", 4), "cool");
	assert.equal(padCells("", 2), "  ");
});

test("the verdict sits between the percent and the reset time", () => {
	const pace = {
		weekly: { state: "warm", delta: 8 },
		monthly: { state: "on", delta: -1 },
	};

	const lines = formatTable(LIMITS, { nowMs: NOW, pace })
		.split("\n")
		.map((line) => line.trimEnd());

	// The 5-hour row has no verdict, but still reserves the column so every
	// row's reset text starts at the same place.
	assert.equal(lines[1], "5h  [#---------]  12.5%      3h");
	assert.equal(lines[2], "wk  [###-------]   25%  😅  4d 2h");
	assert.equal(lines[3], "mo  [####------]   40%  😎");
});

test("formatTable honours emoji: false", () => {
	const pace = { weekly: { state: "cool", delta: -8 } };

	const lines = formatTable(LIMITS, { nowMs: NOW, pace, emoji: false })
		.split("\n")
		.map((line) => line.trimEnd());

	assert.equal(lines[2], "wk  [###-------]   25%  cool  4d 2h");
});

test("formatStatusLine appends the pace tag only when supplied", () => {
	const pace = { weekly: { state: "cool", delta: -8 } };

	assert.equal(
		formatStatusLine(LIMITS, { nowMs: NOW }),
		"5h 12.5% in 3h  wk 25% in 4d 2h  mo 40%",
	);
	assert.equal(
		formatStatusLine(LIMITS, { nowMs: NOW, pace }),
		"5h 12.5% in 3h  wk 25% in 4d 2h [😌]  mo 40%",
	);
});

test("formatTable is plain by default and colored on request", () => {
	const plain = formatTable(LIMITS, { nowMs: NOW });
	assert.doesNotMatch(plain, /\u001b\[/);

	const colored = formatTable(LIMITS, { nowMs: NOW, color: true });
	assert.match(colored, /\u001b\[/);
	assert.equal(stripAnsi(colored), plain);
});

test("formatTable omits a missing window instead of printing a placeholder", () => {
	const table = formatTable({ weekly: LIMITS.weekly }, { nowMs: NOW });
	assert.equal(table.split("\n").length, 2);
	assert.match(table, /^wk {2}/m);
	assert.doesNotMatch(table, /5h |mo /);
});
