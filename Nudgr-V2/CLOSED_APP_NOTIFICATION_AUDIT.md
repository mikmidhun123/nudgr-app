# Closed-app incoming Nudgr audit

Audited 8 October 2026. Source baseline: `b70471d`.

**Follow-up after Firebase authentication:** production logs for the correlated 17:10, 17:12 and 17:13 UTC test events show `TypeError: admin.firestore is not a function` at `/workspace/index.js:25`. The function was deployed and invoked, but crashed before claiming the event. The installed Admin SDK 14 requires modular `firebase-admin/firestore` and `firebase-admin/messaging` imports. This is the exact backend cause of the earlier `CREATED` events. The paragraphs below preserve the initial audit; the subsequent fix and retest are recorded separately in `CLOSED_APP_FIX_VERIFICATION.md`.

**Result: closed-process delivery failed on the freshly built native APK; it is not fixed.** The later emulator/physical-phone test confirmed Android OS ENTER and Firestore trigger creation, but the event stayed `CREATED` and Phone B posted no notification. Foreground/live-background delivery worked through Firestore. See [NATIVE_DEVICE_TEST_REPORT.md](NATIVE_DEVICE_TEST_REPORT.md) for correlated IDs and measurements. Production source, backend deployment, geofences, and UI were not changed.

The earliest observed runtime break is the backend handoff: `sendNudgeOnTrigger` did not observably claim the new event (`FCM_SENDING`). Firebase CLI authentication failed, so deployment absence, trigger configuration, and failure before the claim cannot yet be distinguished. The token defect below is independently confirmed in Phone B's live profile and will block the current function once it executes.

## Primary delivery defect: token writer and reader disagree

`src/fcm/tokens.js:24-28` (`syncFcmToken`) and `:68-73` (`attachFcmTokenRefresh`) use:

```js
userRef(uid).set({
  uid,
  [`fcmTokens.${token}`]: true,
  updatedAt: getServerTimestamp(),
}, { merge: true });
```

`set(..., { merge: true })` treats that key as a literal field name. It does not interpret it as an update field path. The document contains a top-level field named `fcmTokens.<token>`, rather than `fcmTokens: { <token>: true }`.

`functions/index.js:60-62`, in `sendNudgeOnTrigger`, reads only `data.fcmTokens`. With only the fields produced by the current token writer, `tokens` is empty. Lines 64-73 record `FCM_FAILED / RECIPIENT_TOKEN_MISSING` and return **without calling FCM**.

This explains how an open app can appear to work: `App.js:331-359` independently receives the parent Nudgr's `triggered` status through Firestore, mounts the incoming UI, and posts a local notification. That listener cannot run in a dead process. Foreground success therefore does not establish that the backend-to-FCM path works.

The SDK behavior was checked without network writes using the installed Firestore SDK and its generated write/mask:

```text
Current input: fieldNames=["fcmTokens.audit-token"]
              mask=["`fcmTokens.audit-token`"]
              nestedToken=null
Correct input: fieldNames=["fcmTokens"]
              mask=["fcmTokens.`audit-token`"]
              nestedToken=true
```

The installed RN Firebase implementation likewise passes the map directly to native `DocumentReference.set(..., SetOptions.merge())`.

**Runtime verification:** after pairing a generated sender account, Phone B's live profile was read using ordinary authenticated client access. It has literal dotted token fields and no nested token map. Nevertheless, the measured event remained `CREATED`, not `FCM_FAILED`: it is inaccurate to claim that this deployed attempt already reached the missing-token branch. An account with a correctly populated legacy nested map can still pass this lookup.

## Native presentation defect: notification suppression changes a copy

`android/app/src/main/java/com/nudgr/NudgrFirebaseMessagingService.kt:13-61`, `handleIntent`, first posts the native notification, then removes `gcm.n.e` and related fields from `val extras = intent.extras` before calling `super.handleIntent(intent)`.

Android `Intent.getExtras()` returns a copy of the extras bundle. Mutating `extras` does not mutate `intent`. The superclass still receives the notification flags and can build Firebase's default notification for a background app.

The Cloud Function sends **notification + data**, with Android tag `nudgr_<nudgeId>`. The native helper and Expo also use that tag and notification ID zero. Firebase's later default notification can therefore replace the custom Answer/Decline/full-screen notification in the same slot. Sharing the slot prevents two separate tray entries; it does not preserve the previous notification's actions, style, or full-screen intent.

RN Firebase 21.14 has a separate broadcast receiver that starts its headless service. Its service's `onMessageReceived` is deliberately a no-op; calling `super.onMessageReceived` is not what forwards this event to JS. The merged current manifest contains both services, with priority 100 on Nudgr's custom service, and the RN Firebase receiver/headless service. Notification delegation is disabled in the merged manifest.

