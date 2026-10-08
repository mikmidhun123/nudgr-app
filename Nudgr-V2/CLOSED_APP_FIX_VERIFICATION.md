# Closed-app notification fix and verification

8–9 October 2026. Baseline: `b70471d`. Architecture, sender-owned geofences and incoming screen preserved.

## Confirmed cause

After Firebase CLI authentication, production logs for the earlier geofence tests showed:

```text
2026-10-08T17:10:05.592134Z
TypeError: admin.firestore is not a function
    at /workspace/index.js:25:35
```

The deployed `sendNudgeOnTrigger` was invoked, but its legacy Admin SDK call crashed before `FCM_SENDING`. This explains why the events remained `CREATED`. Earlier foreground/background success came from the separate live Firestore listener, not FCM.

## Applied changes

- `functions/index.js`: use the installed Admin SDK's modular app, Firestore/FieldValue and Messaging APIs. Updated the existing `sendNudgeOnTrigger` and `updateNudgeOnTrigger` functions in `nudgr-e6049`, `us-central1`. Deployment completed successfully. The Firestore trigger path and notification+data payload remain the same.
- `src/fcm/tokens.js`: both registration/refresh `set` calls now write the nested `fcmTokens` map expected by the backend.
- Existing native FCM service: suppress Firebase auto-display by mutating the actual Intent after native handling; preserve Firebase lifecycle handling and RN Firebase's headless receiver.
- Existing native helper/bridge: one synchronized native background poster, system notification records plus a short posting-race guard, notification/channel checks, full-screen permission/capability check, and a 30-second repeating alert/timeout.
- Existing activity/receiver/state: distinguish a resumed activity from a service wakeup, persist incoming and terminal action state before React starts, normalize Decline/Dismissed action names, preserve native ringing until foreground audio starts, and retain cold Answer intent handling.
- `NudgrIncomingState.receivedFromForeground`: associate a delayed FCM trigger ID with the earlier Firestore alert without resetting its timer or an Answer/Decline. A different known trigger ID can still begin a new alert.
- `App.js` cold-open callbacks: normalize native action extras even when Expo reports its default action; route OPEN to IncomingNudge without dismissing the native notification. Foreground audio readiness owns that handoff.
- Foreground Firestore/FCM listeners and incoming UI remain. Foreground JavaScript respects a native terminal action and avoids replacing an active native call notification.
- Metro excludes backend dependencies, local test/IDE caches and generated native build directories from application module crawling. This addresses the local Windows build's locked-file/resource problem; it does not change notification behavior.

## Verification stages

### Backend after deployment, before correcting Phone B's installed token writer

- Fresh sender-owned fixture: `audit-backend-preflight-1791482535753`.
- Android OS ENTER woke the killed sender process at approximately 23:32:56 IST.
- Actual sender app created trigger `trig_28d5adbd3f2c9a6d`; Firestore `createdAt` was `2026-10-08T18:02:58.793Z`.
- The corrected deployed function processed it and wrote `FCM_FAILED / RECIPIENT_TOKEN_MISSING` at `2026-10-08T18:03:08.590Z`.
- This proves the original backend crash is removed and confirms the token-schema blocker at runtime. It is not a successful alert test. The fixture was cancelled afterward.

### Native corrected build and closed-process test (Recents card retained)

- Standalone release APK installed on emulator Phone A (API 37) and physical Phone B (I2304, API 36). Bundled JavaScript; no Expo Go or Metro dependency.
- At `23:36:34.637 IST`, both app processes were absent; Phone B's package had `stopped=false`. The Nudgr Recents card was still present, so this case alone does not establish swipe-away behavior.
- Fresh fixture `audit-fixed-closed-1791482767976`; sender OS ENTER created `trig_bea458e0365a1062` at `2026-10-08T18:06:38.217Z`. Backend recorded `FCM_SENT`, one success, zero failures.
- Phone B native FCM receipt at `23:36:41.062 IST`, `isForeground=false`; native post at `23:36:41.087`. Headless JS subsequently used the same native poster and deduplicated.
- Android's actual notification record contained `nudgr_calls_v3`, importance 5, category `call`, `INSISTENT`, a full-screen PendingIntent and two actions: Answer directly launches MainActivity; Decline uses a broadcast.
- Answer was received at `23:36:48.846`, native notification cancelled, and React received `startAnswered=true`. Vibration history shows 7.63 seconds of repeating vibration until Answer. Audio history shows notification playback.

### Phone B explicitly swiped out of Recents, process dead

