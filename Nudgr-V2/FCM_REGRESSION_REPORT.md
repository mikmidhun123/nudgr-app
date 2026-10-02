# FCM regression repair — verification report

## Root cause and history

The previous background-delivery fix was commit `5d321878c95dd0cc9924260df3a403a233dd6d59` (`fix(fcm): resolve background and terminated incoming notification delivery`). It supplied Android notification title/body, ringtone, channel, and tag through `android.notification`, alongside the existing data payload. It did not have a top-level `notification` object.

Commit `2636957a78e0573c2c70ff04099b1a799839e51b` (`feat(diagnostics): add geofence runtime trace, update call channel, and refine background delivery`) removed `android.notification` and made the payload data-only. It also removed the APNs alert/sound/category and lowered APNs priority. The commit explicitly described data-only as intentional, to let headless JavaScript create a local notification with actions.

That change removed native notification fallback: when headless execution is delayed or unavailable, a data-only message cannot itself display an alert. This is the code-level regression mechanism; its contribution to the reported physical-device failure has not been measured on devices here. High-priority data-only messages can work when headless execution succeeds.

The prior permission fix is still present: the incoming notification path reads permissions and never requests them interactively. Another issue found during inspection was that the local incoming notification put `channelId` only in its content. Installed Expo Notifications 0.29 reads the channel from the trigger; the incoming path now supplies it there.

## Changes

- `functions/index.js`: restore top-level notification + existing data, high-priority Android delivery, `nudgr_calls_v3`, ringtone, public visibility, maximum notification priority, vibration, and a stable native tag. The installed Admin SDK uses `priority: 'max'` and `visibility: 'public'`, which it serializes to `PRIORITY_MAX` and `PUBLIC`. Restore APNs alert delivery configuration consistently with the notification payload.
- `functions/index.js`: transactionally claim the live trigger before sending, so repeated/concurrent onCreate snapshots cannot send twice. Missing tokens and zero accepted sends become `FCM_FAILED`; at least one accepted send becomes `FCM_SENT` only after the multicast promise resolves. Record counts and make stale-token cleanup best effort. Log stages and error codes without token values or potentially sensitive SDK error text.
- `src/notifications/localNotifications.js`: use identifier `nudgr_${nudgeId}`, matching the FCM Android tag. FCM and installed Expo both use native notification ID zero, so the call-style local notification updates the same slot with existing Answer/Decline actions. Supply the call channel in the immediate trigger. Reapply actions for native background messages even if a prior Firestore notification marker exists. Cancel the native fallback even when no local marker was persisted.
- `App.js`: retain the module-scope background handler, log `FCM_BACKGROUND_RECEIVED`, and pass the native-enhancement flag for Android notification messages.
- `src/fcm/delivery.js`: log `FCM_FOREGROUND_RECEIVED`; preserve the existing foreground callback and notification-open routing.
- `tests/fcm-regression.test.cjs`: focused regression coverage using the real installed Admin SDK validator and executed application handlers with mocked platform/Firebase services.
- `FCM_REGRESSION_REPORT.md`: this report and device test protocol.

No geofence, sender ownership, trigger generation, location evaluation, voice playback, ringtone asset, incoming-state module, notification category, or native Android source was changed. The sender geofence, trigger engine, and trigger creation files were compared to HEAD and are unchanged.

Technical basis: [React Native Firebase message-state behavior](https://rnfirebase.io/messaging/usage) documents native background display and the registered background callback. [Firebase Android notification builder](https://github.com/firebase/firebase-android-sdk/blob/master/firebase-messaging/src/main/java/com/google/firebase/messaging/CommonNotificationBuilder.java) uses the configured tag and notification ID zero. The matching Expo behavior was checked directly in the installed dependency's `ExpoPresentationDelegate.kt`.

## Automated verification

Verified on 2026-10-02:

- 12 Node regression tests passed.
- Functions JavaScript syntax check passed.
- ESLint passed for the Functions directory and regression tests using the existing Functions configuration.
- All JavaScript under `src`, plus `App.js` and `index.js`, parsed successfully with JSX support.
- Tests cover notification/data schema, actual SDK priority serialization, acceptance ordering, missing tokens, all-token rejection, thrown sends, partial acceptance, failed cleanup, concurrent/replayed events, local notification identity and deduplication, channel/actions, cancellation, background registration/execution, permission getter failure, and foreground FCM callbacks.

These are mocked-service checks. They do not prove OS display, radio delivery, audible ringtone, vibration, action execution, or notification timing on a physical phone.

## Deployment and Android release

Deployment: attempted `firebase deploy --only functions` through a temporary Firebase CLI installation. It exited with `Failed to authenticate, have you run firebase login?`. No deployment was confirmed. Authenticate as an authorized user, then rerun deployment for the configured project `nudgr-e6049`.

Release build: attempted `android/gradlew.bat assembleRelease`; blocked before compilation because `JAVA_HOME` is unset and `java` is unavailable. No release APK was produced or verified.

A portable Node 22.14 runtime and temporary Firebase CLI/cache were downloaded under ignored `tmp_check` for verification. They are not application dependencies or source changes. Run the tests on a configured development machine with `node --test tests/fcm-regression.test.cjs`; run Functions lint from `functions` with `npm run lint`.

## Real-device verification

All three required scenarios are **not tested** here. There is no physical-phone geofence ENTER evidence for this change.

Use two real Android phones, separate accounts, and the new native release APK. Initialize Phone B in the foreground to grant notification permission and create its existing call channel/category. On Phone A, grant foreground/background location permissions, enable device location, create/link an active Nudgr, and confirm sender-owned OS geofence registration. Phone B must not register that sender geofence.

For each Phone B state — app open, app backgrounded, and app removed from recents — independently cause a real Phone A geofence ENTER. Respect the existing 30-minute trigger cooldown or use a fresh active Nudgr; do not alter cooldown/trigger logic to bypass it.

Capture the Phone A ENTER and trigger-created logs, the backend send-start/acceptance logs, and Phone B foreground/background receipt and incoming-display logs. Check one visible notification per trigger, the expected channel, ringtone, vibration, lock-screen behavior, Answer, Decline, incoming UI, voice playback, and notification/state cleanup. Repeat with the app still running in the background so the Firestore listener can race FCM, and with a cold process after removing it from recents.

Do not force-stop Phone B as part of the supported test protocol.

## Practical limits

The native FCM fallback carries the call-channel sound/vibration but has no custom Answer/Decline buttons until the existing headless handler updates it. Device testing must verify that enhancement and the notification-post ordering. The shared tag/id ensures one notification slot; mocked tests cannot rule out repeated sound or a late native post overwriting actions.

The transactional send claim provides at-most-once invocation handling. A process crash after the claim can leave `FCM_SENDING`; FCM acceptance and Firestore state cannot be committed atomically. This repair does not add a retry scheduler or change the geofence architecture.

Do not describe the regression as fully fixed until all three physical-phone scenarios pass.
