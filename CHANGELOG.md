# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [0.2.0] - 2026-03-01

### Added
- Configurable onboarding wizard for language, security profile, and timeout.
- Per-thread slash commands for onboarding and runtime overrides.
- Text commands for onboarding, language, profile, and timeout management.
- Localized onboarding and help output in Chinese and English.

### Changed
- Persist and migrate session-level settings: language, onboarding, security profile, timeout.
- Progress reporting now follows session language for phases, labels, and hints.
- Documentation and `.env.example` updated for new onboarding controls.
