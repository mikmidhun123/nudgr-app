# Native Android device test — 8 October 2026

**Result: closed-process delivery failed on the current native build. This is not fixed.** Foreground and background alerts with a live recipient process worked through Firestore. No production source or backend deployment was changed.

## Setup

- Project opened in Android Studio: `E:\work\App -V2\Nudgr-V2\android`.
- Android Studio initially could not resolve Node during Gradle sync. It was restarted with the bundled Node directory on its process PATH. Its original system-cache socket `.port` then prevented startup; automatic approval review blocked removing that file. The IDE reopened using a separate system cache in ignored `tmp_check/android-studio-system`; the user manually handled the project-trust prompt. `tmp_check/open-android-studio.ps1` reopens this same setup. This is IDE environment setup, not an application source change.
- At handoff, Android Studio's initial project sync was still downloading dependencies. The standalone command-line release build and installation/run on both devices had already succeeded; IDE sync completion is not claimed.
- Source baseline: `b70471d`.
- Standalone release APK with bundled JavaScript, installed successfully with `adb install -r` on both devices. Expo Go and Metro were not used.
- APK: `android/app/build/outputs/apk/release/app-release.apk`; 65,658,116 bytes; built at 22:32 IST. SHA-256: `C6929132667A906F64850BD73984D36D5CDEBF31F4A897AE390B7BE4B9B3ED98`.
- Phone A: `Medium_Phone_API_37.0` emulator, API 37, generated Firebase test account.
- Phone B: user's connected I2304 physical phone, API 36, existing account retained.
- Accounts paired using the existing connection-code schema and ordinary authenticated client writes, subject to Firestore rules. Test Nudgr documents used the same fields as `createNudge`; trigger events were created by the installed sender app, never by the test harness.
- Mock location was applied only to Phone A. Phone B did not own/register these geofences. Its existing mock-location selection was left unchanged.
- Center: latitude `12.9716`, longitude `77.5946`, radius `2.5 km`. Outside point: `12.9716,77.68` (approximately 9.3 km away). Both GPS and network test providers reported the mock coordinates through Android's fused provider.
- Initial emulator `emu geo fix` commands did not update fused location while GPS was idle. Those commands were not counted as successful geofence tests. The measured tests below used verified Android test-provider locations.

## Results

| Recipient state | Actual result | Delivery source |
| --- | --- | --- |
| Open, fresh ENTER | Incoming screen displayed sender/message and Answer/Decline. | `source=firestore` |
| Background, process alive | Android posted one high-importance notification with two actions. Decline callback dismissed it. | `source=firestore` |
| Process confirmed dead | No Nudgr notification and no recipient process restart during the measured closed interval. | No FCM receipt observed |
| Reopened after failed closed test | Existing triggered Nudgr appeared immediately; Answer opened the connected message/playback screen. | `source=firestore` |

Foreground/background success is **not** FCM success. Every observed recipient delivery in these tests was the Firestore listener. No `FCM_NATIVE_RECEIVE` or FCM background-handler receipt for these test IDs was observed.

## Closed-process trace

Nudgr: `audit-closed-1791479312795`.
Trigger: `trig_b923cb2502800dd9`.

1. Sender logs confirmed successful OS registration of `nudgr-audit-closed-1791479312795` with task `NUDGR_GEOFENCE_ENTER`.
2. Both apps were sent HOME, then killed using `am kill com.nudgr`. `pidof com.nudgr` returned empty on both. Phone B's user-0 package state was `stopped=false`: this was ordinary process death, not Settings Force stop.
3. At 22:39:59.536 IST, Android delivered ENTER and woke Phone A's task. Logs explicitly identified the matching region. This was not a foreground GPS-watcher trigger.
4. At 22:40:00.522, sender evaluation matched ENTER. At 22:40:01.037 it logged trigger creation success. Firestore committed the event at `2026-10-08T17:10:01.773Z` and the parent Nudgr became `triggered`.
5. At 22:41:19.979, Phone B still had no process and **zero active Nudgr notification records**. No native/headless FCM receipt was present in the captured recipient logs.
6. The event remained `CREATED`, with unchanged `updatedAt`, when checked again at 22:44:39. It never showed `FCM_SENDING`, `FCM_SENT`, or `FCM_FAILED` during the observed interval.
7. At 22:41:43.404, deliberately reopening Phone B produced `source=firestore` and the incoming screen. This later foreground fallback does not turn the closed test into a pass.

**First observed break: Firestore trigger event -> Cloud Function processing.** `sendNudgeOnTrigger` in `functions/index.js:13-35` should claim a `CREATED` event by writing `FCM_SENDING` before token lookup. That claim was not observed. The available evidence cannot distinguish an absent/stale deployment, a trigger/configuration problem, or a failure before the claim commits.

