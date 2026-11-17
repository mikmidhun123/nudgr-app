# Nudgr production hardening and release preparation

**Completed locally:** 2026-10-31 (Asia/Kolkata). **Production release remains held.**

The user approved the hardening phase recommended by `FINAL_WORKFLOW_AUDIT.md`, selected emulators, and requested unsigned artifacts. Authorized implementation and local validation are complete. No production Functions, Firestore rules/indexes or Worker deployment, Git commit, push, signing-key setup or store publication occurred.

## Implemented changes

- Private installation records under `users/{uid}/devices`, owner-only private profiles, safe public profiles, installation-aware token refresh/logout and account generation checks. Modern disabled devices suppress migrated legacy copies; stale Android registrations are disabled daily.
- Authenticated, revocation-checked, rate-limited transactional `connectByCode`. Clients cannot forge canonical connections or mirrors. Invitation codes use native UUID randomness. The dry-run-by-default migration rotates exposed codes to version 2, creates safe profiles/private legacy device records and never automatically verifies old relationships.
- Recoverable delivery with 90-second leases, bounded retries, original five-minute observation expiry, 500-token batches, accepted-token hashes and invalid-token cleanup. Provider acceptance remains separate from per-device `RECEIVED`, `ANSWERED`, `DECLINED` and `MISSED` receipts.
- Rules validate participants, verified peers, payload types/geometry, voice namespaces, activation times and atomic version-2 triggers. Shared events contain hashes instead of raw tokens. Arbitrary legacy voice URL introduction is denied.
- Native incoming account/expiry checks, persistent deduplication, durable cold actions/receipts and restricted lock-screen flags. Normal application windows no longer globally turn on or display over the lock screen.
- Scoped session/listener cleanup and cancelled asynchronous recording/player/ringtone/TTS work. Owner-scoped offline intents retain original deadlines. JobScheduler supports closed-process sender activation. Pause ends at next local midnight; sender-only explicit re-arm preserves cooldown. History separates transport/device outcomes.
- Permission recovery notice, clearer auth errors, high-accuracy foreground location and headless location without settings dialogs. Baseline verification found **no changed existing StyleSheet definitions across all 14 baseline UI files**; seven remain byte-identical (`ui-style-preservation.json`).
- Expo **57.0.31**, RN **0.86.3**, React **19.2.3**, RN Firebase **25.1.0**, TypeScript **6.0.3**, API **36**, Gradle **9.3.1**, Kotlin **2.3.20**, NDK **27.1.12297006**, and a typed Expo Audio adapter replacing AV.
- Unsigned release, bundled debug-signed QA, native artifact verifier, pinned CI actions and isolated startup smoke checks. Crashlytics Java/JS/NDK integration is prepared; collection and symbol uploads are off by default and off in QA/CI.

Device testing fixed two concrete issues: RN Firebase 25 snapshots require `exists()`, and recording UI state had been updated before the asynchronous start result existed, hiding Stop while recording continued. Both have regressions; snapshot checks also have a scoped lint rule. Admin SDK snapshots retain boolean `exists`.

## Artifacts

Version **1.0.1 / code 2**, `com.nudgr`, target/compile API36, minimum API24, release shrinking/minification enabled. The old `app-release.apk` in the release directory is the historical SDK52 build; deliver the unsigned originals below.

| Artifact | Path | Bytes | SHA256 |
|---|---|---:|---|
| Unsigned APK | `Nudgr-V2/android/app/build/outputs/apk/release/app-release-unsigned.apk` | 73074534 | `981bec4972c79a6ceb312548fdd6fa1b212ffe79714869e08cce097a0dfd70d9` |
| Unsigned AAB | `Nudgr-V2/android/app/build/outputs/bundle/release/app-release.aab` | 54984774 | `e8b7002226520bf5927058f9dd65f2d71fb907d7cced333fe77c941051758a72` |
| Device-tested QA APK | `Nudgr-V2/android/app/build/outputs/apk/qa/app-qa.apk` | 147509816 | `a82d6f563f251a381e292007e918e4cbf27d8f4859d8fbc112c087c004b0507a` |

