# NABD Premium V2 — Phase 2 localization audit (2026-11-04)

This is a **development inventory**, not a claim that the application is fully translated.

## Source audit

Source files that still contain Arabic-script user-facing strings:

| File | Approx. Arabic-script code points in starting revision | Main issue |
|---|---:|---|
| `public/index.html` | 5,545 | Static dashboard sections, labels, helper text, dialogs |
| `public/app.js` | 8,017 | Dynamic dashboard statuses, error toasts, recommendation cards, broker controls |
| `public/live.js` | 2,771 | Real-time quote/feed captions, signal states and history |
| `public/accounts.html` | 4,145 | Login, account, admin, privacy static UI |
| `public/accounts.js` | 2,761 | Dynamic account validation, MFA, error messages, MT5 registration |
| `public/dashboard-locale.js` | 305 | Partial, selector-based translation |
| `public/landing-en.html` | 7 | Non-UI markup metadata / typographic fragments, review separately |

Counts are **source text inventory**, not an automated browser-language coverage result.

## Acceptance gates before merging this phase

- All user-interface text from dashboard, account, admin, help, privacy, modal and toast rendering must use a stable translation key with both `ar` and `en` entries.
- English display must not leave Arabic UI text in visible DOM, placeholders, labels, alerts, `aria-label`, `title` or status badges.
- For backend status/error events, prefer structured codes and keyed translations; do **not** infer trade fills or convert a rejected order into success.
- External news and subscriber-authored content may have no reliable English translation. Show an explicit English-language availability explanation and original-source link, never fabricate English news or market claims.
- English must set `lang="en"` and `dir="ltr"`; Arabic restores RTL. Charts retain chronological order and financial symbols keep stable numeric direction.
- Test both themes on desktop and mobile, fresh/stale quote, demo order confirmed/rejected, invalid lot, no account, disconnect/reconnect, empty news, admin errors and successful MFA.
- Add a browser-facing DOM inventory check for Arabic fragments after dynamic events. Static codepoint counting is not sufficient.
- Preserve trading strategy, EA, credentials, database, broker rules, risk and order paths.

## Current branch deliverables

- A shared bilingual terminology catalog in `public/i18n-core.js`.
- Reason-code-based explanations for known EA declines.
- A common locale-layout helper and conversion of the dashboard language selector to use it.
- Automated tests for translation-key parity, zero Arabic in English dictionary values, protected API behavior and module routing.

**Status:** In progress. This draft branch must not be deployed or merged into `main` until all acceptance gates above pass.