There is also an independent ordering race: the RN Firebase receiver can start JS before the custom service marks its notification active. `App.js:60` checks the in-memory native marker and may schedule Expo's notification. If Expo posts last, it can replace the native notification, including its full-screen intent. This is a presentation reliability issue even after the extras-copy defect is corrected.

## Full-screen, sound, state, and action findings

| Area | Finding |
| --- | --- |
| Full-screen intent | `NudgrNotificationHelper.kt:184` calls `setFullScreenIntent`, but neither the source manifest nor `app.json` declares `USE_FULL_SCREEN_INTENT`. There is no Android 14+ `canUseFullScreenIntent()` check. `showWhenLocked` and `turnScreenOn` only affect an activity after it launches. |
| Notification permission | `POST_NOTIFICATIONS` is declared and requested while the app is open. It was granted on the connected Phone B. The JS headless path correctly avoids interactive permission requests. Native code does not check whether posting is allowed before marking a notification active. |
| Channel | Current backend, native helper, and Expo source agree on `nudgr_calls_v3`. Native importance is HIGH; Expo uses MAX. Both configure ringtone and vibration. Existing user/channel settings remain authoritative. The initial older APK had no v3 channel; the installed release test now has v3 and posted a notification with importance 5 and Answer/Decline through Firestore. |
| Incoming state | Only `IncomingNudge` initialization writes `RINGING`. The background callback posts a notification without initializing incoming state. Native receipt does not persist it either. `getActiveRingingState` cannot restore a newly received native-only alert from this state store. This does not prevent the native notification itself from displaying. |
| Looping ringtone | `IncomingNudge.js:65-85` fetches the Nudgr before calling `startRingtone` and repeating vibration. These require the component to mount and the fetch to finish. The native notification supplies channel sound/vibration, but has no insistence flag or timeout; it is not the same 30-second repeating ring behavior. |
| Answer | Native Answer uses `PendingIntent.getActivity(MainActivity)` directly, with `startAnswered=true`. `MainActivity` stores an initial action for JS cold start. This avoids a broadcast/service-to-activity notification trampoline. |
| Decline | Native Decline correctly uses a broadcast to cancel the native notification. But its receiver emits `com.nudgr.action.DECLINE`, while `App.js` compares with `DECLINE`; a running JS app falls into the OPEN branch and can reopen the incoming UI. With no React context, the event is discarded; there is no durable decline state. The Nudgr remains triggered and can be replayed by the next Firestore subscription. |
| Activity restoration | `MainActivity` immediately cancels the native notification, while `IncomingNudge` waits for a Firestore read before starting its own ringtone. A permitted full-screen launch can therefore silence the native alert before the React experience is ready, particularly offline. |
| Native active marker | A `ConcurrentHashMap` is used rather than Android's active-notification records. It is lost on process death and can be stale after notification removal outside the helper. A successful `notify()` call/marker is not proof of user-visible display. |
| Background restrictions | High-priority FCM is requested. Battery/OEM restrictions can still delay execution; the app does not inspect optimization status. These are not evidence for dismissing the definite token and presentation defects. |

## End-to-end trace

1. `startTriggerEngine` subscribes to sent Nudgrs and filters `senderUid === uid`. `registerGeofencesForNudges` repeats sender ownership filtering. Phone B does not register Phone A's geofence.
2. `backgroundGeofence.js` registers `NUDGR_GEOFENCE_ENTER` at module load. ENTER invokes sender evaluation, with cached sender Nudgrs available for background execution. Distance, schedule, ownership, and cooldown checks precede trigger creation.
3. `createTriggerEvent` in `src/db/triggers.js` transactionally creates `nudges/<id>/triggerEvents/<id>` with `status: CREATED` and updates the parent to `triggered`.
4. `sendNudgeOnTrigger` claims the event, reads the parent Nudgr's `recipientUid`, then reads **that recipient's** `users/<uid>.fcmTokens`. The selection is recipient-based; there is no source evidence that it intentionally targets the sender's tokens.
5. **First definite break for tokens registered by current code:** the nested map is missing, so no FCM send occurs.
6. If a valid nested token map exists, `sendEachForMulticast` sends notification + data at high Android priority. `FCM_SENT` means FCM accepted at least one token; it is not a device receipt or display acknowledgement, nor necessarily acceptance for Phone B if multiple tokens exist.
7. On a current installed native build, Android can create the process to handle FCM. Nudgr's native service attempts immediate local presentation without waiting for React. RN Firebase separately starts headless JS. **Further breaks:** copied extras leave Firebase auto-display enabled; JS/native posting can race; full-screen permission is missing.
8. Only an actual activity launch mounts the React UI and initializes its ringing state/audio. Headless JS cannot mount that UI.
9. Answer directly launches the activity. Decline cancels natively, but its JS action spelling and durable handling are incomplete.

