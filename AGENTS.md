# Repository Guidelines

## Project Structure & Module Organization

This package is a small CommonJS Node.js library for Redis-backed interface caching.

- `lib/cache.js` contains the exported `Cacher` class and all runtime logic.
- `test/cache.test.js` contains AVA tests for Redis caching, raw values, memory cache behavior, and custom Redis clients.
- `README.md` is generated partly from JSDoc via `npm run doc`; update source comments before regenerating docs.
- `package.json` defines package metadata, npm scripts, AVA config, and dependencies.

Keep new runtime code under `lib/` and tests under `test/`. Name tests with the existing `*.test.js` pattern.

## Build, Test, and Development Commands

- `npm install` installs runtime and development dependencies.
- `npm run test` runs `nyc ava -v`; Redis must be available at `127.0.0.1:6379`, database `12`, because tests flush that database.
- `npm run doc` regenerates the JSDoc section in `README.md` from `lib/cache.js`.
- `npm run coverage` reports lcov coverage to Coveralls; this is mainly for CI/release use.
- `npm run release` runs `standard-version` to update changelog and package version.

There is no declared `lint` script. If you need style checks, use the existing ESLint dependencies explicitly, for example `npx eslint lib test`.

## Coding Style & Naming Conventions

Use CommonJS (`require`, `module.exports`) and match the existing Airbnb-style JavaScript conventions: two-space indentation, semicolons, single quotes, trailing commas in multiline objects, and concise async functions. Prefer `const` and pure helpers where practical. Keep public option names stable, such as `redis`, `redisClient`, `prefix`, `expire`, `raw`, and `mem`.

Comments should explain behavioral intent, especially around cache consistency, Redis TTL handling, and memory-cache tradeoffs.

## Testing Guidelines

Tests use AVA and run serially. Add focused cases near related cache behavior in `test/cache.test.js`. Use deterministic Redis keys with the `TEST_` prefix and clear Redis/memory state before assertions, following the existing `beforeEach` pattern. Validate both returned values and Redis side effects when changing cache reads, writes, expiry, or serialization.

## Commit & Pull Request Guidelines

Git history follows Conventional Commits, for example `feat: support redisClient as input arg`, `test: case of input client`, and `chore(release): 1.1.0`. Use `feat`, `fix`, `test`, `ci`, `build`, or `chore` as appropriate.

Pull requests should describe the cache behavior changed, include test results from `npm run test`, mention Redis assumptions, and link related issues. Include README/JSDoc updates when public API behavior changes.
