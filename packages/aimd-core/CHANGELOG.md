# Changelog

All notable changes to `@airalogy/aimd-core` will be documented in this file.

Earlier historical releases were not backfilled yet. This changelog currently starts from the `2.x` release line.

## [2.0.1] - 2026-03-12

### Added

- Added `AimdVarDefinition.defaultRaw` so downstream UIs can preserve authored default literals such as `25.0` while `default` remains the parsed numeric/boolean/string value.

## [2.0.0] - 2026-03-12

### Changed

- Completed the AIMD identifier cleanup as a breaking release: parsed AIMD nodes and extracted field metadata now use `id` as the only canonical identifier field.
- Removed deprecated `name` compatibility fields and step-hierarchy `parentName` / `prevName` / `nextName` aliases from parsed output and extracted field results.
- Renamed template-environment record lookup semantics to the `byId` model to match the `id`-only parsed output.
