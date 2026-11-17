# Nudgr — Latest Agent Handoff

**2026-11-17, Asia/Kolkata: Feature completion, alarm repeat/schedule engine, R2 + Firestore swipe deletion, OSM map pinning, Reanimated UI upgrades, live connectivity fallback, and edge-to-edge navigation fixes complete.**

## Summary of 2026-11-17 Implementation

- **Alarm Repeat & Schedule Engine (`src/location/geoUtils.js`, `src/runtime/scheduling.ts`, `src/db/nudges.js`, `src/db/triggers.js`, `firestore.rules`)**:
  - Implemented `repeatMode` (`once`, `once_per_day`, `multiple_per_day`), configurable `cooldownMinutes` (`5..720`), `requireExitBeforeRetrigger` with `notifyOnExit: true` + 200m hysteresis (`@nudgr_inside_regions`), `daysOfWeek` (`0..6`), `startHour:startMinute`–`endHour:endMinute` time windows (including overnight windows), and exact local `00:00` Tomorrow start.
  - Repeating Nudgrs remain `status: 'active'` across triggers (`triggers.js`, `functions/index.js` `updateNudgeOnTrigger`) and recipient `markCompleted()` calls.
- **Asymmetric Left-to-Right Swipe & Cloudflare R2 Cleanup (`src/ui/SwipeableNudgeCard.js`, `worker/index.js`, `functions/nudges.js`, `src/voice/r2Storage.js`)**:
  - **Sender swipe**: Confirms and calls `deleteNudge` Cloud Function (with automatic fallback to Worker `POST /deleteVoice` + Firestore delete/soft-delete when `deleteNudge` Function is not yet deployed on the live project) -> deletes R2 audio via Worker `POST /deleteVoice` (`env.VOICE_BUCKET.delete`) and removes `nudges/{id}`, plus clears local geofence/outbox caches.
  - **Recipient swipe**: Sets `recipientHidden: true` to hide from recipient's list. Turning the Nudgr ON (`setNudgeEnabled(id, true)`), editing an enabled Nudgr (`updateNudgeDetails`), or triggering it (`createTriggerEvent`) automatically resets `recipientHidden: false` so it reappears on the recipient's phone.
  - Added automatic orphan R2 audio cleanup if `createNudge` fails after upload or when replacing audio during edit.
- **Live Firebase Connectivity & Profile Resolution Fallback (`src/db/connections.js`, `src/db/codes.js`, `src/ui/MyConnectionScreen.js`, `src/ui/CreateNudgeScreen.js`)**:
  - Fixed `AbortSignal.timeout` crash in React Native Hermes (`AbortSignal.timeout is not a function`) by replacing it with a standard `AbortController` + `setTimeout`, and prioritized `connectByCodeDirectFirestore` on non-QA physical builds so peer pairing succeeds immediately against live Firestore (`connectionCodes/{code}`, `connections/{id}`, and `users/{uid}/connections/{otherUid}` mirrors).
  - Normalized connection codes by stripping internal whitespace and hyphens (`replace(/[\s-]+/g, '')`), expanded `TextInput` paste handling (`maxLength={16}` sliced to 8 normalized characters), and synced `connectionCodes/{code}` on reveal/copy in `MyConnectionScreen.js`.
  - Updated `getPublicProfile` in `src/db/connections.js` to fall back to `users/{otherUid}` when `profiles/{otherUid}` is absent on live Firestore, and formatted peer names so raw 28-char Firebase UIDs never overflow the UI.
- **Edge-to-Edge SafeAreaView, Back (`<`) Buttons & SideMenu Drawer Fixes (`App.js`, `src/ui/SideMenu.js`, `src/ui/HomeScreen.js`, `src/ui/MyConnectionScreen.js`, `src/ui/ProfileScreen.js`, `src/ui/NudgeListScreen.js`, `src/ui/CreateNudgeScreen.js`, `src/ui/NudgeDetailScreen.js`)**:
  - Added `'top'` to `SafeAreaView` `edges={['top', 'bottom', 'left', 'right']}` in `App.js` so screen headers no longer render underneath the Android system status bar (`edgeToEdgeEnabled=true`).
  - Removed conflicting `paddingTop: StatusBar.currentHeight` inside 56px headers across all secondary screens, expanding header height to `60px` with `zIndex: 25` and `hitSlop: 12` on `<` back buttons, and cleared `lastNavTimeRef` debounce in `goBack`.
  - Overhauled `SideMenu.js` so the overlay unmounts when closed (`!isOpen && !rendered`), separated the visual dim `Animated.View` (`pointerEvents="none"`) from a full-screen `backdropTouch` target, kept only the full top-right `HamburgerButton` (`✕`) above the backdrop (removed the duplicate `✕` inside the drawer header), made the `Nudgr.` brand header and empty space inside the left drawer close the drawer on tap, and scoped drawer links to `My Connections` and `Profile & Account` (removing options already shown on the Home screen).