The production APK fails signature verification as expected when unsigned; the AAB has zero JAR signature entries. Official [bundletool 1.18.3](https://github.com/google/bundletool/releases/tag/1.18.3) validates the AAB, which declares `PAGE_ALIGNMENT_16K`. All **40 packaged 64-bit libraries** pass ELF LOAD alignment; native APK ZIP entries pass 16KB alignment. Android `zipalign -c -P 16 -v 4` passes. The verifier correctly rejects the SDK52 baseline.

A separate debug-key-signed universal APK from this exact AAB was used solely for fresh-install optimized release smoke testing: SHA256 `d8be8ade1758f4126ba898cf73d335a757a9f19a9e5b91a755bb3f57e3a165ee`. It rendered authentication, validated empty login and stayed alive without captured runtime errors. It is **not a distribution artifact**; unsigned originals were not modified.

Evidence: `final-artifact-validation.json`, `release-package-metadata.txt`, `release-signature-check.txt`, `release-zipalign.txt`, `aab-bundle-config.json`, `aab-bundletool-validation.txt`, `bundletool-provenance.json`, `optimized-release-smoke/`. Retain exact-build R8 mapping (`android/app/build/outputs/mapping/release/mapping.txt`) and release JavaScript source maps for monitoring setup.

## Validation

| Check | Result | Evidence under `evidence/2026-10-30-hardening/` |
|---|---|---|
| Lint, scoped TypeScript, unit suite | **49 tests pass** | `checks-current.txt`; recorder regressions fail before fix in `recording-ui-regression-red.txt` |
| Rules, delivery, connections, migration | **26 integration tests pass**, loopback Firestore | `integration-final.txt` |
| QA/release build, lint and JVM policy tests | Pass; lint **0 errors, 79 warnings** | `recording-fix-build.log`, Android reports |
| Real Auth signup, safe profiles, private tokens, UI peer connection | Pass on isolated API36 emulators | QA evidence and ignored private fixtures |
| UI GPS reminder → client transaction → reviewed local delivery factory → real FCM | Pass; first call correctly ended MISSED | `final-boundary-native.log`, `qa-outcomes-before-cleanup.json`; `ZHRJ6h6D0q3QUvR3WScw` |
| Record/Stop/upload/recipient playback | Pass; **14s**, 175,969-byte M4A, Personal Voice Note → Delivered | `recording-stop-control.png`, `voice-before-arrival.json`, `final-answer-ui.png`, `final-voice-completed-ui.xml`, `voice-media-authorization.json` |
| Scheduled sender wake after process death, without force-stop or forcing job | Pass | `native-schedule-preactivation.txt`, `final-sender-native-wake.log`; `rmzUBlGSUlMZqx8M3Rta` |
| Final QA Answer and completion | ANSWERED receipt/completed parent | `final-voice-answer.log`, `qa-outcomes-before-cleanup.json` |
| Recipient dead/screen off → FCM/native wake → Decline | Pass; initially asleep, awake before manual wake, DECLINED receipt | `final-cold-before.txt`, `final-cold-decline-action.json`, `final-cold-decline-native.log`; `qa-final-cold-1793405702438` |
| Duplicate, foreign-account, expired events | Deduplicated / suppressed | `final-boundary-native.log` |
| Installation switched accounts | Old device disabled/new owner enabled; obsolete job absent | `qa-account-switch.json` |
| Authorized media / no auth / wrong document | **200 / 401 / 403** | `voice-media-authorization.json` |
| Optimized release startup/empty login | Pass using test copy from final AAB | `optimized-release-smoke/` |

The final QA hash was verified on both installed devices. First location/TTS/timeout and some boundaries used preceding QA hash `fa3bfa1786e2fb199d0b754e3852d0a3c594f2f9902a80379847148fddc32f33`. Final voice, scheduled wake, Answer, cold Decline, repeated account/expiry rejection and account switching used `a82d6f563f251a381e292007e918e4cbf27d8f4859d8fbc112c087c004b0507a`. Earlier `6006db7032b08a4d85f3cde60220efd3476615654e25e72d58d7338e1e825533` device evidence remains historical.

The voice reminder was UI-created outside its 5km fence. Future activation was then **seeded in local Firestore specifically for the native schedule test**. Sender process was killed using `run-as ... kill -9`; package remained `stopped=false`. A separate Fused Location Provider app supplied fresh synthetic positions. JobScheduler activated it about **4.4s after the selected deadline**; trigger creation occurred about 4.6s after deadline. This single emulator observation is not an exact-alarm/Doze guarantee. Cold-recipient fixtures are **server-seeded transport tests**, not GPS tests.

Media used the reviewed Worker in a local VM with real JWT verification and an **in-memory R2 adapter**, not hosted Cloudflare storage. Bearer-authenticated playback fetched valid M4A. Range requests returned full-object HTTP200; partial-content streaming is not claimed.

The initial Answer harness tapped the label below its touch target; that call ended MISSED. Corrected automation taps the control. One cold attempt hit an expired **QA adapter** OAuth credential and recorded `FCM_FAILED`; the adapter now respects CLI `expires_at`. That fixture's later MISSED device receipt remains distinct from its provider failure. Successful rerun has a separate ID. Harness corrections reject stale XML/zero-area targets and collapse notification shade before startup checks.

## Evidence limits

- GPS is synthetic. Physical audibility/vibration/GPS precision, battery drain, OEM restrictions, reboot/long Doze and both power policies are not certified. Offline outbox expiry/recovery, asynchronous cleanup and midnight behavior have automated coverage; the full physical-device matrix is pending.
- Emulators used **4096-byte pages**. Static16KB passes; strict16KB runtime/distribution and iOS are untested.
- Sender reactivation uses **JobScheduler**, with Android scheduling delays; exact midnight/scheduled wake under power restrictions is not promised.
- CI is prepared and locally inspected, not remotely run. No push occurred. CI Firebase artifacts are unsuitable for distribution.
- Crash collection/upload is off. Dashboard ingestion/symbolication/alerts require release setup. Lint retains79 warnings; Gradle emits dependency/deprecation warnings. Optimized startup passed.

## Dependency review

Backend production audit: **zero vulnerabilities** (`functions-dependency-audit-final.json`), final lockfile covered by26 integration checks.

App production audit: **eight findings, three high/five low**, rooted in Expo CLI Zod3 and Expo config deepmerge. None of Zod, deepmerge, Node gRPC or xmldom is in the generated Android JS source map (`android-dependency-boundary.json`). This remains a build/configuration toolchain finding. Build from reviewed local configuration; do not process untrusted externally supplied Expo configuration.

The [deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) lists no patched release. The [Zod patch](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) is outside the CLI's declared Zod3 range. No forced major override or SDK downgrade was applied. The compatible [Node gRPC patch](https://github.com/advisories/GHSA-m9gg-hp2v-232j) is pinned.

## Deployment and rollback review

**Coordinate the cutover.** New rules reject unverified legacy peers/version1 triggers and migration rotates exposed invitation codes. Existing clients cannot silently continue under that contract. Arrange a signed client and controlled maintenance/cohort plan; do not deploy an incompatible piece alone.

Read-only inventory: deployed send/update Functions version6, voice endpoints version5, all Node22. New connection/profile/retry/aging endpoints remain undeployed. Exact four deployed source archives, ruleset and two indexes are backed up under ignored `Nudgr-V2/tmp_check/deployed-backups/`; hashes/version IDs are in `deployed-backup-ledger.json`. Runtime secrets, Worker version and affected user/code/connection data require separate rollback handling.

Before approved cutover: back up exact configuration/data, review migration dry-run on explicit project, arrange signed client/cohort; apply restrictive profile rules before rotating codes, coordinate indexes/Functions/Worker/recovery jobs, apply idempotent migration and reconnect using fresh codes. Never automatically trust old connections. Verify protected media/device outcomes before broader distribution. Rollback restores captured versions/data deliberately; permissive legacy rules reopen the audited exposures.

Signing/Play ownership, store permission/privacy/account-deletion review, physical acceptance, strict16KB runtime, monitoring activation, iOS and hosted validation remain release gates. Unsigned artifacts are ready for review; production acceptance is not declared.

## Cleanup

Deleted only two fresh synthetic QA Auth users and removed their fixture passwords (`qa-auth-cleanup.json`). Disabled local monitors/installations, stopped/uninstalled mock provider, stopped temporary emulators and owned QA services. Original user AVD/data/pre-existing test account were untouched. SDK52 APK and source baselines remain backed up. No automatic Git commit.
