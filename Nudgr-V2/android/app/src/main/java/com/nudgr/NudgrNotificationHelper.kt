package com.nudgr

import android.app.ActivityManager
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
import java.util.concurrent.ConcurrentHashMap

object NudgrNotificationHelper {
    private const val TAG = "NudgrNotifHelper"
    const val CHANNEL_ID = "nudgr_calls_v3"
    const val NOTIFICATION_ID = 0

    // Tracks currently active native notifications
    private val activeNudges = ConcurrentHashMap<String, Long>()

    fun isNotificationActive(nudgeId: String): Boolean {
        return activeNudges.containsKey(nudgeId)
    }

    fun markNotificationActive(nudgeId: String) {
        activeNudges[nudgeId] = System.currentTimeMillis()
    }

    fun markNotificationInactive(nudgeId: String) {
        activeNudges.remove(nudgeId)
    }

    fun isAppInForeground(context: Context): Boolean {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        val appProcesses = activityManager.runningAppProcesses ?: return false
        val packageName = context.packageName
        for (appProcess in appProcesses) {
            if (appProcess.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND &&
                appProcess.processName == packageName) {
                return true
            }
        }
        return false
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

    fun showIncomingNotification(
        context: Context,
        nudgeId: String,
        triggerId: String,
        senderName: String,
        message: String
    ) {
        createNotificationChannel(context)

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val tag = "nudgr_$nudgeId"
        val soundUri = Uri.parse("android.resource://" + context.packageName + "/raw/ringtone")

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
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(false)
            .setColor(Color.parseColor("#2e7d32"))
            .setSound(soundUri)
            .setVibrate(longArrayOf(0, 800, 200, 800))
            .setContentIntent(contentPendingIntent)
            .setFullScreenIntent(contentPendingIntent, true)
            .setDeleteIntent(deletePendingIntent)
            .addAction(R.mipmap.ic_launcher, "Answer", answerPendingIntent)
            .addAction(R.mipmap.ic_launcher, "Decline", declinePendingIntent)

        notificationManager.notify(tag, NOTIFICATION_ID, builder.build())
        markNotificationActive(nudgeId)
        Log.d(TAG, "[NATIVE_NOTIFICATION_POSTED] tag=$tag nudgeId=$nudgeId triggerId=$triggerId")
    }

    fun cancelNotification(context: Context, nudgeId: String) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val tag = "nudgr_$nudgeId"
        notificationManager.cancel(tag, NOTIFICATION_ID)
        markNotificationInactive(nudgeId)
        Log.d(TAG, "[NATIVE_NOTIFICATION_CANCELLED] tag=$tag")
    }
}
