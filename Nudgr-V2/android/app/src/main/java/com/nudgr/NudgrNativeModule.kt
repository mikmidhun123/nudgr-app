package com.nudgr

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class NudgrNativeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        NudgrNativeBridge.reactContext = reactContext
    }

    override fun getName(): String = "NudgrNativeModule"
    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "installationId" to NudgrDeliveryReceipts.installationId(reactApplicationContext),
        "qaBuild" to BuildConfig.NUDGR_QA_BUILD, "ciAuth" to BuildConfig.NUDGR_CI_AUTH,
        "crashReportingEnabled" to (BuildConfig.NUDGR_CRASH_REPORTING && !BuildConfig.DEBUG && !BuildConfig.NUDGR_QA_BUILD))

    @ReactMethod
    fun isNotificationActive(nudgeId: String, promise: Promise) {
        try {
            val active = NudgrNotificationHelper.isNotificationActive(reactApplicationContext, nudgeId)
            promise.resolve(active)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun showIncomingNotification(nudgeId: String, triggerId: String, senderName: String, message: String,
                                 recipientUid: String, expiresAt: Double, promise: Promise) {
        try {
            promise.resolve(NudgrNotificationHelper.showIncomingNotification(
                reactApplicationContext, nudgeId, triggerId, senderName, message, recipientUid, expiresAt.toLong()
            ))
        } catch (e: Exception) {
            promise.reject("NOTIFICATION_FAILED", e.message)
        }
    }

    @ReactMethod
    fun recordIncoming(nudgeId: String, triggerId: String, senderName: String, recipientUid: String,
                       expiresAt: Double, promise: Promise) {
        if (!NudgrIncomingPolicy.accepts(recipientUid, com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.uid, expiresAt.toLong())) {
            promise.reject("ACCOUNT_OR_EXPIRY", "Incoming call is no longer active for this account."); return
        }
        promise.resolve(NudgrIncomingState.receivedFromForeground(reactApplicationContext, nudgeId, triggerId, senderName, recipientUid, expiresAt.toLong()))
    }

    @ReactMethod
    fun getIncomingState(nudgeId: String?, promise: Promise) {
        try {
            val state = NudgrIncomingState.get(reactApplicationContext, nudgeId)
            promise.resolve(state?.let { Arguments.createMap().apply {
                putString("nudgeId", it.optString("nudgeId"))
                putString("triggerId", it.optString("triggerId"))
                putString("senderName", it.optString("senderName"))
                putString("state", it.optString("state"))
                putString("recipientUid", it.optString("recipientUid"))
                putDouble("expiresAt", it.optLong("expiresAt").toDouble())
                putDouble("timestamp", it.optLong("timestamp").toDouble())
            } })
        } catch (e: Exception) {
            promise.reject("STATE_FAILED", e.message)
        }
    }

    @ReactMethod
    fun setIncomingState(nudgeId: String, state: String, senderName: String, promise: Promise) {
        NudgrIncomingState.set(reactApplicationContext, nudgeId, state, senderName)
        promise.resolve(true)
    }

    @ReactMethod
    fun getInitialAction(promise: Promise) {
        try {
            val initial = NudgrNativeBridge.getInitialAction(reactApplicationContext)
            if (initial != null) {
                val map = Arguments.createMap().apply {
                    putString("action", initial["action"] as? String ?: "")
                    putString("nudgeId", initial["nudgeId"] as? String ?: "")
                    putString("triggerId", initial["triggerId"] as? String ?: "")
                    putBoolean("startAnswered", initial["startAnswered"] as? Boolean ?: false)
                }
                promise.resolve(map)
            } else {
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun clearInitialAction(promise: Promise) {
        NudgrNativeBridge.clearInitialAction(reactApplicationContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun dismissNotification(nudgeId: String, promise: Promise) {
        try {
            NudgrNotificationHelper.cancelNotification(reactApplicationContext, nudgeId)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setLockscreenAllowed(allowed: Boolean, promise: Promise) {
        reactApplicationContext.currentActivity?.runOnUiThread {
            (reactApplicationContext.currentActivity as? MainActivity)?.allowIncomingOnLockscreen(allowed)
        }
        promise.resolve(true)
    }

    @ReactMethod
    fun flushReceipts(promise: Promise) { NudgrDeliveryReceipts.schedule(reactApplicationContext); promise.resolve(true) }

    @ReactMethod
    fun scheduleSenderWakeup(deadline: Double, promise: Promise) {
        NudgrSenderScheduleService.schedule(reactApplicationContext, deadline.toLong()); promise.resolve(true)
    }

    @ReactMethod
    fun clearAccountState(promise: Promise) {
        val manager = reactApplicationContext.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.activeNotifications.filter { it.tag?.startsWith("nudgr_") == true }.forEach { manager.cancel(it.tag, it.id) }
        NudgrIncomingState.clear(reactApplicationContext)
        NudgrNativeBridge.clearInitialAction(reactApplicationContext)
        setLockscreenAllowed(false, promise)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for React Native NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for React Native NativeEventEmitter
    }
}