- **Map Location Pinning & UI/Animations (`src/ui/LocationPickerModal.js`, `RadarPulse.js`, `WaveformBars.js`, `AmbientBackground.js`, `CreateNudgeScreen.js`, `NudgeListScreen.js`, `NudgeDetailScreen.js`, `IncomingNudge.js`, `App.js`)**:
  - Interactive OpenStreetMap + Leaflet WebView map pin picker with live geofence radius circle, place search, and reverse-geocoded labels.
  - Replaced raw debug `"Nudgr geofence ENTER"` banner with user-facing `showSenderNudgeTriggeredNotification` (`"Nudgr sent to <Recipient>"` on `nudgr_sent` channel) and removed false sender time-alarms (`syncAllNudgeAlarms` removed from `App.js` `subscribeSentNudges`).
  - Removed dead `src/ui/ConnectScreen.js` and `storage.rules`.
- **Verification & Physical Device Installer (`install_app.bat`, `Nudgr-V2/tools/install-physical.ps1`)**:
  - Fixed `tools/install-physical.ps1` so it automatically detects when `App.js` or `src/` is newer than `app-release-unsigned.apk` instead of silently re-signing the stale 10/31 APK (`app-release-unsigned.apk` from 10/31 backed up to `tmp_check/deployed-backups/app-release-unsigned-2026-10-31.apk`).
  - Built fresh `:app:assembleRelease` (`assets/index.android.bundle` 3.13 MB + `libreanimated.so` + `libworklets.so`) and prepared 16KB-aligned debug-signed `nudgr-device-test.apk`.
  - **59/59 unit tests** (`npm.cmd run check`: ESLint 0 errors + TypeScript 0 errors + 6 test suites), updated Graphify (`1706 nodes, 3299 edges, 128 communities`).

---

# Nudgr — Production Hardening Handoff (2026-10-31)

**2026-10-31, Asia/Kolkata: local hardening/unsigned artifacts complete; production held.** User approved hardening, emulators and unsigned outputs. No deployment, migration, signing/store setup, commit or push.

Report: E:/work/App -V2/PRODUCTION_HARDENING_REPORT.md. Evidence: evidence/2026-10-30-hardening/. SDK52 audit remains historical.

## Artifacts and validation

- Unsigned APK: Nudgr-V2/android/app/build/outputs/apk/release/app-release-unsigned.apk; SHA256 981bec4972c79a6ceb312548fdd6fa1b212ffe79714869e08cce097a0dfd70d9.
- Unsigned AAB: Nudgr-V2/android/app/build/outputs/bundle/release/app-release.aab; SHA256 e8b7002226520bf5927058f9dd65f2d71fb907d7cced333fe77c941051758a72.
- Final QA: a82d6f563f251a381e292007e918e4cbf27d8f4859d8fbc112c087c004b0507a, verified installed on both temporary emulators. Version1.0.1/code2/API36/min24. Do not deliver old SDK52 app-release.apk.
- 49 unit/26 integration checks, scoped lint/types, QA/release builds/JVM tests pass; release lint0 errors/79 warnings. All40 64-bit static ELF/ZIP16KB checks pass, AAB PAGE_ALIGNMENT_16K; runtime4096-byte pages. CI prepared, not remotely run.
- UI voice rmzUBlGSUlMZqx8M3Rta:14s record/Stop,175,969-byte M4A upload, playback Delivered, ANSWERED receipt/completed parent. Future deadline was locally seeded for isolated native job test. Sender killed without stopped flag; job activated~4.4s after deadline without forcing it. Synthetic FLP coordinates.
- Cold screen-off recipient qa-final-cold-1793405702438 woke; native Decline produced DECLINED. Server-seeded transport, not GPS. Duplicate/account/expiry boundaries and per-install account switch pass.
- Optimized debug-key-signed test copy from exact final AAB passed fresh startup/empty login. Original outputs remain unsigned.
- First TTS/MISSED/some boundaries used preceding fa3bfa... candidate; earlier6006... remains historical. Full report attributes artifacts explicitly.
- Initial Answer harness tapped wrong label; corrected to actual control. Earlier cold attempt hit local QA OAuth expiry; adapter now uses CLI expires_at. Provider failure/device outcomes retained separately. Media reviewed Worker local VM/in-memory R2 with real JWT/FCM; hosted R2/audibility/vibration unverified.

