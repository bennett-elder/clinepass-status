/**
 * Rendering for the status line.
 *
 * Deliberately ASCII-only so it survives any terminal font, tmux config, or
 * Windows console. Color is added by the caller, never baked into the text.
 */

const LABELS = {
	fiveHour: "5h",
	weekly: "wk",
	monthly: "mo",
};

const ANSI = {
	reset: "\u001b[0m",
	dim: "\u001b[2m",
	green: "\u001b[32m",
	yellow: "\u001b[33m",
	red: "\u001b[31m",
};

/** Percent -> traffic-light color name. */
export function severity(percent) {
	if (percent >= 90) return "red";
	if (percent >= 70) return "yellow";
	return "green";
}

/**
 * Faces, cold to hot: freezing = lots of headroom, sunglasses = goldilocks,
 * overheating = burning too fast.
 */
const PACE_GLYPH = {
	cold: "🥶",
	cool: "😌",
	on: "😎",
	warm: "😅",
	hot: "🥵",
};

/** Words used when emoji are disabled. */
const PACE_WORD = {
	cold: "cold",
	cool: "cool",
	on: "on pace",
	warm: "warm",
	hot: "hot",
};

/**
 * The verdict, as a bare glyph: "🥶", "😌", "😎", "😅", "🥵".
 *
 * No delta number: showing it on some rows and not others (on-pace has no
 * meaningful magnitude) reads as a rendering bug. The exact delta is in --json
 * for anyone who wants it.
 */
export function formatPace(pace, { emoji = true } = {}) {
	if (!pace) return "";
	return emoji ? PACE_GLYPH[pace.state] : PACE_WORD[pace.state];
}

/**
 * Display width in terminal cells, counting emoji as two columns.
 *
 * Flat-width terminals are rare enough to ignore, and with every glyph in a
 * column being the same class, all rows agree with each other either way.
 */
export function cellWidth(text) {
	let width = 0;
	for (const char of text) {
		const code = char.codePointAt(0);
		if (code === 0xfe0f || code === 0x200d) continue; // variation selector, ZWJ
		width += code >= 0x1f300 || (code >= 0x2600 && code <= 0x27bf) ? 2 : 1;
	}
	return width;
}

/** Right-pad with spaces until the text occupies `width` cells. */
export function padCells(text, width) {
	const missing = width - cellWidth(text);
	return missing > 0 ? text + " ".repeat(missing) : text;
}

/** Colder is better, hotter is worse. */
function paceColorName(pace) {
	if (!pace) return "dim";
	if (pace.state === "hot") return "red";
	if (pace.state === "warm") return "yellow";
	if (pace.state === "cold" || pace.state === "cool") return "green";
	return "dim";
}

/**
 * Countdown text for a reset timestamp.
 * Returns "" when the timestamp is missing, unparseable, or already past.
 */
export function formatCountdown(resetsAt, nowMs = Date.now()) {
	if (!resetsAt) return "";

	const target = Date.parse(resetsAt);
	if (!Number.isFinite(target)) return "";

	const totalMinutes = Math.floor((target - nowMs) / 60_000);
	if (totalMinutes <= 0) return "";

	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;

	if (days >= 1) return `${days}d ${hours}h`;
	if (hours >= 1) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	return `${minutes}m`;
}

/** "12%" — one decimal only when it carries information. */
export function formatPercent(percent) {
	return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

function paint(text, colorName, useColor) {
	if (!useColor) return text;
	return `${ANSI[colorName]}${text}${ANSI.reset}`;
}

/**
 * Compose the status line.
 *
 *   full:  "5h 12% in 3h12m  wk 25% in 4d 2h  mo 40%"
 *   short: "12% / 25% / 40%"
 *
 * Missing windows are skipped; a window without a reset time omits its
 * countdown rather than printing a placeholder.
 */
export function formatStatusLine(
	limits,
	{ nowMs = Date.now(), color = false, short = false, pace, emoji = true } = {},
) {
	const keys = ["fiveHour", "weekly", "monthly"].filter((key) => limits?.[key]);
	if (keys.length === 0) return "";

	if (short) {
		const parts = keys.map((key) => formatPercent(limits[key].usedPercent));
		return parts.join(" / ");
	}

	const segments = keys.map((key) => {
		const window = limits[key];
		const label = paint(LABELS[key], "dim", color);
		const value = paint(
			formatPercent(window.usedPercent),
			severity(window.usedPercent),
			color,
		);
		const countdown = formatCountdown(window.resetsAt, nowMs);
		const reset = countdown
			? ` ${paint(`in ${countdown}`, "dim", color)}`
			: "";
		const verdict = formatPace(pace?.[key], { emoji });
		const paceTag = verdict
			? ` ${paint(`[${verdict}]`, paceColorName(pace[key]), color)}`
			: "";
		return `${label} ${value}${reset}${paceTag}`;
	});

	return segments.join("  ");
}

/** Plain-text variant for tests and non-TTY consumers. */
export function stripAnsi(text) {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Multi-line block for a dedicated watch tab.
 *
 *   ClinePass usage  updated 22:14:03
 *   5h  [##--------]    2%      3h 36m
 *   wk  [#---------]    1%      5d 16h
 *   mo  [----------]    0%      28d 16h
 *
 * ASCII bars so it survives any font or multiplexer.
 */
export function formatTable(
	limits,
	{ nowMs = Date.now(), color = false, updatedAt = "", pace, emoji = true } = {},
) {
	const keys = ["fiveHour", "weekly", "monthly"].filter((key) => limits?.[key]);
	if (keys.length === 0) return "";

	const BAR_WIDTH = 10;

	const verdicts = keys.map((key) => formatPace(pace?.[key], { emoji }));
	const paceWidth = verdicts.reduce(
		(max, text) => Math.max(max, cellWidth(text)),
		0,
	);

	const rows = keys.map((key, index) => {
		const window = limits[key];
		const percent = window.usedPercent;
		const filled =
			percent > 0
				? Math.max(1, Math.round((percent / 100) * BAR_WIDTH))
				: 0;

		const bar = `[${"#".repeat(filled)}${"-".repeat(BAR_WIDTH - filled)}]`;
		const paintedBar = paint(bar, severity(percent), color);
		const paintedPercent = paint(
			formatPercent(percent).padStart(4),
			severity(percent),
			color,
		);

		const cells = [`${LABELS[key].padEnd(2)}  ${paintedBar}  ${paintedPercent}`];

		// Reserve the verdict column on every row so the reset text lines up,
		// including rows with no verdict of their own (the 5-hour window).
		if (paceWidth > 0) {
			const badge = padCells(verdicts[index], paceWidth);
			cells.push(`  ${paint(badge, paceColorName(pace?.[key]), color)}`);
		}

		const countdown = formatCountdown(window.resetsAt, nowMs);
		if (countdown) {
			cells.push(`  ${paint(countdown, "dim", color)}`);
		}

		return cells.join("");
	});

	const header = updatedAt
		? `ClinePass usage  ${paint(`updated ${updatedAt}`, "dim", color)}`
		: "ClinePass usage";

	return [header, ...rows].join("\n");
}
