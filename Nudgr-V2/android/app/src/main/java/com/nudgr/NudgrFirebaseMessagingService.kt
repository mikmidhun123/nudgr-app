package com.nudgr

import android.content.Intent
import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.RemoteMessage
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService

class NudgrFirebaseMessagingService : ReactNativeFirebaseMessagingService() {
    private fun expiry(value: String?, sentAt: Long): Long = value?.toLongOrNull() ?: if (sentAt > 0) sentAt + 300_000L else 0L

    override fun handleIntent(intent: Intent) {
        val extras = intent.extras
        val nudgeId = extras?.getString("nudgeId")
        val triggerId = extras?.getString("triggerEventId") ?: extras?.getString("triggerId") ?: ""
        val isNudgr = !nudgeId.isNullOrEmpty() || extras?.getString("type") in listOf("nudge", "nudge_incoming")
        if (isNudgr) {
            // Suppress the generic notification even when a stale/account-mismatched payload is rejected.
            listOf("gcm.n.e", "gcm.notification.e", "gcm.n.title", "gcm.n.body", "gcm.notification.title", "gcm.notification.body")
                .forEach { intent.removeExtra(it) }
            try {
                val deadline = expiry(extras?.getString("expiresAt"), extras?.get("google.sent_time")?.toString()?.toLongOrNull() ?: 0L)
                val recipientUid = extras?.getString("recipientUid")
                if (!nudgeId.isNullOrEmpty() && NudgrIncomingPolicy.accepts(recipientUid, FirebaseAuth.getInstance().currentUser?.uid, deadline)) {
                    val traceId = nudgeId.take(80).replace(Regex("[^A-Za-z0-9_-]"), "_")
                    Log.i("NudgrFCMService", "[FCM_NATIVE_ACCEPTED] nudgeId=$traceId remainingMs=${deadline - System.currentTimeMillis()}")
                    if (!NudgrNotificationHelper.isAppInForeground(this)) {
                        NudgrNotificationHelper.showIncomingNotification(this, nudgeId, triggerId,
                            extras?.getString("senderName") ?: "Someone", extras?.getString("message") ?: "Incoming Nudgr", recipientUid!!, deadline)
                    }
                } else Log.i("NudgrFCMService", "[FCM_NATIVE_SUPPRESSED] reason=ACCOUNT_OR_EXPIRY")
            } catch (failure: Exception) {
                Log.w("NudgrFCMService", "[FCM_NATIVE_ERROR] ${failure.javaClass.simpleName}")
            }
        }
        super.handleIntent(intent)
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        val nudgeId = data["nudgeId"]
        if (!nudgeId.isNullOrEmpty()) {
            val recipientUid = data["recipientUid"]
            val deadline = expiry(data["expiresAt"], remoteMessage.sentTime)
            if (!NudgrIncomingPolicy.accepts(recipientUid, FirebaseAuth.getInstance().currentUser?.uid, deadline)) return
            if (!NudgrNotificationHelper.isAppInForeground(this)) {
                NudgrNotificationHelper.showIncomingNotification(this, nudgeId, data["triggerEventId"] ?: data["triggerId"] ?: "",
                    data["senderName"] ?: "Someone", data["message"] ?: "Incoming Nudgr", recipientUid!!, deadline)
            }
        }
        super.onMessageReceived(remoteMessage)
    }
}