The background registration is already at module scope in `App.js:48`. The actual entry is `expo/AppEntry.js`, from `package.json`; it imports App, so this registration is reachable even though the repository's `index.js` is not the selected entry. Moving the handler to an unused `index.js` alone would not fix this.

## Initial physical-device evidence (before installing the current build)

The user identified the connected device as Phone B and reported a real Phone A trigger.

- Phone B runs Android API 36 and the installed Nudgr targets API 34. Installed package last-update date: 30 September 2026.
- Android's installed component tables contain neither `NudgrFirebaseMessagingService` nor `NudgrNotificationActionReceiver`. They do contain RN Firebase's service/receiver. The current checkout's merged debug manifest contains Nudgr's components. **The installed APK does not contain the current native incoming-notification path.**
- `POST_NOTIFICATIONS` was granted; heads-up was enabled. The current v3 call channel was absent; v2 was present. Full-screen permission was not declared.
- Phone B was sent HOME, then its background process was killed with `am kill`, not force-stopped. The event log confirms the process death at device time 22:01:51; `pidof` returned no process afterward. The package was not in the stopped state.
- A scoped log capture was running. The user reported no alert, and later clarified that Phone B opened by itself and Phone A showed triggered.
- At device time 22:02:55, Android recorded a new process and a resumed `MainActivity`. The capture contained startup token-sync and Firestore subscription logs, but **no FCM receiver/background-receipt or incoming-notification-post evidence**. Startup snapshots reported zero triggered received Nudgrs. The launch cause is not established by this capture; it must not be labeled a successful FCM/full-screen launch.
- No new active Nudgr notification was found in the subsequent notification dump.

This establishes a failed user-observed attempt on an older APK. It does not establish which backend event was sent, whether the intended recipient UID matched this installation, or whether FCM accepted/delivered that event. Those require correlated sender/backend logs.

## Exact minimal corrections

These are proposed source changes, not an applied or verified fix. Preserve the existing geofence, backend flow, RN Firebase, native helper, and React UI.

Before relying on the source corrections, inspect/restore the deployed `sendNudgeOnTrigger` and its Firestore onCreate binding. The fresh runtime test never observed its `FCM_SENDING` claim. Authenticate Firebase CLI, inspect inventory and logs, and deploy the existing function after correcting its input token registration. Retest with a fresh event; redeployment does not recreate old onCreate events.

### 1. Correct both token registration writes

In `src/fcm/tokens.js`, replace the dotted key in **both** `set` calls:

```diff
-      [`fcmTokens.${token}`]: true,
+      fcmTokens: { [token]: true },
```

Keep `{ merge: true }`, which merges nested token entries and preserves other devices. Keep the dotted path in `removeFcmToken`: it uses `update`, where a field path is appropriate. After installing the corrected native app, open/sign in once on Phone B so sync writes its current token into the nested map. Existing literal dotted fields do not repair themselves, and they are not evidence of a usable nested map. The backend already reads the correct intended schema; do not switch it to the sender's account.

### 2. Mutate the actual FCM Intent

In `NudgrFirebaseMessagingService.handleIntent`, replace the four removals:

```diff
-                    extras.remove("gcm.n.e")
-                    extras.remove("gcm.notification.e")
-                    extras.remove("gcm.notification.title")
-                    extras.remove("gcm.notification.body")
+                    intent.removeExtra("gcm.n.e")
+                    intent.removeExtra("gcm.notification.e")
+                    intent.removeExtra("gcm.notification.title")
+                    intent.removeExtra("gcm.notification.body")
```

Only suppress Firebase auto-display after the native notification was successfully posted. Keep `super.handleIntent` for token/lifecycle handling and retain the RN Firebase receiver. The existing mixed payload can stay: changing to data-only is not required to correct this defect. Data-only by itself would still not implement the notification, permission checks, state, or actions.

### 3. Make the existing native helper own Android background posting

To close the independent receiver/service race, add a small `showIncomingNotification` method to the existing `NudgrNativeModule` bridge that invokes `NudgrNotificationHelper.showIncomingNotification` with the message data. In `App.js`'s background handler, use that native method on Android when available; retain the current Expo fallback for other platforms/older native modules. Leave the foreground Firestore/FCM callbacks unchanged.

