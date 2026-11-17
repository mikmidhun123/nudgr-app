# Nudgr — Project Context

- Repository: E:/work/App -V2; app Nudgr-V2/. Remote: https://github.com/mikmidhun123/nudgr-app.git.
- Local stack: Expo57.0.31 / RN0.86.3 / React19.2.3 / RN Firebase25.1.0 / TypeScript6.0.3; Firebase Auth/Firestore/FCM, Expo Location/Audio/Speech, Worker+R2.
- Android1.0.1/code2/API36/min24/NDK27.1/Kotlin2.3.20/Gradle9.3.1.
- Central home: %AI_KNOWLEDGE_HOME%/01-Projects/Nudgr/Index.md; fallback %USERPROFILE%/Documents/AI-Knowledge/01-Projects/Nudgr/Index.md.

## Current state — 2026-11-17

Full location-alarm feature completion, UI/animation upgrade (`react-native-reanimated` 4.5.1, `react-native-worklets` 0.10.1, `react-native-gesture-handler` ~2.32.0, `react-native-webview` 13.16.1, `expo-haptics` ~57.0.3), Cloudflare R2 + Firestore deletion pipeline (`POST /deleteVoice`, `DELETE /media/*`, `deleteNudge` Function), asymmetric left-to-right swipe gestures (Sender: permanent delete of Firestore + R2 voice; Recipient: `recipientHidden: true` with legacy ruleset fallback and auto-unhide when Sender turns Nudgr ON), interactive OpenStreetMap + Leaflet map pin modal (`LocationPickerModal.js`), per-Nudgr repeat modes (`once`, `once_per_day`, `multiple_per_day` with `notifyOnExit: true` + 200m exit hysteresis + custom `cooldownMinutes`), weekday & time-window schedules (including overnight), Edit Nudgr flow, SideMenu dismissal/navigation fixes, Hermes-compatible direct Firestore peer connection (`connectByCode`), fresh release APK build (`nudgr-device-test.apk`), and sender `"Nudgr sent"` confirmations implemented and verified locally (**59/59 unit tests**, ESLint, and TypeScript checks pass; Graphify updated to 1706 nodes / 3299 edges / 128 communities). Removed dead `ConnectScreen.js` and `storage.rules`. Production remains held for coordinated cohort deployment.

## Prior hardening state — 2026-10-31

User approved hardening, emulator acceptance and unsigned artifacts. Local implementation/validation complete; production held and undeployed. Read PRODUCTION_HARDENING_REPORT.md and AI_CONTEXT/LATEST-HANDOFF.md. FINAL_WORKFLOW_AUDIT.md describes historical SDK52, not current local implementation.

49 unit/26 integration tests, scoped lint/types, QA/release builds/JVM policy checks and release lint pass (0 errors/79 warnings). All40 packaged64-bit libraries pass static16KB alignment; tested runtime4KB. Final QA covers record/Stop/upload/playback, scheduled killed-sender wake, Answer, cold screen-off recipient Decline, account/expiry rejection and account switching. Optimized test copy from final AAB passes startup/empty login.

Private installations/safe profiles, server-verified peers, version2 bounded atomic triggers, leased/retried/batched delivery/device receipts, native account/TTL/window boundaries, scoped session/audio cleanup, owner-scoped outbox, JobScheduler activation, sender re-arm/history/permission recovery implemented. Client snapshots call exists(); Admin snapshots boolean exists. Jobs are not exact alarms. Existing baseline styles preserved.

## Release constraints

No production Functions/rules/indexes/Worker deployment, migration, signing/store setup, commit or push. New contracts require coordinated signed-client/backend/rules/migration cohort; never deploy one incompatible piece alone. Migration dry-run default, rotates codes and never automatically trusts legacy relationships. Crash collection/uploads off. Backend audit zero; app retains8 documented Expo build-tool findings.

Signing/store/privacy/account-deletion review, real GPS/phones/precision/OEM/battery/reboot/Doze/power policies, hosted checks, strict16KB runtime, monitoring and iOS remain gates. Theme transitions and precision refinement queued. Preserve all existing dirty/user UI work; no resets/automatic commits. Never commit credentials, .env, private backups or temporary data.

## Navigation

App.js session/navigation; src/db profiles/devices/connections/nudges/triggers/receipts; src/location sender/outbox/schedule; typed src/runtime cancellation/session/time; native com/nudgr incoming/receipt/wake boundaries; Functions delivery/connections and Worker trusted backend. Query Graphify before scoped source reads; update AST after code changes.