- Only Nudgr's card was swiped upward from Phone B's Recents. Other apps were left alone.
- Proof immediately before mock ENTER, `23:41:35.488 IST`: Phone A PID empty; Phone B PID empty; no `com.nudgr` task in `dumpsys activity recents`; Phone B `stopped=false`.
- Phone A alone owned the fresh fixture `audit-fixed-recents-1791483068857`. Mock GPS/network moved from outside (`12.9716,77.68`) to inside (`12.9716,77.5946`) its 2.5 km fence. Android OS ENTER executed at `23:41:36.276`, after sender process death.
- Sender's normal trigger engine created `trig_0b5697d247d87138`; Firestore timestamp `2026-10-08T18:11:38.434Z`. Deployed backend recorded `FCM_SENT`, one success, zero failures, at `18:11:44.023Z`. Sender and recipient device clocks differ slightly; the trigger IDs provide correlation.
- Phone B was created as PID 31193 for delivery: native receipt `23:41:42.227`, `isForeground=false`; native notification posted `23:41:42.272`, `fullScreenAllowed=true`; headless receipt `23:41:42.910` deduplicated the native post.
- Phone B's **Decline action** arrived at `23:41:45.563`; the native receiver persisted Decline and cancelled the alert at `23:41:45.569`. No MainActivity launch occurred during delivery/Decline. No Nudgr Recents card existed after Decline either.
- Vibration history specifically identifies `Notification (com.nudgr 10587)`, repeating pattern, `23:41:42.487–23:41:45.580`, cancelled by user. Audio history shows an unmuted system notification player running `23:41:42.539–23:41:45.584`.
- The notification was already declined before the later screenshot/dump, so those captures are not presented as evidence of the active alert. Native receipt, post, user action, audio and vibration are separate measured stages.
- Process killed again, then app reopened: Home appeared, Firestore's still-triggered item was deduplicated and the declined incoming UI did not replay. Fixture cancelled afterward.
- Human confirmation of how loud/visible the alert felt is pending; hardware logs do not establish subjective audibility.

### Foreground regression and final build

- Fresh fixture `audit-fixed-foreground-1791483180515` displayed the existing incoming React UI through Firestore. Answer/message playback was observed in the UI, and foreground FCM subsequently arrived for `trig_cd102c4fbb2e7407`.
- This exposed a delayed-FCM race: the first Firestore alert had no native trigger ID, so the later FCM callback incorrectly treated it as a new alert after Answer. The small `receivedFromForeground` correction above preserves the recorded action and associates the ID.
- On the next native build, fixture `audit-final-foreground-1791483398115` displayed the existing ringing UI with Answer/Decline. Firestore posted once at `23:46:46.999`; FCM for `trig_ae57b68cc4494b4a` arrived at `23:46:49.733` without a second post. Answered message playback followed. The delayed-FCM deduplication correction passed this device case.
- A locked-screen swipe-away test, `audit-final-recents-locked-1791483434977` / `trig_6323989850d2e1c6`, began with both processes dead, no active Nudgr Recents card, `stopped=false` and Phone B asleep. The OEM retained only an empty (`sz=0`) hidden task record, not a visible Recents card.
- Native FCM `23:47:47.341` → native post `23:47:47.639` → Android full-screen OPEN `23:47:47.901` → React incoming loading screen captured → answered sender/message screen and playback captured. This establishes actual full-screen Activity launch, beyond just a stored full-screen PendingIntent.
- That test exposed a second cold-open path that cleared all notifications at `23:47:48.170` before React audio initialization. The `App.js` correction above removes that premature dismissal. The final build/reinstallation and ringing-handoff retest are pending; do not infer verification of that last revision from the earlier captures.
- Regression suite now passes **20/20**, including the cold native OPEN/ANSWER event passing through Expo's default response handler.

### Corrected cold-open handoff, before audible asset repair

- Release build installed on both devices; APK SHA-256 `9aebbc668824606918f1719fade7f49550e486d2ca45acdb2962097a66820f91`.
- Fixture `audit-verified-handoff-1791483785501`; immediately before ENTER at `23:53:47.775 IST`, both PIDs absent, no active Nudgr task in Recents, Phone B asleep and `stopped=false`.
- Sender Android OS ENTER created `trig_20510f71e119d1d1`; Firestore `createdAt=2026-10-08T18:23:51.377Z`; backend `FCM_SENT`, one success, zero failures.
- Phone B native FCM receipt `23:53:55.606` → native call post `23:53:55.647` → actual full-screen OPEN `23:53:55.970` → headless receipt `23:53:56.330`, deduplicated → React ringing screen captured with sender, test message, Answer and Decline.
- Immediate Android notification dump confirms category `call`, channel v3, importance 5, `INSISTENT`, 30-second timeout, native marker, full-screen Activity intent, Answer Activity intent and Decline broadcast intent.
- OPEN normalized correctly in both native/Expo callbacks. No premature `Dismissed all incoming notifications` occurred. Android's repeating notification player remained started/unmuted through startup. Later UI showed delivered/played after Answer.
- **Human result: vibration confirmed, ringtone NOT audible.** The silent asset diagnosed below explains why audio playback logs did not establish an audible ring. This test passes the closed-process/Recents removal, visual and vibration stages, not the full requested behavior.

## Exact change locations

