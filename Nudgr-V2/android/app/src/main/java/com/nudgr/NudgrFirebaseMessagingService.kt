package com.nudgr

import android.content.Intent
import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService

class NudgrFirebaseMessagingService : ReactNativeFirebaseMessagingService() {
    companion object {
        private const val TAG = "NudgrFCMService"
    }

    override fun handleIntent(intent: Intent) {
        try {
            val extras = intent.extras
            val nudgeId = extras?.getString("nudgeId")
            val triggerId = extras?.getString("triggerEventId")
                ?: extras?.getString("triggerId")
                ?: ""
            val type = extras?.getString("type")
            val senderName = extras?.getString("senderName") ?: "Someone"
            val message = extras?.getString("message") ?: "Incoming Nudgr"

            val isNudgr = !nudgeId.isNullOrEmpty() || type == "nudge_incoming" || type == "nudge"
            val isForeground = NudgrNotificationHelper.isAppInForeground(this)

            Log.d(TAG, "[FCM_NATIVE_RECEIVE] isNudgr=$isNudgr isForeground=$isForeground nudgeId=$nudgeId triggerId=$triggerId")

            if (isNudgr && !nudgeId.isNullOrEmpty()) {
                if (!isForeground) {
                    // App is in the background or killed/removed from recents:
                    // 1. Build and post the incoming Nudgr notification natively with Answer and Decline actions!
                    NudgrNotificationHelper.showIncomingNotification(
                        context = this,
                        nudgeId = nudgeId,
                        triggerId = triggerId,
                        senderName = senderName,
                        message = message
                    )

                    // 2. Suppress the FCM SDK default buttonless notification display.
                    // Google Play Services checks "gcm.n.e" and "gcm.notification.e" to display default notifications.
                    // Removing these keys prevents FCM from showing a second buttonless fallback notification.
                    extras.remove("gcm.n.e")
                    extras.remove("gcm.notification.e")
                    extras.remove("gcm.notification.title")
                    extras.remove("gcm.notification.body")
                } else {
                    // When foregrounded, keep the existing JS/Expo notification behavior.
                    Log.d(TAG, "[FCM_NATIVE_FOREGROUND] App in foreground, delegating to JS handler")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "[FCM_NATIVE_ERROR] Error handling incoming intent", e)
        }

        // Pass to super so RNFirebase and headless background handler still receive the event
        try {
            super.handleIntent(intent)
        } catch (e: Exception) {
            Log.e(TAG, "[FCM_NATIVE_ERROR] super.handleIntent error", e)
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        try {
            val data = remoteMessage.data
            val nudgeId = data["nudgeId"]
            val triggerId = data["triggerEventId"] ?: data["triggerId"] ?: ""
            val senderName = data["senderName"] ?: "Someone"
            val message = data["message"] ?: "Incoming Nudgr"

            val isForeground = NudgrNotificationHelper.isAppInForeground(this)
            Log.d(TAG, "[FCM_ON_MESSAGE_RECEIVED] isForeground=$isForeground nudgeId=$nudgeId triggerId=$triggerId")

            if (!nudgeId.isNullOrEmpty() && !isForeground) {
                if (!NudgrNotificationHelper.isNotificationActive(nudgeId)) {
                    NudgrNotificationHelper.showIncomingNotification(
                        context = this,
                        nudgeId = nudgeId,
                        triggerId = triggerId,
                        senderName = senderName,
                        message = message
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "[FCM_ON_MESSAGE_ERROR] Error in onMessageReceived", e)
        }

        super.onMessageReceived(remoteMessage)
    }
}
