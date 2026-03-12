# Changelog

All notable changes to `@airalogy/aimd-recorder` will be documented in this file.

## [1.4.2] - 2026-03-12

### Changed

- `AimdProtocolRecorder` now passes the live record into renderer edit context so inline `ref_var` references show the current var value as readonly content when available, instead of always showing the raw var id.
- Updated `ref_step` presentation styles so inline step references reuse the same step-like visual language instead of the generic reference blockquote styling.
- Aligned `ref_var` presentation with normal var styling by removing the generic reference block shell and faded state.
- Unified inline check label typography with var/step identifiers by raising `check` id/label weight to match the other AIMD field tags.
- Aligned recorder-mode `ref_var` colors with the recorder's actual var field palette so referenced variable values use the same blue treatment as normal var inputs.

### Fixed

- Synced with the renderer-side `ref_step` fix so recorder-mode step references keep localized step numbers instead of regressing to raw step ids.

## [1.4.0] - 2026-03-12

### Added

- Added built-in runtime locale support for recorder UI via `locale` (`en-US` / `zh-CN`) on both `AimdProtocolRecorder` and `AimdQuizRecorder`.
- Added `messages` overrides plus exported locale helpers (`createAimdRecorderMessages`, `resolveAimdRecorderLocale`) for customizing recorder labels without forking the components.

## [1.2.0] - 2026-03-05

### Changed

- Unified var header semantics to use `.aimd-field__id` for var id display and measurement, while preserving the previous visual style.
- Reworked stacked var width sizing to be content-driven (label/input measurement), with tuned date/time compensation and reduced unnecessary default min-width for single-line controls.
- Improved plain `str/text` var input behavior: long text now wraps instead of horizontal scrolling, auto-resizes by content, and keeps compact single-line alignment with other controls (`30px` baseline) plus better multiline readability.
- Fixed height conflicts caused by generic textarea min-height rules (`82px`/`78px`) so compact `str/text` fields no longer get unintentionally stretched.
- Normalized datetime-like var values to include timezone offset on both initial hydration and user re-selection.
- Renamed implementation file from `AimdProtocolRecorder.vue` to `AimdRecorder.vue`; `AimdProtocolRecorder` is kept as a deprecated export alias for compatibility.
