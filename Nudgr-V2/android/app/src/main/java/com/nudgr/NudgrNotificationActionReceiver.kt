package com.nudgr

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

class NudgrNotificationActionReceiver : BroadcastReceiver() {
    companion object {
        const val TAG = "NudgrActionReceiver"
        const val ACTION_ANSWER = "com.nudgr.action.ANSWER"
        const val ACTION_DECLINE = "com.nudgr.action.DECLINE"
        const val ACTION_OPEN = "com.nudgr.action.OPEN"
        const val ACTION_DISMISSED = "com.nudgr.action.DISMISSED"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return
        val action = intent.action ?: return
        val nudgeId = intent.getStringExtra("nudgeId") ?: return
        val triggerId = intent.getStringExtra("triggerId")
            ?: intent.getStringExtra("triggerEventId")
            ?: ""

        Log.d(TAG, "[ACTION_RECEIVED] action=$action nudgeId=$nudgeId triggerId=$triggerId")

        // 1. Cancel the native notification immediately
        NudgrNotificationHelper.cancelNotification(context, nudgeId)

        // 2. Stop vibration
        cancelVibration(context)

        // 3. Notify React Native app if running
        NudgrNativeBridge.sendActionToJs(action, nudgeId, triggerId, false)
    }

    private fun cancelVibration(context: Context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator?.cancel()
            } else {
                @Suppress("DEPRECATION")
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                vibrator?.cancel()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to cancel vibration", e)
        }
    }
}