`firebase functions:list --project nudgr-e6049 --non-interactive` failed with `Failed to authenticate, have you run firebase login?`. Deployed function inventory and server logs could not be inspected. No backend was deployed or bypassed, and no direct synthetic FCM injection was used.

## Independently confirmed live token defect

The authenticated test sender could read Phone B's profile after pairing. The profile contained literal top-level `fcmTokens.<token>` fields and **no nested `fcmTokens` map**. Token values are intentionally omitted from this report.

- Writer: `syncFcmToken` and `attachFcmTokenRefresh`, `src/fcm/tokens.js:24-28,68-73`.
- Reader: `sendNudgeOnTrigger`, `functions/index.js:60-73`.

The writer uses `set({ [\`fcmTokens.${token}\`]: true }, { merge: true })`. The function reads `data.fcmTokens`. When the current function executes against this confirmed recipient schema, it will find no token and record `FCM_FAILED / RECIPIENT_TOKEN_MISSING` without sending FCM.

That is a proven additional blocker, but it is **not the recorded status of this test's event**: this event stayed `CREATED`, so it would be inaccurate to claim that the deployed function already reached and rejected the token lookup.

## Other measured cases

- `audit-background-1791479549437` / `trig_9e205137f2aa99e3`: intended background run invalidated because Phone B's task was removed before ENTER. Android exit info recorded `USER REQUESTED / REMOVE TASK` at 22:42:34.112. It became another dead-process attempt, not a live-background pass.
- `audit-background-alive-1791479611611` / `trig_b6857b60079bac62`: Phone B PID `4218` was checked alive immediately before ENTER at 22:43:48 and after delivery. At 22:43:50.042 the Firestore listener received it. Android notification record: channel `nudgr_calls_v3`, importance `5`, `actions=2`, actions labeled Answer and Decline, `fullscreenIntent=null`. At 22:44:39.225 the actual notification Decline action produced `actionId=DECLINE` and dismissed the notification. This tested the Expo/Firestore action path, not the native FCM broadcast action path.
- `audit-foreground-1791479710540` / `trig_a4b56a2eada538a4`: OS ENTER at 22:45:23.231, sender trigger creation, recipient `source=firestore` at 22:45:24.454, and visible incoming screen. Android vibrator history recorded the app's repeating pattern starting at 22:45:24.594 and cancellation at 22:45:32.333.
- Background vibrator history recorded the system notification pattern playing for approximately 1.8 seconds, while the separate React `Vibration.vibrate(..., true)` request was `ignored_background`. A live React process does not grant unrestricted repeating background vibration.
- Channel sound is configured and system notification audio-focus activity was recorded. Audible ringtone/looping behavior was not independently confirmed by the device user; do not mark full ringtone behavior verified.
- The installed current APK contains `NudgrFirebaseMessagingService` and `NudgrNotificationActionReceiver`; the earlier September APK mismatch was removed by this install. `POST_NOTIFICATIONS` is granted. The v3 channel now exists. `USE_FULL_SCREEN_INTENT` remains undeclared in current source.

## Minimal next steps

1. Authenticate Firebase CLI and inspect the deployed `sendNudgeOnTrigger` and its logs for these trigger IDs. Restore/verify the existing Firestore trigger deployment in `nudgr-e6049`; no geofence replacement is needed. Existing `CREATED` events will not automatically become new onCreate events after deployment: retest with a fresh Nudgr.
2. Correct **both** token `set` calls to `fcmTokens: { [token]: true }`, retain `{ merge: true }`, and open the corrected app on Phone B once to register its current token in that map.
3. Apply the existing native presentation corrections documented in `CLOSED_APP_NOTIFICATION_AUDIT.md`: mutate the actual Intent, coordinate native/background posting, declare/check full-screen access, and correct durable action/ringing state. Leave the foreground listeners/UI and sender-only geofences intact.
4. Repeat a fresh, correlated closed-process test, then locked/unlocked and cold Answer/Decline tests. FCM acceptance, device receipt, notification posting, sound/vibration, and action behavior must each be checked.

All four synthetic Nudgrs were cancelled after testing. Emulator test providers and the shell mock-location override were removed. The generated sender account remains paired for reproduction. Raw local evidence is in ignored `tmp_check` files; credentials/tokens were not added to tracked files.

The exact proposed source corrections and Android/FCM references are in [CLOSED_APP_NOTIFICATION_AUDIT.md](CLOSED_APP_NOTIFICATION_AUDIT.md).
