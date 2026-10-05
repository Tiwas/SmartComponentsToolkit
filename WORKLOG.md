# Worklog

## 2026-10-05 — Release prep for test v1.10.34

### Requested
- Lars deleted the Flow name card test Flows. He asked for a new test version on the Homey, installed on his own Homey, and for HOMEY_COMMUNITY_LISTING.md to be updated, but not the forum post itself.

### Implemented
- Version 1.10.34 (`homey app version`, `npm version`), with the store changelog in English and Norwegian linking to the Waiter Gates guide. It ships the waiter clean-up from #69: waits inside a card use `WaiterManager.CARD_FLOW_ID` instead of a Flow id Homey never supplies, and a takeover of a Waiter ID is logged at INFO. Behaviour does not change.
- `CHANGELOG.md`: 1.10.34 section. `README.md`: summary and Circadian Light Group heading. The badges are dynamic and need no change.
- `HOMEY_COMMUNITY_LISTING.md`:
  - The title and header say test v1.10.34.
  - "What's new" has a v1.10.34 section.
  - The Flow name card is labelled "test v1.10.33 and later".
  - The Circadian Light Group line says v1.10.34.
- The forum post on community.homey.app is not changed.

## 2026-10-05 — Waiter flow context cleanup

### Requested
- Lars asked whether the waiter check that compares Flow ids is wrong, and then asked for it to be cleaned up.

### Findings
- The behaviour matches the docs (`docs/docs/waiter-gates.html`): the same Waiter ID started again takes over and the earlier wait takes the NO path, and an in-card wait and a background wait cannot share an ID. Only the code was misleading. It read `state?.flowId`, which Homey never supplies, so every in-card capability wait used `'unknown'`, and the Conditional Gate in-card wait used `undefined`.

### Implemented
- `lib/WaiterManager.js`: new `WaiterManager.CARD_FLOW_ID` (`'card'`), next to `BACKGROUND_FLOW_ID`. A comment in `createWaiter` explains that the context only separates in-card waits from background waits. The takeover is logged at INFO instead of DEBUG. It is not logged at WARN, because a takeover is expected behaviour and should not add a diagnostic event. Diagnostic events store a fixed text, never the log message.
- `app.js`: the in-card capability wait and the Conditional Gate in-card wait pass `{ flowId: WaiterManager.CARD_FLOW_ID, flowToken: null }` instead of reading `state`.
- No change in behaviour. Gate in-card waits use unique IDs, so their context never takes part in a comparison.
- `PROJECT_DOCUMENTATION.md`: a Waiter IDs note.

### Verification
- Jest: 24 suites / 374 tests pass. The takeover test now asserts the INFO log (and no WARN). New tests check that an in-card wait cannot take a background wait's ID, in `WaiterManager` and through the `app.js` cards (`wait_until_start`, then `wait_until_becomes_true`).
- Codex had reached its usage limit, so Lars chose a local stand-in review. It found no bugs. Its points were a wrong reason given for INFO (it is fixed) and a missing app-level test (it is added). The only theoretical behaviour change is that a capability Waiter ID typed exactly like a pending gate in-card ID (`gate_<name>_<time>_<random>`) now takes that ID over instead of failing.

## 2026-10-05 — Test v1.10.33 released

### Requested
- Lars tested 1.10.33 in the Flow editor and confirmed it works: a Logic condition on "Has error" branches correctly, the "no" branch shows the Flow name, and a duplicated Flow takes the error branch with a message naming both Flows. He asked for it to be merged and published to test.

### Implemented
- PR #67 (release prep) merged, squash `677cebd`. It has no code changes, so no review thumbs-up was needed. PR #66 (the card) was merged earlier as `faf014c`, after a local stand-in review, because Codex had reached its usage limit.
- `HOMEY_HEADLESS=1 homey app publish` uploaded build 62 (v1.10.33), which was released to the test channel from the build page. It was not submitted for certification.
- The dev run was stopped and `homey app install` was run from `main`.

### Verification
- The test channel page reports `data-hy-app-version="1.10.33"`, and the store API reports test 1.10.33 / live 1.10.16. The dynamic badges in the README and on the docs site therefore show the new version.
- On Lars's New Homey:
  - The app runs 1.10.33 (`running`, `devkit_install`), and all 11 app devices are available.
  - `runFlowCardAction` on the card returns the Flow name with `has_error: false`, and `[Unknown – save the Flow]` with `has_error: true` for an unsaved id.