Serialize/deduplicate the service and bridge entry points inside the helper for the same trigger, and consult Android's `NotificationManager.activeNotifications` for the matching tag/ID rather than treating a process-local map as authoritative. This avoids JS asynchronously replacing the native notification with an Expo notification that lacks its full-screen intent. Do not remove the headless handler or foreground listeners.

### 4. Declare and check full-screen capability

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
```

Add `"USE_FULL_SCREEN_INTENT"` to `app.json`'s Android permissions so config regeneration retains it. Replace the unconditional full-screen builder call with:

```kotlin
val fullScreenAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
    notificationManager.canUseFullScreenIntent()
if (fullScreenAllowed) {
    builder.setFullScreenIntent(contentPendingIntent, true)
}
```

Keep posting the high-importance notification with Answer/Decline when full-screen access is unavailable. Log that distinction. Check `NotificationManagerCompat.areNotificationsEnabled()` and the channel's current importance before recording a post as active. Special full-screen access on Android 14+ is separate from ordinary notification permission and may require a user-granted setting; declaring a permission does not guarantee the grant.

### 5. Preserve call ringing and action meaning

For the existing native 30-second ringing experience, add `builder.setTimeoutAfter(30_000)` and post:

```kotlin
val notification = builder.build().apply {
    flags = flags or Notification.FLAG_INSISTENT
}
notificationManager.notify(tag, NOTIFICATION_ID, notification)
```

Use the existing native cancellation on Answer/Decline to stop the repeating notification alert. Transfer ringing responsibility to React only when its incoming UI/audio is ready; cancelling in `MainActivity` before the Firestore fetch can otherwise create a silent gap. Device audio/channel behavior must be tested.

Normalize the native action before the existing JS comparisons:

```js
const { nudgeId, startAnswered } = event;
const action = event.action?.split('.').pop();
```

Also persist receipt/terminal action state on the native path so a killed-process Decline survives until JS is available, and consume that state before replaying triggered Firestore Nudgrs. The present bridge's in-memory pending activity action is insufficient for a receiver-only Decline. This is local state plumbing in the existing bridge, not recipient geofencing or an architectural replacement.

## Verification and remaining gates

- Existing `node --test tests/fcm-regression.test.cjs`: **12/12 pass**. They mock a correctly nested token map, so they miss the primary token defect. They also do not exercise Android Intent-copy semantics, service/receiver concurrency, permission enforcement, native actions, or real display/audio.
- Current unmodified source: debug manifest/Kotlin compilation and standalone `:app:assembleRelease` both succeeded. The release APK was installed on emulator Phone A and physical Phone B, and real OS geofence ENTER was verified using mock location. Closed-process delivery failed. See the native device report for separate foreground/background results.
- Read-only `firebase functions:list --project nudgr-e6049 --non-interactive`: **failed authentication**. Deployed function version and production logs remain unverified. Recipient token shape and correlated trigger events were subsequently read through authenticated client access: the map is missing and events remained `CREATED`. No backend was deployed here.

After the corrections, build/install a standalone native APK with bundled JS, not Expo Go and not a debug build that relies on Metro for cold startup. Confirm installed native components and v3 channel. Verify Phone B's nested current token and the deployed function version before testing.

For each fresh test, correlate one nudge/trigger ID across: Phone A OS ENTER -> trigger document CREATED -> backend recipient/token lookup -> FCM acceptance -> Phone B native receipt -> actual Android notification record with channel/actions -> audible ringtone/vibration -> Answer/Decline and state cleanup. Respect the existing 30-minute cooldown or use a fresh active Nudgr.

Test separately with Phone B open, backgrounded, and process-confirmed dead without force-stop; repeat the dead-process case locked and unlocked. Verify that exactly one notification remains and actions survive posting races. Test Decline without JS running, then reopen the app and confirm it does not ring again. An FCM send result or local scheduling ID is not display verification.

Android Settings Force stop is a separate stopped-package state: RN Firebase documents that the app must be reopened before message receipt resumes. Ordinary process death/removal from recents is the supported cold-start case; OEM behavior still needs physical-device checks.

## Technical references

- [Firebase Android receive behavior](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)
- [Android Intent.getExtras implementation: returns a copy](https://android.googlesource.com/platform/frameworks/base.git/+/master/core/java/android/content/Intent.java)
- [Android 14 full-screen intent access](https://developer.android.com/about/versions/14/behavior-changes-14#secure-fsi)
- [RN Firebase background/quit and force-stop behavior](https://rnfirebase.io/messaging/usage)

**Do not mark this fixed until the corrected installed native build passes the correlated two-phone dead-process test.**
