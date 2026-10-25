import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, fetchUsageLimits, parseLimits } from "../src/api.mjs";

const BODY = {
	success: true,
	data: {
		limits: [
			{ type: "five_hour", percentUsed: 12.5, resetsAt: "2026-07-16T15:00:00Z" },
			{ type: "weekly", percentUsed: 25, resetsAt: "2026-07-20T00:00:00Z" },
			{ type: "monthly", percentUsed: 40, resetsAt: null },
		],
	},
};

test("parseLimits maps the three ClinePass windows", () => {
	const limits = parseLimits(BODY);
	assert.deepEqual(limits.fiveHour, {
		usedPercent: 12.5,
		resetsAt: "2026-07-16T15:00:00Z",
	});
	assert.deepEqual(limits.weekly, {
		usedPercent: 25,
		resetsAt: "2026-07-20T00:00:00Z",
	});
	assert.equal(limits.monthly.usedPercent, 40);
	assert.equal(limits.monthly.resetsAt, null);
});

test("parseLimits ignores unknown limit types", () => {
	const limits = parseLimits({
		success: true,
		data: {
			limits: [
				...BODY.data.limits,
				{ type: "experimental_pool", percentUsed: 77, resetsAt: null },
			],
		},
	});
	assert.equal(Object.keys(limits).sort().join(","), "fiveHour,monthly,weekly");
	assert.equal(limits.fiveHour.usedPercent, 12.5);
});

test("parseLimits clamps out-of-range percentages and drops non-numeric ones", () => {
	const limits = parseLimits({
		success: true,
		data: {
			limits: [
				{ type: "five_hour", percentUsed: 140, resetsAt: null },
				{ type: "weekly", percentUsed: -5, resetsAt: null },
				{ type: "monthly", percentUsed: "n/a", resetsAt: null },
			],
		},
	});
	assert.equal(limits.fiveHour.usedPercent, 100);
	assert.equal(limits.weekly.usedPercent, 0);
	assert.equal(limits.monthly, null);
});

test("parseLimits rejects unsuccessful or malformed payloads", () => {
	assert.throws(() => parseLimits({ success: false }), ApiError);
	assert.throws(() => parseLimits({ success: true, data: {} }), ApiError);
	assert.throws(
		() => parseLimits({ success: true, data: { limits: [{ type: "other" }] } }),
		ApiError,
	);
});

test("fetchUsageLimits sends the bearer token and normalizes the result", async () => {
	let seen;
	const result = await fetchUsageLimits({
		token: "sk-test",
		now: () => 1_000,
		fetchImpl: async (url, init) => {
			seen = { url, init };
			return {
				ok: true,
				status: 200,
				json: async () => BODY,
			};
		},
	});

	assert.equal(seen.url, "https://api.cline.bot/api/v1/users/me/plan/usage-limits");
	assert.equal(seen.init.headers.Authorization, "Bearer sk-test");
	assert.equal(result.fetchedAt, 1_000);
	assert.equal(result.limits.weekly.usedPercent, 25);
});

test("fetchUsageLimits explains rejected credentials", async () => {
	await assert.rejects(
		fetchUsageLimits({
			token: "expired",
			fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
		}),
		(error) => error instanceof ApiError && /cline auth/.test(error.message),
	);
});

test("fetchUsageLimits surfaces transport failures", async () => {
	await assert.rejects(
		fetchUsageLimits({
			token: "sk-test",
			fetchImpl: async () => {
				throw new Error("ENOTFOUND");
			},
		}),
		(error) => error instanceof ApiError && /ENOTFOUND/.test(error.message),
	);
});