### Open
- Test Flows `c74adfe6-51f8-4c50-b732-852bfde360b0` and `1d61d3c1-14cc-4042-9a05-9707e287bc82` are disabled and can be deleted.
- Not changed (from the #66 findings): the waiter cards read `state.flowId`, which Homey never supplies.

## 2026-10-05 — Release prep for test v1.10.33

### Requested
- Lars asked for the Flow name card (#66) to be published to the test channel, with HOMEY_COMMUNITY_LISTING.md updated. He also asked for a section on debugging across Flows above "Circadian Light Group — now on stable", covering the new card and the Flow Doctor loop check. Separately, he asked whether the outdated version badges could be read from the Homey store.

### Implemented
- Version 1.10.33 (`homey app version`, `npm version`), with the store changelog in English and Norwegian (`.homeychangelog.json`) linking to the Flow card reference.
- `CHANGELOG.md`: 1.10.33 section.
- `README.md`: new summary. The stable and test badges are now shields.io dynamic badges that read `liveVersion` / `testVersion` from the public Homey App Store API (`https://apps-api.athom.com/api/v1/app/no.tiwas.booleantoolbox`), so they need no manual bump. The stable badge said 1.10.9, while the store has 1.10.16.
- `docs/index.html`: the header badges (stable 1.10.9 / test 1.10.25) are the same dynamic badges in the site colours. The Circadian Light Group labels (`docs/index.html`, `docs/docs/circadian-light-group.html`) now say "Stable since v1.10.16" instead of "v1.10.25 test". The Composite Device install link (`docs/docs/composite-device.html`) has no version number. The "v1.10.22 test" label on Composite Device in `docs/docs/devices.html` is still correct and was not changed.
- `HOMEY_COMMUNITY_LISTING.md`:
  - The title and header say test v1.10.33.
  - "What's new" has a v1.10.33 section with an example.
  - A new "Debugging across Flows" section above the Circadian Light Group section covers the card and Flow Doctor's Flow tree and circular-reference check (#57).
  - The Flow card table has a row for the new card.

### Verification
- The badge sources are checked: the API answers with `Access-Control-Allow-Origin: *`, and the shields.io badges render "v1.10.16 stable" and "v1.10.32 test".
- The dev run of 1.10.33 (with `has_error` and all translations) is installed on Lars's New Homey for his editor test before publishing.

## 2026-10-05 — "Get this Flow's name" card (`flow_whoami`)

### Requested
- Lars asked whether Homey has a "whoami" for Flows, so a card could return the name of the Flow it runs in, and then asked for the card to be built, merged and published to test, with the Homey Community listing updated.

### Findings
- Homey gives a card no Flow context. The SDK run listener only gets `(args, state)`; in a live run `state` held only `manual`. The Web API has no execution metadata or run events for Flows.
- The app's Web API token (`homey:manager:api`) may read Flows but not write them: `updateAdvancedFlow` failed live with `HomeyAPIError: Missing Scopes` (403). So the first design, where the app writes the Flow id into each card when a Flow is saved, is not possible. That prototype (realtime `advancedflow.create` / `update` events, which do include the cards) was dropped.
- When an action card takes the error output, Homey drops its tokens (`runFlowCardAction` returns `returnTokens: null`). Problems are therefore reported in tokens, not by throwing.
- Action cards with tokens are hidden in standard Flows, so the card is Advanced Flow only.
- Side note, not changed: `app.js` reads `state?.flowId` / `state?.flowToken` when creating waiters, but Homey never supplies them. All waiters therefore share the Flow id `'unknown'`, and the "Waiter ID already exists" guard in `lib/WaiterManager.js` (`createWaiter`) never separates Flows.

### Implemented
- `.homeycompose/flow/actions/flow_whoami.json`: "Get the name of [this Flow]" action card. It has a required autocomplete argument `flow` and the tokens `flow_name`, `flow_id`, `folder_name`, `has_error` (yes/no, so a Logic condition can branch) and `error_message`. The card and all its messages are translated into the 11 app languages (da, de, en, es, fi, fr, it, nl, no, pl, sv).
- `lib/FlowIdentity.js`: the autocomplete offers one choice, "this Flow", with a new random UUID each time the list opens, and Homey stores the picked id with the card. On every run the app reads the Advanced Flows (`$cache: false`, no memory between runs, so a rename shows at once) and finds the Flow holding a card with that id. Nothing picked, no saved Flow, or the id in several Flows (a copied card or duplicated Flow) gives a marker name (`[Not set]`, `[Unknown – save the Flow]`, `[Duplicate]`), `has_error: true` and an explanation in `error_message`, on the normal output. It throws only when the Flows cannot be read.
- `app.js`: registration. `locales/*.json`: `flow_identity` strings in all 11 languages.
- Tests: `FlowIdentity.test.js` (new) and `AppFlowCards.test.js`.
- Docs: `docs/docs/flow-cards.html` (`#action-flow-name`), `docs/index.html` (action list), `README.txt`, `PROJECT_DOCUMENTATION.md`.

### Verification
- Jest: 24 suites / 372 tests pass. `homey app validate --level publish` passes.
- Live on Lars's New Homey (`homey app run --remote`, plus the API playground with `getFlowCardAutocomplete` and `runFlowCardAction`): the list returns one choice with a new id each time. The card returned the Flow name, and after a rename the new name on the next run. A copied id gave `[Duplicate]` with both Flow names in `error_message`, and an id in no saved Flow gave `[Unknown – save the Flow]`, both on the normal output. After picking again in the copy, each Flow returned its own name.
- Lars tested in the Flow editor: the card works and the `Flow name` tag can be used in the next card. His feedback (the error branch had no name, copies only failed, and he wanted a yes/no tag for branching) led to the marker, `has_error` and `error_message` design.
- Codex had reached its usage limit, so Lars chose a local stand-in review (as for #54). It found nothing significant.
- Test Flows `c74adfe6-51f8-4c50-b732-852bfde360b0` and `1d61d3c1-14cc-4042-9a05-9707e287bc82` are disabled, not deleted.

## 2026-10-05 — Composite device source images

### Requested
- Lars asked for the untracked source images in the local checkout to be committed, and whether `main` needs a new Homey build.

### Implemented
- `assets/images_composite_device/source.svg`: added unchanged.
- `assets/composite_device/source.png`: added with unchanged content. The original file name named the image generator, so it is renamed in the same way as the other source images in #59 and #60.
- `.homeyignore` already excludes both paths (`assets/composite_device/` and `assets/images_composite_device/source.svg`), so the app bundle is unchanged.
- New build: not needed. The published 1.10.32 changelog covers #52–#55. Since #55, only files outside the app bundle have changed (tests, docs, coverage, ignore patterns, source images), plus the version metadata that matches the published build.
- `.gitignore`: the local log folder from earlier development runs (runtime logs, monitor state and process files) is now ignored, at Lars's request. It holds local runtime data and the repo is public. `.homeyignore` already excluded it from the app bundle.

### Not changed
- `source.png` still carries the generator's embedded content-credential metadata. Only the file name changed.

### Verification
- SHA-256 of both committed files matches the originals.

## 2026-10-05 — Test v1.10.32 released and local cleanup

### Requested
- Lars asked for the 1.10.32 release to be completed and the local checkout tidied.

### Implemented
- PR #62 merged (squash, `1453450`).
- Release month in `CHANGELOG.md`: unchanged (September 2026). 1.10.32 was already on the test channel.
- Publish: not run, because 1.10.32 was already on the test channel.
- `homey app install`: not run, for the same reason.
- Local branches removed: the old 1.10.26 release branch, `fix/clg-keep-unknown-lux-sensor`, `mystifying-mestorf-3a266c` and `practical-leavitt-65f2f3`. All four were on their expected commits. There were no other worktrees, and the empty `.claude/worktrees` folder was removed.
- Ruleset "Require status checks to pass" checked: active on the default branch with no bypass actors. It blocks deletion and force pushes, requires a pull request and requires the `check` status. It already matched the intended setup and was not changed.

### Open
- Nothing for the release. No build was uploaded in this session.
- Three untracked files that predate this session in the local checkout were left untouched.

### Verification
- Test-channel check: `https://homey.app/a/no.tiwas.booleantoolbox/test/` reports `data-hy-app-version="1.10.32"`. The store page still reports 1.10.16.
- `.homeycompose/app.json` on `main` shows `"version": "1.10.32"` after the merge.
- `npm run test:package`, `homey app publish` and `homey app install`: not run, because the version was already published.

## 2026-10-05 — Release prep for test v1.10.32

### Requested
- Lars had a local, uncommitted version bump to 1.10.32 with an English changelog entry (the files `homey app publish` writes). The changes were lost locally, so the release prep is recreated from his diff, following the 1.10.30 and 1.10.31 release PRs.

### Implemented
- Version 1.10.32 in `.homeycompose/app.json`, `package.json` and `package-lock.json`.
- `.homeychangelog.json`: Lars's English text unchanged, plus a Norwegian translation. Card and setting names match the app's own Norwegian strings ("Pause til klokkeslett", "Egen morgenprofil").
- `CHANGELOG.md`: 1.10.32 section covering #52–#55 (time zone fix, astronomical estimate, morning profile, lux anchors and unknown lux sensors kept in the editors, removed dormant wrapper) and the known update-day lux-crossing edge case from #53.
- `README.md`: test badge, release summary and the Circadian Light Group heading say v1.10.32.
- `HOMEY_COMMUNITY_LISTING.md` already describes v1.10.32 (#56); not changed.

### Open
- Whether v1.10.32 is already on the test channel could not be checked from the working environment. If it is not, publish it after merge with `homey app publish`. If it is published later than September, adjust the month in `CHANGELOG.md`.

### Verification
- All four JSON files parse; the version is 1.10.32 in all three version fields.
- `npx jest --runInBand`: 23 suites, 358 tests passed.
- `npm run test:package` not run here (Homey CLI not available).

## 2026-10-05 — Shared project settings without attribution

### Requested
- Lars asked for a project setting that stops the coding assistant from adding its own attribution, so signatures are not written in the first place (the message check from #60 only cleans up afterwards).

### Implemented
- `.claude/settings.json` (new, tracked): `attribution.commit` and `attribution.pr` set to empty strings and `attribution.sessionUrl` set to `false`. This removes the co-author trailer, the PR footer and the session link from commits and PRs the assistant creates. The object form is used because older versions reject `true`/`false` for this key.
- `.gitignore`: `.claude/` became `.claude/*` with `!.claude/settings.json`, so only the shared settings file is tracked. Worktrees and `.claude/settings.local.json` stay ignored. A directory pattern cannot be re-included, which is why the pattern changed.
- `AI_RULES.md` §7 and `PROJECT_DOCUMENTATION.md` mention the file.

### Not changed
- The git author identity. A cloud session's container can still have an assistant identity configured. The message check fails such commits, and the author has to be set per commit (or in the environment) until that is changed.

### Verification
- `.claude/settings.json` parses as JSON with the keys documented for the current settings schema.
- `git check-ignore`: `.claude/settings.json` is tracked; `.claude/settings.local.json` and `.claude/worktrees/…` are still ignored.
- Not yet observed in a new session: the setting takes effect in sessions started after it is on `main`.

## 2026-10-05 — Second pass: remaining attribution and references

### Requested
- Lars asked for a new pass over `AI_RULES.md` §7: messages had still been signed, and the conventions file had been referenced by name. Work from a separate worktree and leave no old worktrees or leftovers behind.

### Implemented
- GitHub: two `@codex review` comments on PR #57 carried a "Generated by …" footer. Both were edited down to the command itself; a read-back confirmed the footer was not added again.
- A read-only check of all 35 PRs (descriptions, comments and review threads) and all 23 issues (bodies and comments) found nothing else to fix. The owner's replies in review threads (#43, #47, #48) carry no attribution. There are no releases. The remaining assistant names on GitHub come from the review bot itself (its own comments and reviews) and from the `@codex review` commands that start it; both were left as they are.
- Repo files:
  - The circadian source image whose file name named the image generator is renamed to `source.png` (content unchanged), and `.homeyignore` names `source.png`, so it stays out of the app bundle as before. This matches the two source images renamed in the first pass.
  - `robots.md`: removed the closing line that credited an assistant with maintaining the file.
  - `DOCUMENTATION_PROMPT_TEMPLATE.md`: removed three references to the conventions file by name.
  - `.gitignore`: neutral comment above the `PROJECT_DOCUMENTATION.md` pattern.
  - This worklog: the first-pass entry no longer repeats the names it removed.
- Leftovers removed, confirmed by Lars: `SESSION_SUMMARY.md` (an old session note, not referenced anywhere) and the 27 coverage report files in `no.tiwas.booleantoolbox/coverage/`. `coverage/` is now in `.gitignore`, so `npm run test:coverage` output is not committed again; `.homeyignore` already kept it out of the app bundle.
- Old branches: the nine merged branches left on GitHub (six of them with tool names) were deleted by Lars. In the working environment, all worktrees and session branches were removed.
- Message check (requested by Lars as a guard against new signatures; he is the only contributor): `.github/workflows/message-check.yml` runs `.github/scripts/message-check.js` on pull requests, pushes to any branch, issues, comments and reviews.
  - Pull requests: signature footers are removed from the description; the check fails on tool names, assistant links or conventions-file names in the title or description, on a tool-named branch, and on commits with signature lines, tool names or an assistant identity.
  - Pushes: the same branch and commit checks (new branches are checked against `main`, deleted branches and tags are skipped).
  - Issues, comments, review comments and reviews: signature footers are removed; the run fails when the text names the conventions file or links to an assistant session. Bot accounts (such as the review bot) are skipped, and `@codex review` commands are allowed.
  - Edits use `GITHUB_TOKEN`, so they do not start new runs.
  - `AI_RULES.md` §7 names the check, and `PROJECT_DOCUMENTATION.md` lists it.
- PR #60: neutral title and description, at Lars's request.

### Not changed
- Commit history on `main` (trailers and merge messages with tool branch names), for the reasons given in the first pass.
- The rule text in `AI_RULES.md` and the conventions file itself, and the ignore patterns for local tool folders.
- The circadian source image still carries the generator's embedded content-credential metadata; only the file name changed.

### Verification
- `npx jest --runInBand`: 23 suites, 358 tests passed.
- `npm run test:package` (run by Lars): publish validation passed; bundle 910 files, 8.00 MB, 17 manifest assets verified.
- `source.png`, `SESSION_SUMMARY.md` and `coverage/` are not referenced by any manifest, code or config.
- Message check:
  - `node --test .github/scripts/message-check.test.js`: 23 tests passed.
  - Run over all 478 commits on `main`: it flags all 126 commits with signature lines and all 28 with an assistant identity. The 28 flagged for names alone are all true hits (merge messages with tool-named branches and one subject naming a tool). No clean commit is flagged. Text from earlier PR descriptions (#47, #57, #59) passes.
  - Local end-to-end run of the script with Actions-style event files and a fake API: a PR description footer and the #57 comment footer are removed with one PATCH each; a push of `claude/x` fails; pushes of this branch and of `main` pass.
  - The workflow has not run on GitHub yet; the first real run is on this PR.

## 2026-10-05 — Remove assistant names and attribution

### Requested
- Lars asked to remove AI attribution from pull requests and the repo, following `AI_RULES.md` §7. Reviews stay; Lars decides about comments himself.

### Implemented
- Pull request descriptions #47–#57: removed "Generated with …" footers, session links and headings that named the conventions file. A read-only check of all 33 PR titles and descriptions found no remaining attribution.
- Repo files: neutral wording in four `WORKLOG.md` lines; a tool name removed from four test names in `LongWaitFlowCards.test.js`; the two source images in `assets/images_logic_device/` and `assets/images_logic_unit/` renamed to `source.png`, with `.homeyignore` updated so they stay out of the app bundle; neutral `.gitignore` comment.
- Kept on purpose: the ignore patterns for local tool folders in `.gitignore`, `.homeyignore` and `scripts/check-package.js` (they keep local tool files out of git and the bundle), the rule text in `AI_RULES.md`, the repo conventions file itself, and `DOCUMENTATION_PROMPT_TEMPLATE.md` (deleting files needs Lars's confirmation under rule 5).

### Not done
- Rewriting the commit history of `main` (trailers, merge messages with tool branch names, commits authored by an assistant identity) was not possible from the working environment. It would change about 470 commit ids and move four tags, and the original commits stay visible on the pull request pages anyway.

### Verification
- `npx jest --runInBand`: 23 suites, 358 tests passed.

## 2026-10-04 — GitHub Pages deployment through GitHub Actions

### Requested
- The Flow Doctor update merged in #57 must be live at https://tiwas.github.io/SmartComponentsToolkit/tools/flow-doctor.html. Lars checked the Pages and Actions settings, and the site still does not rebuild.

### Findings
- The built-in "pages build and deployment" run (branch source) last ran on 2026-09-05 at 17:22 UTC, for #39. Nothing merged after that started a run, including the `docs/` changes in #47, #53 and #57. There are no failed runs, so there is no log to debug. The live site therefore still shows the 2026-09-05 version of `docs/`.
- `docs/` is plain static HTML (no Jekyll front matter, Liquid or `_config.yml`), so it can be published as is.

### Implemented
- `.github/workflows/pages.yml`: publishes `docs/` with the official Pages actions (`configure-pages`, `upload-pages-artifact`, `deploy-pages`) on every push to `main` that changes `docs/` or the workflow, and on manual start (`workflow_dispatch`).
- `PROJECT_DOCUMENTATION.md`: notes how `docs/` is published.
- Needs one setting: Settings → Pages → Build and deployment → Source: "GitHub Actions". With the old "Deploy from a branch" source the deploy step fails.
- Side effect: `docs/template-structure.md` is no longer turned into HTML by Jekyll and is served as plain Markdown. No page links to it.

## 2026-10-04 — Flow Doctor: flow tree showing who points to a flow

### Requested
- Lars asked for a view in the web tools that lists all flows in the same folder tree as the Homey app, where selecting a flow shows every flow that starts it, over several levels (selecting "All on - Toolbox" should show "All on", and then whoever starts "All on"), with an alarm for circular references.
- Follow-up: the tab should only answer "who points to this flow". References to deleted flows belong in the regular Flows view, not in the tree.
- Follow-up: every visible string must be translated in all four languages (en/no/de/nl).
- Follow-up: no AI attribution anywhere in the repo or its GitHub activity; add this to the rules.

### Implemented
- `docs/tools/flow-doctor.html`: new **Flow tree** tab. The scan now also reads `api.flow.getFlowFolders()`. A DOM-free `FlowGraph` object builds the links between flows from *Start a Flow* (and its Text/Number/Yes-No/Image-tag variants), *Enable a Flow* and *Disable a Flow* cards in standard and Advanced Flows, the folder tree (folders first, natural sort) and circular references (Tarjan SCC).
- Selecting a flow shows who points to it and who points to those, through every level, with the card used, folder path, disabled flows, Advanced Flow cards not wired to a trigger, Else-column cards and delays. A flow that is already in the chain is marked as a circular reference and not expanded again.
- Circular-reference alarm at the top of the tab and on each affected flow: a loop of wired *Start a Flow* cards between enabled flows is red; a loop through a disabled flow, an unwired card or an Enable/Disable card is shown as inactive.
- Regular Flows view: new findings for references to deleted flows (all three card kinds; Homey does not mark these flows as broken) and for flows in a loop, plus a "Flow tree" button on each row. The bug report adds link and loop counts only, no names.
- Translations: all new strings in en/no/de/nl. Card names use the tool's own labels instead of Homey's card titles, which follow the Homey's language. Also translated strings that were hard-coded in English: the severity filters and badges, the search placeholders, "disabled", "(unnamed)", the API reset confirmation and two error messages.
- `docs/index.html`: Flow Doctor card text mentions the new feature.
- Review fix: when `getFlows()` or `getAdvancedFlows()` fails, the scan still goes on with an empty list, but deleted-flow findings are now skipped. Before, a transient API error reported valid flows (for example an Advanced Flow started from a standard flow) as deleted.
- Review fix: delays in Advanced Flows live on separate `delay` cards (`args.delay`, same shape as a standard-flow card delay, checked on Lars's Homey). The link from an Advanced Flow now gets the shortest total delay on the path from a trigger or the start card to the Start/Enable/Disable card, so the delay badge also shows for Advanced Flows. A path without any delay means no badge.
- Adversarial review fixes:
  - Loops are now built from *Start a Flow* links only. A flow that disables itself, or two flows that enable/disable each other, no longer raise a circular-reference alarm or finding. Enable/Disable links still show as pointers, and a repeat through one is labelled "already in this chain".
  - A flow is never counted as its own pointer (direct count, tree badge, "only flows that other flows point to" filter).
  - All direct pointers are always listed; the 400-node limit only cuts deeper levels. A flow that was already expanded in the same chain shows "shown above" instead of repeating its ancestors.
  - A failed flow list now shows a warning above the tabs, and the bug report sends `missingTargets: null` with `flowListsComplete: false`.
  - The "Flow tree" button in the Flows tab scrolls the tab into view. The folder tree is built once per scan, and a folder in a corrupt parent loop shows the same path as its place in the tree.
- Second adversarial pass:
  - Loop detection (Tarjan) is iterative, so a very long chain of flows can no longer overflow the call stack and fail the whole scan (a 20 000-flow chain overflowed the recursive version).
  - The loop badge in the chain is coloured from the links on the path shown, not from the flow's overall loop status.
  - A missing `getAdvancedFlows` method counts as an incomplete flow list, and failed folder loading shows its own warning instead of silently flattening the tree.
  - Folder toggles are ignored while the tree is filtered (folders are forced open then). A language switch re-renders the warning and the Flow tree even when the scan returned no flows. Delay units are translated (Norwegian "t", German "Std./Min./Sek.", Dutch "u").
  - One pointer rule (`FlowGraph.pointerGroups`) for the chain, counts and filter, with counts cached per scan. The graph reads card URIs with the same rule as the card checks (`card.id || card.uri`), so it no longer invents links from cards the checks ignore.
- Third adversarial pass:
  - A Homey that answers 404 for Advanced Flows (no Advanced Flow support) is treated as a complete, empty list, so it does not show the incomplete-scan warning on every scan; other failures still do.
  - The chain reserves the direct pointers for the top level. A flow whose pointers are listed elsewhere says "shown elsewhere in this chain", and a row whose pointers were left out by the 400-node limit says "chain cut off here", so an empty row never looks like "nobody points to this flow".
  - On narrow screens every flow click (tree, loop alert, chain) brings the detail panel into view. While the tree is filtered, folder headers are not clickable and Expand/Collapse all are disabled.
  - Delays are rounded (0.07 h shows 252 s, not 252.00000000000003 s). Closed folders no longer build hidden HTML, folder paths are cached per scan, and the unused `FlowGraph.pointers` helper is gone.
- `AI_RULES.md` §7: no AI attribution in commits, PRs, comments, code, docs or branch names. The repo conventions file now points to `AI_RULES.md`.

### Verification
- Node unit tests for `FlowGraph` (run from a scratch copy of the inline script, not checked in): 8 passed. They cover standard and Advanced Flows, all card kinds, the legacy `uri` + `id` card shape, deleted targets, unwired cards, active/inactive/self loops, the folder tree with a corrupt parent loop, and empty input.
- Playwright (Chromium) against a mocked Homey API whose fixtures follow real Homey Pro (2023) responses (card ids and `args.flow` shape checked on Lars's Homey): tree, chain, navigation, filters, the Flows-tab jump, 1400 px and 390 px (no horizontal scroll), and the visible text of every tab in all four languages.
- Not tested against a real Homey through the OAuth login. The `getFlowFolders()` shape follows `apps/dashboard/shared/src/homey-client.ts` and was not checked live.

### Follow-ups
- Folder order is natural-sort alphabetical; a custom Homey folder order is not used.
- The "cannot be started from another flow" hint relies on Homey's `triggerable` flag, whose meaning is inferred from live data.
- Remove existing AI attribution from earlier PRs, comments and commits (separate task).

## 2026-09-30 — Circadian Light Group editors keep unknown lux sensors

### Requested
- Follow-up to #54: when a saved lux sensor is not in the `get_lux_sensors` list, the pair and repair editors showed "Select lux sensor..." and Save/Create wrote `sensorDeviceId: null`. The device then stopped watching the sensor, and the lux anchor quietly used its fallback time. This happens when the sensor was deleted, or when `getLuxSensors` returns `[]` because `homey.app.api` is not ready yet.
- Lars chose to give the outdoor lux sensor select (repair editor only; the pair editor has none) the same fix.

### Implemented
- New `unknownSensorOption(sensorId)` in both editors: when a saved id is not in `sensors`, it adds a selected option that carries the id, labelled "Unknown sensor (<id>)", right after "Select lux sensor...". The id is HTML-escaped. It adds nothing for an empty id or a listed sensor.
- Used for the lux anchor sensor selects in `renderAnchors()` (pair and repair) and for `#lux-sensor` in the repair editor's `renderOutdoor()`. `collect()` is unchanged; it now reads the kept id back. Users can still pick a listed sensor or clear it to "Select lux sensor..." (saves null).
- New locale key `pair.circadian_light_group.unknown_lux_sensor` in all 11 locales ("Ukjent sensor" in Norwegian; other languages in English, like the other Circadian editor strings).
- `CircadianLightGroupEditors.test.js`: the function extractor is shared, and three tests per editor cover `unknownSensorOption` (missing id kept and translated, markup escaped, no option for listed or empty ids).
- Not changed: the repair editor still builds the listed sensor options without `esc()` (pre-existing; the pair editor escapes them). `pair/repair_configuration.html` (unused copy, not referenced by `driver.compose.json`) was left untouched.

### Verification
- `npx jest --runInBand`: 23 suites and 358 tests passed.
- Playwright (Chromium, 1.55) with a stubbed `window.Homey` (`__` backed by `locales/no.json` or key passthrough, `setTitle`, `on`, `alert`, `done`, `createDevice`, and `emit` for `get_config`, `get_generated_json`, `get_light_candidates`, `get_lux_sensors`, `save_config`, `create_device`). All 11 checks passed; against the `origin/main` editors 8 of the 10 editor checks failed (the two "listed sensor" checks already passed):
  - Repair, `get_lux_sensors` returns `[]` while `get_config` has lux anchors with `sensor-x`/`sensor-y` and outdoor `sensor-outdoor`: the selects show "Ukjent sensor (sensor-x)" and Save keeps all three ids; the whole config (with `_meta`, a solar anchor and a device) is saved unchanged. Also passes when `get_lux_sensors` fails (English label "Unknown sensor (sensor-x)").
  - Repair: listed sensors are preselected with no extra option; picking a listed sensor or "Select lux sensor..." replaces the unknown id; changing another anchor's mode and switching provider (both re-render) keeps the ids; the outdoor id is kept while another provider hides the select; an id containing markup is escaped (no injected element) and saved unchanged.
  - Pair: `get_lux_sensors` `[]` → Create keeps `sensor-x`/`sensor-y` and the whole config; listed sensors get no extra option.
  - `docs/tools/clg-editor.html` (companion tool per the repo conventions): the config with sensor ids round-trips unchanged. It does not edit sensor ids, so no change was needed; the config schema did not change.
- Not tested on a real Homey.

## 2026-09-30 — Circadian Light Group editors keep lux anchors

### Requested
- Fix the pair (`pair/edit_configuration.html`) and repair (`repair/repair_configuration.html`) editors, whose `normalizeAnchor` only knew `time` and `solar` anchors and replaced lux anchors with the default time anchor.

### Implemented
- Added a `lux` branch to `normalizeAnchor` in both editors, matching `lib/CircadianProfile.js`: `sensorDeviceId` (or null), numeric `threshold` (default 100), `direction` only when `rising`/`falling` (otherwise null), and `fallbackTime` (default from the fallback anchor's time or `07:00`).
- `collect()` no longer copies the hidden row `time` input into solar and lux anchors. It used to add a stray `time` key (`07:00` for lux), and switching a lux anchor back to time picked up that stale value instead of the lux fallback time. The device ignores `time` on solar/lux anchors (`mergeProfile` drops it), so runtime behaviour is unchanged.
- `collect()` writes `sensorDeviceId: null` instead of `""` when no sensor is chosen, matching the device normalization.
- The lux threshold field now shows a stored threshold of 0 instead of replacing it with 100 (`anchor.threshold || 100`), so a "fully dark" night anchor survives load → save.
- Added `CircadianLightGroupEditors.test.js`: extracts `normalizeAnchor` from both editors and checks it against the device's `mergeProfile` for lux, solar, time, legacy string, and unknown-mode anchors. The three lux cases fail against the previous editors in both files.
- Left `pair/repair_configuration.html` untouched; it is an unused copy that `driver.compose.json` does not reference.

### Observed before the fix
- Loading a config with lux anchors in either editor showed them as default time anchors, and Save/Create then wrote 07:00/19:00 time anchors.
- Switching an anchor to lux and pressing Save kept the lux fields, because `collect()` re-reads them from the DOM after `ensureConfig()` resets the anchor, but it added `time: "07:00"`. The next time repair was opened, the anchor was reset to the default time, and the following Save persisted that.

### Verification
- `npx jest --runInBand`: 23 suites and 352 tests passed (after merging #53).
- Playwright (Chromium) with a stubbed `window.Homey` (`__`, `setTitle`, `on`, `alert`, `done`, `createDevice`, and `emit` for `get_config`, `get_generated_json`, `get_light_candidates`, `get_lux_sensors`, `save_config`, `create_device`). All 11 checks passed after the fix; 9 failed before it (the time → lux carry-over and the clg-editor round-trip already worked):
  - Repair: a config with two lux anchors, a solar anchor, a time anchor, and `_meta` survives load → Save unchanged, with and without the optional morning profile from #53; sensors are preselected.
  - Repair: switching time anchors to lux (with an unsaved time edit carried over as the fallback), then changing another anchor's mode, then Save keeps both lux anchors exactly; a lux anchor with no sensor saves `sensorDeviceId: null`; lux → time uses the lux fallback time; threshold 0 survives.
  - Pair: switching an anchor to lux and pressing Create keeps it; generated lux anchors survive load → Create unchanged.
  - `docs/tools/clg-editor.html` (companion tool per the repo conventions): the lux config round-trips unchanged. No change needed there, and the config schema did not change.

### Follow-ups
- If a lux anchor's sensor is missing from `get_lux_sensors` (device deleted or the lookup failed), the sensor select falls back to "Select lux sensor..." and Save writes `sensorDeviceId: null`. The outdoor lux sensor select has the same existing behaviour; not changed here.

## 2026-09-30 — Circadian Light Group: local time zone and optional morning profile

### Requested
- Fix the Circadian Light Group schedule running in UTC (lights very dim in the morning), reported repeatedly by Lars.
- Add a backward-compatible morning light profile, following a user suggestion (Mark Ellis). The suggested extra "watershed" phase between evening and night was declined; it can be scripted.

### Implemented
- Homey runs SDK3 apps with `TZ=UTC`, and the scheduler used `Date#getHours()`, so time anchors ran 2 h late in Norwegian summer time (1 h in winter). With the default profile the lights stayed at 8 % red until 09:00 local and reached day values at 12:00. New `lib/LocalTime.js` reads wall-clock time in `this.homey.clock.getTimezone()` via `Intl`, with the previous process-clock behaviour as fallback.
- Time zone applied to time anchors, solar anchor minutes, lux anchor crossing date/minutes (`AnchorResolver`, `CircadianProfile`) and the "Pause until time" Flow card. Solar anchors already matched the sun and are unchanged.
- Astronomical outdoor lux (default provider, also the MET.no base) treated the UTC clock as solar time, ignoring longitude: about 1 h off in Norway and 5–8 h in the Americas. It now uses `SunCalc.getPosition` with the Homey location.
- Optional `profile.morning` (`dim`, `temperature`; missing fields use night values). Without it the curve and phase names are exactly as before. With it, morning values apply from the Morning anchor, fade into Day, and the group reports a `morning` phase until halfway to Day.
- Pair and repair editors: "Own morning profile" checkbox, off by default; unchecked writes no `morning` block. `clg_is_in_phase` has a Morning option; `clg_phase_changed` hint updated. Locale keys added (Norwegian translated, other languages English like the other Circadian editor strings).
- `docs/tools/clg-editor.html`: morning checkbox and fields, and unknown top-level keys are now kept on round-trip. Defaults still match `createDefaultConfig`, which has no morning block. Guide, README and the Homey Community listing mention the morning profile; the guide's "strong white light starts at 8 sharp" example was wrong and is corrected.

### Behaviour changes to call out at release
- Every time anchor now fires at local time. Users who moved anchors earlier to compensate must move them back.
- On the update day only, a lux crossing already stored with the old UTC date/minutes can be ignored or read up to 2 h early.

### Verification
- `npx jest --runInBand`: 22 suites and 338 tests passed. The 11 new time-zone/morning/astronomical tests fail against the previous code.
- `npm run test:package` (with `app.json` seeded from `.homeycompose/app.json`): publish-level validation passed.
- Playwright/Chromium with a stubbed `Homey`: the repair and pair editors produce output identical to the previous editors when the morning profile is off; enabling, editing, preserving (partial block plus unknown keys) and removing the morning block work; `clg-editor.html` round-trips configs with lux anchors, unknown top-level keys and a morning block.
- Not tested on a real Homey.

### Not changed
- The pair/repair editors still drop lux anchors on load/save (`normalizeAnchor` has no `lux` branch); pre-existing and outside this change.
- `drivers/circadian-light-group/pair/repair_configuration.html` is not referenced by the driver manifest and was left untouched.

## 2026-09-29 — Remove the dormant homey-api subscription wrapper

### Requested
- Remove the shared-subscription wrapper from #44 now that v1.10.31 with homey-api 3.20.0 is installed and verified on the configured Homey.

### Implemented
- Removed `shareHomeyApiSubscriptions` and its call in `configureHomeyApi` (app.js). homey-api 3.20's `SubscriptionRegistry` shares one server subscription per URI and restores it after reconnects; the wrapper had already been inactive on 3.20.
- The Logic Device health refresh (`reconcileLinkedInput`) no longer has a resubscribe/re-read branch; it replays a missed value from the snapshot it already read, and still never overwrites a newer realtime event or a first-impression-locked input.
- Removed the wrapper tests that ran against an in-test model of homey-api 3.17 and the resubscribe-specific Logic Device tests. Kept the tests against the installed library: homey-api is 3.20 or newer, `configureHomeyApi` leaves the registry's `subscribe` untouched, and destroying one Device object keeps another consumer of the same device subscribed.
- Checked that 3.20 dispatches realtime events to consumers without per-consumer error isolation: every app capability listener is async or wraps its async work with `.catch`, so a failing handler cannot throw synchronously into the socket event.
- `homey-api` stays pinned to exactly 3.20.0; a downgrade below 3.20 would bring back the #44 subscription problems, and the version test guards against it.

### Verification
- `npm test -- --runInBand`: 22 suites and 323 tests passed.
- `npm run test:package`: publish-level validation passed.

## 2026-09-29 — Test release v1.10.31

### Requested
- Release the homey-api 3.20.0 upgrade (PR #50) as a new test version after live testing, and investigate why "All on" appeared to give much less light from all-off than after "All on (flood)".

### Implemented
- Bumped the app to 1.10.31 with English and Norwegian changelog text; updated CHANGELOG.md, the README test badge and summary, and the Homey Community listing source.

### Verification
- Live test of the homey-api 3.20.0 build (`homey app run --remote`, Lars's New Homey): clean startup; the 55 s in-card gate guard fired and took the error path; a background gate GO after 65 s fired `conditional_gate_wait_finished`; a background capability wait matched after 81.8 s through the 3.20 `SubscriptionRegistry`.
- "All on" investigation with debug logging, "All off" → "All on" and "All off" → "All on (flood)" → "All on": both paths ended with every reachable Circadian Light Group member at the same target (main group 62 %, bedroom group 9 % by design), confirmed by a device snapshot. Remaining differences were hardware or configuration: "Soverom: Nattbord v" unplugged, "Vindfang 1/2" underpowered (unavailable), "Kjøkken: Led h" unreachable, "Smart Energy Illuminator" Z-Wave `TRANSMIT_COMPLETE_NO_ACK` for dim writes, and "Bad: Vegglys" only switched by the flood flow. The earlier "much more light after flood" was most likely the pre-1.10.30 subscription bug, where member on/off watchers lost realtime updates and turn-on acknowledgement/target writes misbehaved.
- In the user's Flow "All on (by time)", the solar/time branches are not connected to the start card, so "All on" always runs only "All on - Toolbox"; reported to the user, not changed (user-owned Flow).

## 2026-09-29 — homey-api 3.20.0 upgrade

### Requested
- Upgrade `homey-api` from 3.17.0 to 3.20.0, keep the #44 shared-subscription wrapper as a dormant safety net, and make its tests independent of the installed library.

### Implemented
- Pinned `homey-api` 3.20.0 (`--save-exact`). New transitive packages: `jsonwebtoken` and its `jws`/`jwa`/`lodash.*`/`semver`/`safe-buffer` dependencies (loaded eagerly through `homey-api`'s index). Socket.IO stays at 2.5.0 and the `socket.io-parser` 3.3.6 override still applies; `npm audit --omit=dev` reports the same four moderate Socket.IO 2.x findings as before and no high findings. Updated the accepted-risk note in SECURITY.md.
- 3.20.0 shares one server subscription per URI through `SubscriptionRegistry`, removes the per-subscribe `once("disconnect")` listener, and moves Item/Manager realtime handling into `RealtimeConsumer`. `shareHomeyApiSubscriptions` detects `__subscriptionRegistry` and stays inactive, so `__sctResubscribe` is absent and the Logic Device health refresh replays missed values without resubscribing.
- Rewrote the wrapper tests against a self-contained in-test model of the 3.17 realtime behaviour (per-subscribe wire subscription and leaked disconnect listener, URI-wide server unsubscribe, reconnect re-subscription, no registry); all fourteen scenarios keep their assertions and still fail without the wrapper.
- Added tests against the installed library: version check, the wrapper stays inactive on a real `HomeyAPIV3Local`, and with the real 3.20 `SubscriptionRegistry`, Item, Device, and DeviceCapability code, destroying one Device object keeps another consumer of the same device subscribed. Added Logic Device tests for the health-refresh replay without a resubscribe hook.

### Compatibility review (3.17 → 3.20)
- Unchanged: `createAppAPI`, `HomeyAPIV3Local`, `ManagerDevices` (including `scheduleRefresh`), `Device` (`makeCapabilityInstance`, deprecated `driverUri`/`zoneName` getters, `driverId`), and `EventEmitter`. Manager caching still only applies to connected managers, which the app never connects, so `getDevice()`/`getDevices()` stay uncached.
- Changed but compatible: Item `connect()`/`disconnect()` now use `RealtimeConsumer` (the app never calls them directly or reads `io`/`__homeySocket`); device namespace `update` events now update the Device object and `delete` events destroy it (capability instances are destroyed as before); `DeviceCapability.lastChanged` is null for events without a transaction time (Composite Device already falls back to the current time); API calls fall back to HTTP while the socket session is not ready.
- Node.js: 3.20.0 declares `engines.node >=22`; a scan found nothing newer than Node.js 16 (`??=`, `AbortController`, `Promise.any`, `node:` builtins). Homey Pro (Early 2023) runs Node.js 22.

### Verification
- `npm test -- --runInBand`: 22 suites and 343 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 909 files (8.00 MB) and all 17 manifest assets were verified.

### Follow-ups
- Live-tested on the configured Homey before the v1.10.31 release (see the release entry above).
- Remove the dormant wrapper in a later change once 3.20 has proven stable.

## 2026-09-29 — Test release v1.10.30

### Requested
- Ship the fixes for #44 (app resets) and #46 (Conditional Gate 60 s timeout) after review approval and live testing on the configured Homey, with a descriptive changelog that links the changed guides.

### Implemented
- Merged PR #48 (#44) and PR #47 (#46) after review found no major issues on their final commits.
- Bumped the app to 1.10.30 (manifest, package files) with English and Norwegian changelog text linking the Conditional Gates and Waiter Gates guides; updated CHANGELOG.md, the README test badge and summary, and the Homey Community listing source.

### Verification
- Live test before merge (combined #47 + #48 build, `homey app run --remote` on Lars's New Homey): clean startup without errors or `driverUri` warnings; the 55 s in-card guard, background gate GO after 65 s and background capability MATCHED after 81.6 s all behaved as specified; diagnostics showed warning locations, memory samples and unredacted driver ids, and that the Homey SDK already installs one `unhandledRejection` and one `uncaughtException` handler.

## 2026-09-29 — Issue #44: app keeps resetting

### Requested
- Fix GitHub issue #44 (v1.10.28/1.10.29, 24 Logic Devices and one Composite Device; the app restarts repeatedly, Homey crash count 8 → 12 in two days, no crash message).
- Remove the stale `formula_result_is_ld` registration, add a regression test for Flow card ids, hunt for crash vectors, and make the next diagnostic report useful without exposing labels.
- Follow-up evidence: `Device.driverUri is deprecated` floods stderr; a Logic Device that uses another Logic Device as input stops reacting after an app restart; Logic Devices randomly stop until the app is restarted; startup takes about 30 seconds.

### Findings
- Most likely restart cause (medium-high confidence): memory growth until Homey terminates the process, which leaves no JavaScript stack or crash message. homey-api 3.17.0 `subscribe()` leaves a `once("disconnect")` listener on the socket for every subscription, and that listener retains the whole HomeyAPI Device object. Every `getDevice()` returns a new Device object, so the five-minute Logic Device listener health refresh added in 1.10.26/1.10.27 created one new subscription per linked input per cycle. A local reproduction with the real homey-api code retained about 10 KB per refresh (7.6 MB per hour for 60 links, 30 MB after four hours). Waiters and Circadian Light Group temporary listeners add further subscriptions.
- The same library version sends a server-side `unsubscribe` for the device URI whenever any Device object disconnects. A finished waiter, a reconfigured or deleted Logic Device, or a temporary Circadian listener therefore silently stopped realtime updates for every other consumer of that device until the next health refresh. This matches Logic Devices that randomly stop reacting and groups that use other Logic Device groups (typical waiter targets). homey-api 3.20.0 fixed both issues with a shared subscription registry.
- `Device.driverUri` is a deprecated getter that always returns undefined and writes a warning. The device registry refresh read it for every Homey device at startup and every six hours; state-device and state-capture-device candidate filters, the Logic Device input picker driver name, and Circadian driver references also read it. With homey-api 3.x the Logic Device exclusion in the input picker never matched, so chaining Logic Devices has been available and is used; it was kept selectable.
- The startup `formula_result_is_ld` error is caused by a card whose definition was removed in December 2025 but whose registration was re-added in 1.10.20.
- A Logic Device formula with a timeout but without an expression threw `TypeError` inside the one-second timeout interval, which terminates the process.
- Logic Devices wrote `alarm_generic` even when the result was unchanged; every write emits a realtime event, so mutually linked Logic Devices could re-trigger each other indefinitely.
- Startup (not changed): the app awaits the device registry refresh before drivers start, and each Logic Device performs two sequential `getDevice()` calls per linked input.
- Waiter timeout warnings in the reporter's log are normal behaviour and are not crash signals.

### Implemented
- Removed the `formula_result_is_ld` condition registration and the dangling `driver.compose.json` reference; "Device alarm is..." remains the Logic Device result condition.
- Added `FlowCardDefinitions.test.js`, which statically resolves literal, looped, ternary, helper, and forwarded Flow card ids in `app.js`, `lib/`, and every driver file and checks them and driver Compose `flow` declarations against `.homeycompose/flow` and `driver.flow.compose.json` definitions.
- Shared one realtime subscription per URI between all HomeyAPI Device objects (`configureHomeyApi`), so replacing or removing one listener never removes another consumer's subscription and periodic listener replacement no longer creates subscriptions. The wrapper is skipped when homey-api provides its own registry (3.20+). Listener exceptions are logged instead of escaping from the socket handler.
- The Logic Device health refresh now compares each freshly fetched linked value with the cached input; a missed update is replayed, logged as a warning, and the shared subscription is recreated. Snapshots older than a received event and first-impression locked inputs are ignored.
- Logic Devices only write `alarm_generic` when the value differs from the current capability value.
- Guarded `parseExpression()` against missing or non-string expressions.
- Replaced every `driverUri` read on HomeyAPI devices with `driverId` (device registry, Logic Device input picker, State Device and State Capture Device candidate filters, Circadian Light Group and collection driver references).
- Diagnostics: persisted warnings and stackless errors now include the app-relative caller location (`file:line`); unhandled promise rejections are recorded and the process is kept alive; uncaught exceptions are observed with `uncaughtExceptionMonitor` (process termination is unchanged) and persisted immediately; a clean-shutdown marker records a warning with the previous session's start, last heartbeat, and uptime when it ended uncleanly; label-free heap/RSS samples are taken every 15 minutes and the report shows current and previous session samples plus the number of pre-existing process error handlers; this app's driver ids and kebab-case code identifiers are no longer redacted.

### Companion tools
- `docs/tools/boolean-editor.html`, `formula-builder.html`, `emulator.html`, and `flow-doctor.html` do not reference `formula_result_is_ld`; no Logic Device settings shape changed. `flow-doctor.html` already reads `driverId` and only uses registry entry names. The State Device filter changes do not affect the stored state JSON used by `state-editor.html` and `state-editor-api.html`.

### Verification
- `npm test -- --runInBand`: 21 suites and 243 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 766 files (7.55 MB) and all 17 manifest assets were verified. The generated manifest no longer contains `formula_result_is_ld`.

### Review follow-up (PR #48)
- Restored the general redaction for long hyphenated values; only this app's exact driver ids (from the bundled `drivers/` directory, plus ids supplied by the app) stay readable, and only in the driver list and code-derived event fields (category, stack, source).
- A shared-subscription consumer whose `onConnect` throws is now removed (and the server subscription released when it was the last consumer) before the error is rethrown.
- The Logic Device health refresh re-checks for a newer realtime event after recreating the subscription, so an event received during the resubscribe is not overwritten by the older snapshot.
- A live `homey app run --remote` on the configured Homey reported one pre-existing `unhandledRejection` and one `uncaughtException` handler, so the Homey SDK installs its own handlers.
- `npm test -- --runInBand`: 21 suites and 246 tests passed.
- Second review round: the health refresh now reads the linked value again after the replacement subscription is active and replays that value, because a change during the unsubscribe/subscribe window produces no event. A failed (re)subscription no longer drops its entry: consumers and their unsubscribe handles are kept, the entry is marked for resubscription and restored on the next subscribe for the URI, on the next health-refresh resubscribe, or by a bounded backoff retry (5 s doubling to 5 min); the socket-reconnect failure path behaves the same. `onUninit` now awaits the clean-shutdown marker write and logs a failure instead of throwing.
- Third review round: shared subscriptions are serialized per URI. When the last consumer leaves while a subscription is still being created, that subscription is unsubscribed as soon as it exists, and a new subscription for the same URI is only created afterwards (also when the pending one fails), so repeated release/recreate cycles leave exactly one live subscription and no leftover URI or socket reconnect/disconnect listeners.

### Follow-ups
- Consider upgrading homey-api to 3.20.x after live testing; the shared-subscription wrapper then becomes inactive automatically.
- Consider not awaiting the startup device registry refresh and reusing the listener fetch for initial Logic Device values to shorten startup.
- Oscillating Logic Device cycles (for example A = NOT B and B = A) still loop through Homey by design of the configuration; no automatic cycle breaker was added.
- Verify on a live Homey that memory samples stay flat over several hours.

## 2026-09-29 — Long waits beyond Homey's Flow card limit (issue #46)

### Requested
- Fix GitHub issue #46: `Conditional Gate: Wait for GO` with a 2 minute timeout failed with `Error: Timeout after 60000ms` after one minute.
- Root cause: Homey stops every app Flow card run listener after ~60 seconds, but the gate/capability wait conditions and the `wait` action held the card open for the whole configured timeout.
- Approved design: keep in-card waiting for short waits and add a "start + finished trigger" pattern where the app waits in the background.

### Implemented
- Added `WaiterManager.FLOW_CARD_SAFE_WAIT_MS` (55 s). `conditional_gate_start` and `wait_until_becomes_true` now arm a guard when they start waiting; if the card is still pending at 55 s, only that run's own waiter is removed (identity check, so reused waiter IDs are never touched) and the card fails with a translated message pointing to the new cards. Waits that resolve within 55 s, timeouts of 55 s or less, `conditional_gate_start` with timeout 0, and Modify Conditional Gate timeout/state changes behave as before.
- Re-initializing a waiter ID that is still waiting (same Flow run repeating, e.g. `Wait_OSB_Motion`) now settles the superseded card run once through its NO/false path instead of leaving it to Homey's 60 s kill. WaiterManager timers, capability listeners and gate releases only remove the waiter object they belong to.
- The `wait` action rejects durations above 55 s immediately with a message recommending Homey's built-in Flow delay.
- New action `conditional_gate_start_wait` (gate name, default state, timeout 0 = none, max 24 h) and trigger `conditional_gate_wait_finished` (tokens `opened`, `result` GO/TIMEOUT, `waited_seconds`). Already-GO gates fire immediately; starting again for the same gate restarts the wait (`gate_<name>_background`) without firing the replaced one; Modify Conditional Gate state/timeout changes apply to background waits.
- New action `wait_until_start` (same args as the capability condition) and trigger `wait_until_finished` (tokens `matched`, `result` MATCHED/TIMEOUT, `value`, `waited_seconds`), with per-Waiter-ID restart semantics. `control_waiter` enable/disable/stop works on background waits; stopping never fires the trigger.
- Gate/waiter autocomplete discovery now includes the new card IDs and standard-flow triggers. The existing capability/device/waiter-ID and control-waiter autocomplete listeners are shared with the new cards.
- Flow card hints (12 languages) mention the 60 s limit; new `errors.flow_card_wait_limit_*` locale strings (11 locales). New `conditional_gate_start` cards default to a 30 s timeout instead of 60 s.
- Updated README, store README, Homey Community listing, project documentation, and the Conditional Gates, Waiter Gates, Flow Cards, State Capture Device and index pages, including the reporter's scenario as an Advanced Flow example and the in-memory/app-restart limitation. `docs/tools/*.html` contain no hard-coded card ID lists (Flow Doctor reads card definitions from the Homey API), so no tool changes were needed.
- First PR #47 review follow-up: disabled waiters stay waiting until re-enabled (held timeouts, remembered matching values and gate changes complete on enable; disabled waiters never trigger, not even when reaped), the capability is re-read after the listener is installed, and the 55 s guard counts from the start of the card run.
- PR #47 review follow-up: overlapping `wait_until_start` runs with the same Waiter ID re-apply restart semantics after the device lookup (the immediate MATCHED path now replaces a background wait another run installed meanwhile, and a replaced run never attaches its listener to the successor). In-card configured timeouts now count from the start of the card run like the guard, so a timeout at or below 55 s always ends on the NO path (already elapsed during setup = NO right away); Modify Conditional Gate still sets timeouts from now.
- Second PR #47 review follow-up: `wait_until_start` takes a per-Waiter-ID start token before any await, so an older start whose device lookup finishes later never replaces, installs or fires anything once a newer start has begun. Background waiters record their kind (gate/capability); a start only restarts a waiter of the same kind and otherwise fails with a clear error, leaving the other wait untouched. The device lookup counts against the `wait_until_start` timeout (already elapsed = TIMEOUT right away unless the value matches; 0 still means no timeout), and `waited_seconds` counts from when the card ran.
- Third PR #47 review follow-up: `wait_until_start` validates, takes its start token, creates the waiter (timeout from the card start) and returns at once; listener installation and the initial value read run in a detached, token-checked task, so a stalled Homey API can no longer hit the 60 s card limit. Both capability waits now install the listener before reading the current value, so a target pulse during setup is caught; a match found by that read fires through the normal once-only path with `waited_seconds` measured from the card start. `updateWaiter()` clamps Modify Conditional Gate timeouts to 24 h (0 still means no timeout).

### Verification
- `npm test -- --runInBand`: 20 suites and 251 tests passed (new `LongWaitFlowCards.test.js` plus WaiterManager re-initialization, identity and background-waiter tests); after the first PR #47 review fixes 20 suites and 272 tests passed; after the second 20 suites and 283 tests passed; after the third 20 suites and 290 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 766 files (7.60 MB) and all 17 manifest assets were verified.

### Follow-ups
- Live test on Lars's Homey Pro (combined #47 + #48 build via `homey app run --remote`): in-card `conditional_gate_start` (2 min) ended through its error output exactly 55 s after the run started; `conditional_gate_start_wait` + GO after 65 s fired `conditional_gate_wait_finished` (opened, GO, 65 s) and the trigger Flow ran; `wait_until_start` matched after 81.6 s and `wait_until_finished` fired MATCHED. Temporary test Flows were disabled afterwards.
- Known limitation: gate states and pending waits are in memory and are lost on app restart; a pending background wait then never fires its trigger.
- CHANGELOG / `.homeychangelog.json` / version bump left for the release step.

## 2026-09-07 — Diagnostic resource fallback v1.10.29

### Requested
- Fix the App Settings diagnostic report after a user received `ENOENT: no such file or directory, uv_resident_set_memory`.
- Publish the fix as a new Homey draft release.

### Implemented
- Made Node.js process-memory and operating-system resource probes best effort so unavailable platform metrics cannot abort report generation.
- Wrapped Homey API resource calls so both synchronous exceptions and rejected promises degrade to unavailable values.
- Ensured missing or incomplete load averages are rendered explicitly as unavailable.
- Added regression coverage for the reported process-memory failure and unavailable Homey resource endpoints.
- Prepared the v1.10.29 patch-release metadata and Community post source.

### Verification
- `npm test -- --runInBand`: 19 suites and 210 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 766 files (7.51 MB) and all 17 manifest assets were verified.

## 2026-09-06 — GitHub diagnostic reports and test release v1.10.28

### Requested
- Add a way for users to submit a diagnostic report directly to GitHub Issues.
- Include available device/app CPU, memory, storage and Circadian Light Group load information.
- Prepare a reviewed PR, merge it when green, upload a Homey test build, install it on the configured Homey, and update the Community post source.

### Implemented
- Added a private App Settings diagnostics endpoint and UI for generating, previewing, copying, and opening a prefilled GitHub issue without embedding GitHub credentials.
- Added bounded persistence of recent warnings/errors with stack traces and redaction of common device IDs, email/IP values, credentials, and long token-like values.
- Reduced persisted logger events to label-free messages and stack frames so user-defined device, room, waiter, and formula labels are not copied into public issue drafts.
- Added anonymous per-driver device counts, configuration-alarm counts, Circadian Light Group member/watcher/update-interval details, process and Homey-reported memory, system load averages, app CPU metric, and Homey storage totals when exposed by the platform.
- Aligned the runtime startup banner and npm package metadata with Homey app version 1.10.28.
- Updated README, Store README, changelog, project documentation, and Homey Community post source.

### Verification
- JavaScript syntax and changed locale/manifest JSON parsing passed.
- `npm test -- --runInBand`: 19 suites and 209 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 766 files (7.51 MB) and all 17 manifest assets were verified.
- `homey app run --remote`: v1.10.28 initialized successfully with the correct version banner and remained running without an app restart during the smoke-test window.
- GitHub review found six issues across two passes; all findings were addressed with regression coverage before merge. Homey upload/install and the final release result are recorded below when completed.

## 2026-09-05 — Test release v1.10.27

### Requested
- Publish the latest test version, update the Homey Community post, and install the newest version locally.

### Implemented
- Prepared the v1.10.27 release notes for serialized Logic Device evaluations, reduced Logic Unit logging, and the leaner validated app bundle.
- Updated the repository README, changelog, Homey changelog, and Community-listing source for the new test version.
- Uploaded Homey Build 56 as version 1.10.27; the user published it to the test channel.
- Posted the v1.10.27 release announcement to the existing Homey Community topic.

### Verification
- `npm test -- --runInBand`: 14 suites and 197 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 764 files (8.16 MB) and all 17 manifest assets were verified.
- `homey app install`: version 1.10.27 installed successfully on the configured Homey Pro.

## 2026-08-11 — Composite Device and Logic Unit documentation

### Requested
- Add a universal Homey device that combines the same capability from multiple devices.
- Support humidity min/max and broader numeric, boolean/alarm, text, enum, and clock-time use cases.
- Verify and improve the published Logic Unit usage documentation.
- Create the Composite Device image assets and publish the app.

### Implemented
- Added the `composite-device` driver with a visual capability, operation, source-device, and name pairing page.
- Added `CompositeAggregator.js` with numeric average/min/max/sum/median; boolean any/all/majority/count/percentage; text/enum mode/min/max/newest; and circular average clock time.
- Added dynamic numeric, alarm, and text capabilities plus realtime source listeners, partial-source error reporting, periodic reconnection, and listener cleanup.
- Added unit/device/driver tests and retained the pending Logic Device restart and Circadian Light Group member-verification fixes already present in the worktree.
- Added a Composite Device guide, updated the device overview and README, and added existing Logic Unit settings/Flow screenshots to the published documentation.
- Reworked the supplied Composite Device raster into a transparent master and derived 500 × 500 and 75 × 75 Homey assets; verified the enclosed background gaps between pins are transparent.

### Verification
- `npm test -- --runInBand`: 7 suites, 133 tests passed.
- `homey app validate`: passed at publish level.
- `homey app run --remote`: installed and initialized successfully on the configured Homey Pro; the Composite Device driver initialized without errors.

### Release
- Published Homey Build 49 as version 1.10.20 in the test channel.
- Installed version 1.10.20 on the configured Homey Pro after the remote development run.
- Committed the implementation and documentation for GitHub publication.

## 2026-08-11 — Composite Device listing and small image refresh

### Requested
- Replace the generated Composite Device small asset with the supplied final `small.png`.
- Publish a new Homey test version and update GitHub, the community listing source, and online documentation.

### Implemented
- Replaced the 75 × 75 Composite Device driver image with the supplied final image.
- Replaced the partial Homey Store README with a complete overview of all current and legacy devices plus every standalone Flow-card family.
- Added Composite Device to the Homey Store description and updated the community listing source.
- Updated the README, changelog, Composite Device guide, device overview, and version badges for v1.10.21.

### Verification
- `npm test -- --runInBand`: 7 suites, 133 tests passed.
- `homey app validate`: passed at publish level after the final Store README update.
- Source and runtime `small.png` files have identical SHA-256 hashes and are 75 × 75 RGBA PNGs.
- Changed documentation pages passed local-link checks and all edited JSON files parsed successfully.

### Release
- Uploaded Homey Build 50 as v1.10.21 and published it to the test channel.
- Confirmed in Homey Developer Tools that the test submission contains the complete Store README and updated Composite Device image.
- Installed v1.10.21 successfully on the configured Homey Pro.
- Prepared the v1.10.21 release commit with the documentation, community listing source, and image assets required for GitHub Pages.

## 2026-08-11 — Composite Device value-change Flow triggers

### Requested
- Add a Composite Device trigger that fires whenever the exposed value changes.
- Add a second trigger that fires only when a numeric change is larger than a user-selected fixed or percentage threshold.

### Implemented
- Added the device trigger `composite_value_changed` for numeric, boolean/alarm, and text/clock outputs, with current value, previous value, value type, and device-name tags.
- Added `composite_value_changed_larger_than` for numeric Composite Devices, with per-Flow fixed-unit or percentage thresholds and current, previous, signed-change, absolute-change, and percentage-change tags.
- Suppressed both triggers for the first successful aggregate after app/device startup so initialization only establishes the comparison baseline.
- Defined percentage change against the absolute previous value; zero-to-nonzero transitions are represented as 100%, and thresholds compare consecutive values rather than accumulating smaller changes.
- Isolated Flow trigger failures from aggregate capability updates and source-error reporting.
- Updated the Composite Device guide, Flow-card reference, project documentation, Store README, root README, and changelog.

### Verification
- `npm test -- --runInBand`: 7 suites, 136 tests passed.
- `homey app validate`: passed at publish level with both new trigger cards included.
- JavaScript syntax, Flow-card JSON parsing, local documentation links, and `git diff --check` passed.

### Release
- Implemented and validated locally; no new version was published in this session.

## 2026-08-11 — Composite Device trigger release v1.10.22

### Requested
- Publish the Composite Device value-change triggers as a new Homey test version and install it locally.
- Update `HOMEY_COMMUNITY_LISTING.md`, push the release to GitHub, and leave `main` in the merged release state.

### Implemented
- Versioned the app and documentation as v1.10.22 and added the two new Composite Device triggers to the app changelog.
- Updated the community listing source, Store README, root README, device guide, Flow-card reference, and version labels for the test release.

### Verification
- `npm test -- --runInBand`: 7 suites, 136 tests passed.
- Homey publish validation passed and included both Composite Device trigger cards.
- Homey Developer Tools confirmed Build 51 as v1.10.22 with the updated changelog and Store README.

### Release
- Uploaded Homey Build 51 as v1.10.22 and published it to the test channel.
- Installed v1.10.22 successfully on `Lars's New Homey` after debug-level validation.
- Prepared the v1.10.22 source, documentation, and community listing update for the GitHub release commit.

## 2026-08-12 — Logic Unit generic-alarm trigger diagnosis

### Requested
- Determine whether a Logic Unit using `A+B` should trigger Homey's generic-alarm-turned-on card after an input is set to TRUE, or whether the wrong Flow card was used.

### Findings
- Confirmed that `+` is a supported OR operator, so either A or B being TRUE makes `A+B` TRUE once both required inputs have values.
- Confirmed that the current Logic Unit evaluator stores the formula result but never writes the aggregate result to `alarm_generic`; even the aggregate state calculated during full reevaluation is unused.
- Confirmed that published documentation defines `alarm_generic` as the formula result and that the older backup implementation updated it, identifying this as a Logic Unit regression rather than user misuse.
- Found a second inconsistency in the formula-specific trigger path: the evaluator triggers undeclared device-card IDs while the registered combined card has a different app-trigger ID. It should therefore not be presented as a reliable workaround until fixed.
- The generic alarm card should work according to the exposed capability contract; for multiple formulas, its intended state is the aggregate OR result (TRUE when any enabled formula is TRUE).

### Verification
- `npm test -- --runTestsByPath FormulaEvaluator.test.js --runInBand`: 1 suite, 52 tests passed, including `A + B` tokenization and evaluation coverage.
- No production code was changed during this diagnostic session.

## 2026-08-12 — Logic Unit formula-change Flow cards and alarm fix

### Requested
- Add a new **Formula changed to...** card and repair the **Formula changed** behavior.

### Implemented
- Added a formula-specific **Formula changed** trigger for every TRUE/FALSE transition and repaired **Formula changed to...** with correct device-trigger registration, formula matching, and result filtering.
- Added current and previous boolean result tokens to both cards.
- Restored the original pre-Compose TRUE/FALSE trigger IDs as deprecated compatibility cards and retained the newer deprecated aliases.
- Synchronized `alarm_generic` with the aggregate Logic Unit result, defined as TRUE whenever any enabled formula is TRUE, so Homey's standard alarm turned on/off cards work again.
- Renamed the Dynamic Logic Unit capability from the generic Homey label to **Formula result** and updated Flow-card/device documentation.

### Verification
- Added Logic Unit regression tests covering `A+B`, aggregate alarm behavior, trigger payloads, selected-formula filtering, and TRUE/FALSE result filtering.
- Focused test run: 2 suites and 55 tests passed.
- Full test run: 8 suites and 139 tests passed.
- All changed Flow-card and driver Compose JSON parsed successfully; changed JavaScript files passed `node --check`.
- `homey app validate` passed at publish level with both current cards and all compatibility IDs included for every Logic Unit driver.

## 2026-08-12 — Logic Unit fix release v1.10.23

### Requested
- Publish and install the Logic Unit fix, update GitHub, and update the existing Homey Community topic.

### Implemented
- Versioned the Homey app and release documentation as v1.10.23.
- Added the Logic Unit alarm and formula-trigger fixes to the Homey changelog, repository changelog, README, documentation version badges, and community-listing source.

### Verification
- `npm test -- --runInBand`: 8 suites, 139 tests passed.
- `homey app validate`: passed at publish level.
- Homey Developer Tools confirmed Build 52 as v1.10.23 and showed both `Formula changed` and `Formula changed to...` in the submitted manifest.

### Release
- Uploaded Homey Build 52 and published v1.10.23 to the test channel.
- Installed the app successfully on `Lars's New Homey` with `homey app install`.
- Updated and verified the existing Homey Community topic with the v1.10.23 title and release notes.

## 2026-09-06 — 30-second restart/reset diagnosis

### Requested
- Investigate a user report that the app resets itself every 30 seconds by running the app remotely over time.
- Determine what diagnostics the user can submit and whether the app should expose stack traces or additional logs.

### Findings
- Ran `homey app run --remote` for approximately 5 minutes and 16 seconds. The app completed one initialization and remained running through more than ten reported 30-second windows without a restart, repeated `onInit`, unhandled rejection, fatal error, or memory/heap error.
- The only runtime errors were handled Homey API failures for unavailable Z-Wave devices (`TRANSMIT_COMPLETE_NO_ACK` and `This device is currently unavailable`) during Circadian Light Group updates. The retry path completed without terminating the app.
- Found a stronger explanation if "reset" means that light values are restored: Circadian Light Group reapplies its target on a configurable scheduler whose hard minimum is exactly 30 seconds. The local configuration uses 120 seconds, and the remote log showed normal `apply[timer]` cycles at that interval without app reinitialization.
- Reviewed five earlier long-running remote logs. Each contained exactly one startup banner and one completed initialization, with no app uninitialization or fatal/unhandled/heap markers. The longest session logged activity continuously for almost three days.
- Confirmed that the app already logs stack traces when a real `Error` object reaches `Logger.error`, but it has no user-downloadable persistent ring buffer or diagnostic snapshot. The startup banner currently reads the stale package version (1.10.25) while the generated/Compose manifest is 1.10.27, which can confuse incident reports.
- Homey's built-in app management offers **Send diagnostics to developer**; a separate Homey system diagnostics report can also be created for Homey Support.

### Recommendation
- First ask the reporter whether the app itself shows a crash/restart or whether controlled device values revert, and whether a Circadian Light Group is configured with a 30-second update interval.
- Ask the user to enable the app's Debug Mode, reproduce the issue, immediately send app diagnostics, and include the exact local time, app version, affected device/group, and what visibly resets.
- Add a bounded in-memory diagnostic ring buffer and a redacted downloadable diagnostic snapshot with startup/session ID, manifest version, uptime, last scheduler operations, last errors with stacks, and lightweight memory counters. Do not rely on global `uncaughtException` handlers to keep a damaged process alive.

### Verification
- Current remote observation: one startup, normal 120-second scheduler cycles, no restart or fatal process signal.
- Historical log scan: five sessions, one initialization per session, zero fatal/unhandled/heap markers.
- No production code was changed during this diagnostic session.
