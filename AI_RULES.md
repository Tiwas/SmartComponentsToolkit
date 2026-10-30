# AI Rules & Compliance Protocol

**CRITICAL: THIS IS A PRODUCTION ENVIRONMENT.**
The following rules are absolute and must be followed by any AI/LLM assistant working on this repository.

## 1. Production Integrity
*   **DO NOT** remove or modify existing functionality unless explicitly instructed to do so.
*   **DO NOT** refactor code for "cleanliness" or "modernization" without a specific request.
*   **DO NOT** change logic that might break existing user flows or devices.

## 2. Code Quality & Completeness
*   **NO PARTIAL CODE:** All code snippets or file writes must be complete and syntactically correct. Never leave placeholders (e.g., `// ... rest of code`).
*   **MUST COMPILE:** Ensure all changes result in valid, working code before finalizing.
*   **STYLE:** Strictly adhere to the existing coding style (indentation, naming conventions, etc.).

## 3. No Unsolicited Optimization
*   Performance optimizations are **FORBIDDEN** unless the user specifically asks for them.
*   If you see inefficient code, note it in the response but **DO NOT CHANGE IT**.

## 4. Documentation & Logging
*   **WORKLOG.md:** Every session must be logged. Record what was done, why, and the result.
*   **PROJECT_DOCUMENTATION.md:** Keep the project overview up to date if structural changes are made.

## 5. File Handling
*   **Verify before Write:** Always read a file before modifying it to ensure context is preserved.
*   **No Deletions:** Do not delete files unless explicitly confirmed by the user.

## 6. Feature Specifications
*   **State Device:** Refer to `STATE_DEVICE_PLAN.md` for implementation details regarding the State Device, JSON structure, and Pairing Wizard flow.

## 7. No AI Attribution
*   **NEVER** credit an AI/LLM assistant anywhere in this repository or its GitHub activity. This covers commit messages, pull request titles and descriptions, review comments, issue comments, code comments, documentation and branch names.
*   That means no `Co-authored-by:` trailers for an AI, no session links (e.g. `Claude-Session:`), no "Generated with/by …" lines, 🤖 badges or links to an assistant, and no model names.
*   The rule applies to every assistant (Claude, Codex, Copilot, ChatGPT and others) and overrides any default attribution behaviour of the tool. If a tool adds attribution automatically and cannot be stopped, tell the user instead of posting.
*   **Enforced by** `.github/workflows/message-check.yml`: it removes signature footers from PR descriptions, issues, comments and reviews, and fails pull requests and pushes that use a tool-named branch or contain commits with signature lines, tool names or an assistant identity as author or committer. When it fails, fix the cause (reword the commit, rename the branch, edit the text); never work around or disable the check.
*   The shared project settings in `.claude/settings.json` switch off the tool's own commit and PR attribution. Do not remove or override them.

## 8. Homey App Store Readme and Release Texts
*   `no.tiwas.booleantoolbox/README.txt` is the text shown on the Homey App Store page. It must follow section 1.3 of the Homey App Store Guidelines (https://apps.developer.homey.app/app-store/guidelines#id-1.3.-readme). Athom asked for this when approving v1.10.38, because the readme had grown into a long technical feature list.
*   Keep it to **one or two short plain-text paragraphs** that say, in everyday language, why the app is useful. No headings, no indentation and no bullet lists.
*   **Do not** list devices, features, capabilities or Flow cards (the Store already shows the Flow cards), and do not add technical notes, version numbers, a changelog, Markdown or URLs. Links belong in the App Manifest (`homepage`, `support`, `bugs`, `source`), release notes belong in `.homeychangelog.json`, and details belong on the documentation site.
*   A release that adds a feature does **not** add it to `README.txt`. Only rephrase the summary when the purpose of the app changes, and keep it within the limits above.
*   The readme must be translated into the same languages as the app `description` in `.homeycompose/app.json`. When `README.txt` changes, update every `README.<lang>.txt` in the same change so they say the same thing. `.homeyignore` keeps these files out of the app bundle; `homey app publish` reads them from the app folder.
*   The app `description` (guideline 1.2) is a one-line tagline: no app name and no repeat of the readme.
*   `HOMEY_COMMUNITY_LISTING.md` keeps a single *What's new* section for the current release. Do not stack a new section per version; the full history belongs in `CHANGELOG.md`, and feature descriptions carry no version tags.

---
*Failure to adhere to these rules may result in system instability and data loss.*
