package com.nudgr

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.auth.FirebaseAuth

object NudgrNotificationHelper {
    private const val TAG = "NudgrNotifHelper"
    const val CHANNEL_ID = "nudgr_calls_v3"
    const val NOTIFICATION_ID = 0
    @Volatile private var activityResumed = false
    // Covers the short interval between notify() and Android publishing its active record.
    // Actual system records remain authoritative after process restart.
    private val recentPosts = mutableMapOf<String, Long>()

    fun setActivityResumed(resumed: Boolean) {
        activityResumed = resumed
    }

    fun isNotificationActive(context: Context, nudgeId: String): Boolean {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
        return manager.activeNotifications.any {
            it.tag == "nudgr_$nudgeId" && it.id == NOTIFICATION_ID &&
                it.notification.extras.getBoolean("nudgr_native", false)
        }
    }

    fun isAppInForeground(context: Context): Boolean {
        // A receiver/service can temporarily raise process importance without a visible activity.
        return activityResumed
    }

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            val existing = notificationManager.getNotificationChannel(CHANNEL_ID)
            if (existing == null) {
                val soundUri = Uri.parse("android.resource://" + context.packageName + "/raw/ringtone")
                val audioAttributes = AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build()

                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Nudgr Incoming Calls",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Incoming Nudgr call-like alerts with ringtone"
                    setSound(soundUri, audioAttributes)
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 800, 200, 800)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    lightColor = Color.parseColor("#2e7d32")
                    enableLights(true)
                    setShowBadge(true)
                }
                notificationManager.createNotificationChannel(channel)
                Log.d(TAG, "Created notification channel $CHANNEL_ID natively")
            }
        }
    }

    @Synchronized
    fun showIncomingNotification(
        context: Context,
        nudgeId: String,
        triggerId: String,
        senderName: String,
        message: String,
        recipientUid: String = FirebaseAuth.getInstance().currentUser?.uid ?: "",
        expiresAt: Long = System.currentTimeMillis() + 300_000L
    ): Boolean {
        if (!NudgrIncomingPolicy.accepts(recipientUid, FirebaseAuth.getInstance().currentUser?.uid, expiresAt) ||
            nudgeId.isBlank() || triggerId.isBlank() || nudgeId.contains('/') || triggerId.contains('/')) return true
        createNotificationChannel(context)

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
        val tag = "nudgr_$nudgeId"
        val soundUri = Uri.parse("android.resource://" + context.packageName + "/raw/ringtone")

        val previous = NudgrIncomingState.get(context, nudgeId)
        val sameTrigger = previous != null && (triggerId.isEmpty() ||
            previous.optString("triggerId").isEmpty() || previous.optString("triggerId") == triggerId)
        if (sameTrigger && previous!!.optString("state") != "ringing") {
            Log.d(TAG, "[NATIVE_NOTIFICATION_SUPPRESSED] nudgeId=$nudgeId triggerId=$triggerId state=${previous.optString("state")}")
            return true
        }
        if (sameTrigger && (isNotificationActive(context, nudgeId) ||
            android.os.SystemClock.elapsedRealtime() - (recentPosts[nudgeId] ?: Long.MIN_VALUE / 2) < 1_000L)) {
            Log.d(TAG, "[NATIVE_NOTIFICATION_DEDUPLICATED] nudgeId=$nudgeId triggerId=$triggerId")
            return true
        }
        if (!sameTrigger) NudgrIncomingState.received(context, nudgeId, triggerId, senderName, recipientUid, expiresAt)
        val nonce = NudgrIncomingState.get(context, nudgeId)?.optString("intentNonce") ?: return true
        if (nonce.isEmpty()) return true
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled() ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                notificationManager.getNotificationChannel(CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE)) {
            Log.w(TAG, "[NATIVE_NOTIFICATION_BLOCKED] nudgeId=$nudgeId reason=PERMISSION_OR_CHANNEL")
            return false
        }

        // 1. PendingIntent for Answer (opens MainActivity in answered mode)
        val answerIntent = Intent(context, MainActivity::class.java).apply {
            action = NudgrNotificationActionReceiver.ACTION_ANSWER
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            data = Uri.parse("nudgr://incoming?nudgeId=$nudgeId&triggerId=$triggerId&action=ANSWER")
            putExtra("nudgeId", nudgeId)
            putExtra("triggerId", triggerId)
            putExtra("triggerEventId", triggerId)
            putExtra("action", "ANSWER")
            putExtra("startAnswered", true)
            putExtra("authNonce", nonce)
            putExtra("notificationTag", tag)
            putExtra("notificationId", NOTIFICATION_ID)
        }
        val answerPendingIntent = PendingIntent.getActivity(
            context,
            (nudgeId.hashCode() * 31 + 1),
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 2. PendingIntent for Decline (handled silently via BroadcastReceiver)
        val declineIntent = Intent(context, NudgrNotificationActionReceiver::class.java).apply {
            action = NudgrNotificationActionReceiver.ACTION_DECLINE
            putExtra("nudgeId", nudgeId)
            putExtra("triggerId", triggerId)
            putExtra("triggerEventId", triggerId)
            putExtra("action", "DECLINE")
            putExtra("authNonce", nonce)
            putExtra("notificationTag", tag)
            putExtra("notificationId", NOTIFICATION_ID)
        }
        val declinePendingIntent = PendingIntent.getBroadcast(
            context,
            (nudgeId.hashCode() * 31 + 2),
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 3. Content PendingIntent (User taps notification body -> opens ringing incoming UI)
        val contentIntent = Intent(context, MainActivity::class.java).apply {
            action = NudgrNotificationActionReceiver.ACTION_OPEN
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            data = Uri.parse("nudgr://incoming?nudgeId=$nudgeId&triggerId=$triggerId&action=OPEN")
            putExtra("nudgeId", nudgeId)
            putExtra("triggerId", triggerId)
            putExtra("triggerEventId", triggerId)
            putExtra("action", "OPEN")
            putExtra("startAnswered", false)
            putExtra("authNonce", nonce)
            putExtra("notificationTag", tag)
            putExtra("notificationId", NOTIFICATION_ID)
        }
        val contentPendingIntent = PendingIntent.getActivity(
            context,
            (nudgeId.hashCode() * 31 + 3),
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 4. Delete PendingIntent (User dismisses/swipes away notification)
        val deleteIntent = Intent(context, NudgrNotificationActionReceiver::class.java).apply {
            action = NudgrNotificationActionReceiver.ACTION_DISMISSED
            putExtra("authNonce", nonce)
            putExtra("nudgeId", nudgeId)
            putExtra("triggerId", triggerId)
            putExtra("triggerEventId", triggerId)
            putExtra("notificationTag", tag)
            putExtra("notificationId", NOTIFICATION_ID)
        }
        val deletePendingIntent = PendingIntent.getBroadcast(
            context,
            (nudgeId.hashCode() * 31 + 4),
            deleteIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = "Incoming Nudgr from $senderName"
        val body = if (message.isNotBlank()) message else "Tap to answer or listen to your voice message"

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Incoming Nudgr")
                .setContentText("Unlock to view").build())
            .setAutoCancel(true)
            .setOngoing(false)
            .setColor(Color.parseColor("#2e7d32"))
            .setSound(soundUri)
            .setVibrate(longArrayOf(0, 800, 200, 800))
            .setContentIntent(contentPendingIntent)
            .setTimeoutAfter(NudgrIncomingState.RINGING_TIMEOUT_MS)
            .setDeleteIntent(deletePendingIntent)
            .addAction(R.mipmap.ic_launcher, "Answer", answerPendingIntent)
            .addAction(R.mipmap.ic_launcher, "Decline", declinePendingIntent)

        val fullScreenAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            notificationManager.canUseFullScreenIntent()
        if (fullScreenAllowed) builder.setFullScreenIntent(contentPendingIntent, true)
        builder.addExtras(android.os.Bundle().apply { putBoolean("nudgr_native", true) })
        val notification = builder.build().apply { flags = flags or Notification.FLAG_INSISTENT }
        notificationManager.notify(tag, NOTIFICATION_ID, notification)
        recentPosts[nudgeId] = android.os.SystemClock.elapsedRealtime()
        Log.d(TAG, "[NATIVE_NOTIFICATION_POSTED] tag=$tag nudgeId=$nudgeId triggerId=$triggerId fullScreenAllowed=$fullScreenAllowed")
        return true
    }

    @Synchronized
    fun cancelNotification(context: Context, nudgeId: String) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val tag = "nudgr_$nudgeId"
        notificationManager.cancel(tag, NOTIFICATION_ID)
        recentPosts.remove(nudgeId)
        Log.d(TAG, "[NATIVE_NOTIFICATION_CANCELLED] tag=$tag")
    }
}