| Failure | Corrected file/function |
| --- | --- |
| Admin SDK namespace crash before any FCM call | `functions/index.js`: `sendNudgeOnTrigger`, `updateNudgeOnTrigger`; modular `initializeApp`, `getFirestore`, `FieldValue`, `getMessaging` |
| Token written as a literal dotted field | `src/fcm/tokens.js`: `syncFcmToken`, `attachFcmTokenRefresh`; `fcmTokens: { [token]: true }` in both merge-set calls |
| Firebase default notification can overwrite native actions | `NudgrFirebaseMessagingService.handleIntent`: `intent.removeExtra(...)` on the actual Intent, after successful native handling |
| Headless JS/native poster race and lost process-local marker | `App.js` module-scope handler; native bridge/module; `NudgrNotificationHelper.showIncomingNotification` and `isNotificationActive` |
| Missing full-screen declaration/capability check | `AndroidManifest.xml`, `app.json`, `NudgrNotificationHelper.showIncomingNotification` |
| Cold state lost, Decline replay, foreground service mistaken for visible UI | `NudgrIncomingState`, native action receiver/bridge, `incomingState.js`, MainActivity activity lifecycle, App action handlers |
| Ring stops before cold UI is ready | `MainActivity.handleIncomingNudgrIntent`, `App.js` OPEN handlers, `IncomingNudge` initialization, `ringtone.startRingtone` |

## Scope and Android limits

- Sender geofences, trigger engine, Firestore paths, existing functions, mixed high-priority FCM payload and incoming UI are retained. Phone B registers no sender geofence.
- `POST_NOTIFICATIONS` was granted; `nudgr_calls_v3` is enabled with ringtone/vibration. No battery exemption or physical mock-location selection was changed. These tests do not establish long-idle Doze or every manufacturer's power-management behavior.
- Swiping Recents/process death differs from Settings → Force stop. After a settings force-stop, Android requires reopening the app before messages resume; this fix does not bypass that platform state. [RN Firebase lifecycle documentation](https://rnfirebase.io/messaging/usage).
- Full-screen presentation depends on Android permission/capability and device state; a permitted heads-up call alert is a valid unlocked-screen result. [Android full-screen intent rules](https://developer.android.com/about/versions/14/behavior-changes-14#secure-fsi-notifications).

## Evidence

Historical baseline results: [NATIVE_DEVICE_TEST_REPORT.md](NATIVE_DEVICE_TEST_REPORT.md).
Source audit: [CLOSED_APP_NOTIFICATION_AUDIT.md](CLOSED_APP_NOTIFICATION_AUDIT.md).
Local ignored logs: `tmp_check/closed-app-function-deploy.log`, `tmp_check/closed-app-fixed-release-build.log`, `tmp_check/fixed-sender.log`, `tmp_check/fixed-recipient.log`.

Token values and test credentials are not included in this report.

## Audible ringtone failure confirmed separately

After the closed/Recents-removed incoming screen and vibration passed, the user reported **vibration but no audible ringtone**. Successful notification posting and even an Android audio player marked started/unmuted were insufficient evidence of audibility.

- Phone B: ringer mode internal/external `NORMAL`, Zen mode off, notification stream unmuted at 14/15 on speaker. Existing v3 channel points to `android.resource://com.nudgr/raw/ringtone`.
- Both `assets/sounds/ringtone.mp3` and `android/app/src/main/res/raw/ringtone.mp3` were identical (SHA-256 `7578a1dd51adfee4a425c829b175732c1ff058c0df174591100b681977bc4c25`). Decoding 2.351 seconds produced **peak 0, RMS 0, zero nonzero samples**: the bundled sound was entirely silent.
- Replaced both files with the same original synthesized telephone double-ring MP3, preserving filenames and all channel/notification references. Decoded replacement: 3 seconds, peak 0.417, RMS 0.104, 70,546 nonzero samples; identical native/JS copies. SHA-256 `b510dfbba58ad12bf63508eaa2575167227c32497e7f510fe67ca181c0e5fc9a`.
- Ringtone startup errors are now logged in release builds so a foreground audio-load failure can be distinguished from successful silent playback.
- Audible build installed on both devices: APK SHA-256 `28dbbc611c8a497569fc7587c8a97d2e30ad8e7639768823bd15dc2c73e1e2df`. Both MP3 entries extracted from the APK decode to the replacement signal and have the matching replacement hash.
- At `2026-10-09T00:02:32.099 IST`, Phone B's PID was absent, no active Nudgr Recents task existed, screen was asleep and `stopped=false`; sender PID was also absent. Fresh fixture `audit-audible-closed-1791484113502`, trigger `trig_accc94feeeee5054`, created by sender OS ENTER. Backend recorded one FCM success/zero failures.
- Phone B native receipt `00:02:40.217` → call notification `00:02:40.241` → full-screen OPEN `00:02:40.606`; the incoming ringing UI was captured. Answer cancelled the notification at `00:02:48.758`.
- **Human confirmation: “Ringtone + vibration work; Answer works.”** This verifies audible delivery after Recents removal and process death on the physical Phone B.
- Release logging separately revealed foreground `ExpoAsset.downloadAsync` failing because `expo.modules.interfaces.filesystem.AppDirectories` is not linked. The existing AV player can load Metro's already-packaged Android raw resource directly. `ringtone.js` now passes `downloadFirst=false` on Android for start/preload; other platforms retain the download behavior. No additional production dependency or audio architecture is introduced.
- Final rebuild/device check of the direct foreground loading correction is pending. The confirmed audible native closed-app test above remains valid for its identified APK revision.