## Contracts and fixes

Private users/uid/devices and safe profiles, server-only verified connections/mirrors, authenticated native-random version2 codes. Migration explicit project/dry-run default, rotates exposed codes, hashes legacy device IDs and never verifies legacy peers automatically. Delivery leases/retries/batches/original5-minuteTTL/accepted hashes and separate receipts. Strict atomic version2 rules and protected media participant/document/key/namespace bindings.

Scoped sessions/listeners/audio generations, owner/expiry outbox, native account/TTL/window checks, durable actions/receipts, JobScheduler activation (not exact), sender-only re-arm preserving cooldown, history/permissions. Expo57/RN0.86/React19/RNFB25/TS6/API36/NDK27/Kotlin2.3.20; Expo Audio replaces AV. Client snapshots exists(); Admin bool. Device-discovered recorder UI state order fixed with2 readiness/cancellation regressions. No existing styles changed across14 baseline UI files;7 byte-identical.

## Remaining release gates

1. Review report/artifacts; establish signing/Play and coordinated signed-client/rules/Functions/Worker/index/migration cohort. No isolated incompatible deployment.
2. Capture runtime secrets/config, Worker version and affected user/code/connection rollback data; review explicit-project migration dry-run. Exact4 deployed Functions archives (send/updatev6, voicev5), ruleset/two indexes already backed up read-only in ignored tmp_check/deployed-backups; sanitized ledger in evidence.
3. Arrange separately intended production rollout decision. Restrict reads before code rotation; reconnect peers with fresh codes; never auto-trust old relationships. Verify hosted media/receipts before expansion.
4. Real phones/GPS/precision/OEM/battery/reboot/longDoze/power policies, strict16KB runtime, iOS, store/privacy/account-deletion and monitoring ingestion/symbolication. Crash collection/uploads off in artifacts.
5. Backend audit zero; app3 high/5 low inherited Expo build-tool findings absent from Android JS map. Do not force incompatible majors/downgrade SDK. Theme transition/precision work queued.

## Cleanup/resume

Two fresh synthetic QA Auth users deleted, fixture passwords removed, local installations/monitors disabled. Mock provider uninstalled, temporary emulators and owned QA server/Firestore stopped. Original user AVD/data/pre-existing account untouched. Workspace AVD/API36 image/ignored scripts reusable; create fresh QA users. No production Firestore/R2 writes. Never expose tokens/credentials/private backups.

Graphify AST update completed:1596 nodes/3043 edges/115 communities. New native schedule symbol resolves correctly. Groovy parser warnings are partial extraction limits; Gradle compilation/lint passed. No semantic/LLM labeling was run.

## Safe Dependency & Disk Cleanup (2026-11-03)

- **Disk Usage Reduction:** Workspace dropped from ~32.98 GB to ~12.74 GB (**~20.24 GB recovered**).
- **Target Cleanups Executed:**
  - `Nudgr-V2/node_modules/**/android/build` & `.cxx` removed (~2.93 GB transient C++/Gradle artifacts). `node_modules` dropped from 3.41 GB to 481 MB.
  - `Nudgr-V2/android/app/build/intermediates`, `.cxx`, `.gradle`, generated and obsolete QA/device-test APKs removed (~4.38 GB). `android/` dropped from 4.51 GB to 239 MB.
  - `Nudgr-V2/tmp_check`: Duplicate zip archives (`android36-google-apis.zip`, `node-v22.14.0-win-x64.zip`), Android Studio test caches, npm-cache, obsolete API 37 QA emulator, suspended emulator RAM dumps, and test logs removed (~12.93 GB). `tmp_check/` dropped from 24.83 GB to 11.89 GB.
  - `.expo/web/cache` and `build.log` removed.
- **Strictly Protected Items Preserved:**
  - Official unsigned release APK (`app-release-unsigned.apk`, SHA256: `981bec49...`) and release AAB (`app-release.aab`, SHA256: `e8b70022...`).
  - Active Node.js v22.14.0 runtime on PATH in `tmp_check/runtime`.
  - Functions/rules/indexes rollback backups in `tmp_check/deployed-backups`.
  - Android 36 Google APIs extracted system image in `tmp_check/android36-google-apis`.
  - All source code in `src/`, UI work, tests, functions, configurations, and Git history.
- **Validation:** 49/49 unit tests pass, typecheck passes, lint passes, Gradle assembleRelease dry-run passes, Firebase configs intact.

Next session: AGENTS → PROJECT → central Index/Current-State/Active-Tasks → handoff → Graphify → scoped source. Source/evidence override stale notes. Preserve dirty/user work; update AST after code changes; no auto-commit.
