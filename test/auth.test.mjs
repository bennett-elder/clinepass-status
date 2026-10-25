import assert from "node:assert/strict";
import test from "node:test";
import { AuthError, resolveToken, tokenFromSettings } from "../src/auth.mjs";

test("tokenFromSettings prefers auth.accessToken", () => {
	assert.deepEqual(
		tokenFromSettings({
			auth: { accessToken: "access", apiKey: "nested" },
			apiKey: "flat",
		}),
		{ token: "access", via: "auth.accessToken" },
	);
});

test("tokenFromSettings falls back to apiKey then auth.apiKey", () => {
	assert.deepEqual(tokenFromSettings({ apiKey: "flat" }), {
		token: "flat",
		via: "apiKey",
	});
	assert.deepEqual(tokenFromSettings({ auth: { apiKey: "nested" } }), {
		token: "nested",
		via: "auth.apiKey",
	});
	assert.deepEqual(tokenFromSettings({}), { token: null, via: null });
	assert.deepEqual(tokenFromSettings(undefined), { token: null, via: null });
});

test("environment keys win over stored sessions", () => {
	const env = { CLINE_API_KEY: "env-flat", CLINEPASS_API_KEY: "env-pass" };
	assert.deepEqual(resolveToken({ env }), {
		token: "env-flat",
		via: "env CLINE_API_KEY",
		source: "env",
	});

	assert.equal(
		resolveToken({ env: { CLINEPASS_API_KEY: "env-pass" } }).token,
		"env-pass",
	);
});

test("resolveToken reads providers.json and reports its origin", () => {
	const result = resolveToken({
		env: {},
		fileExists: (file) => file.endsWith("providers.json"),
		readFile: () => ({
			providers: { cline: { settings: { auth: { accessToken: "workos:abc" } } } },
		}),
	});

	assert.equal(result.token, "workos:abc");
	assert.equal(result.source, "file");
	assert.match(result.via, /auth\.accessToken \(default\)/);
});

test("resolveToken explains a missing file", () => {
	assert.throws(
		() => resolveToken({ env: {}, fileExists: () => false }),
		(error) => error instanceof AuthError && /cline auth/.test(error.message),
	);
});

test("resolveToken explains a file without the cline provider", () => {
	assert.throws(
		() =>
			resolveToken({
				env: {},
				fileExists: () => true,
				readFile: () => ({ providers: {} }),
			}),
		(error) => error instanceof AuthError && /No Cline token/.test(error.message),
	);
});
