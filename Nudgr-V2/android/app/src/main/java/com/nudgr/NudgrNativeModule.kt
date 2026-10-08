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
    fun showIncomingNotification(nudgeId: String, triggerId: String, senderName: String, message: String, promise: Promise) {
        try {
            promise.resolve(NudgrNotificationHelper.showIncomingNotification(
                reactApplicationContext, nudgeId, triggerId, senderName, message
            ))
        } catch (e: Exception) {
            promise.reject("NOTIFICATION_FAILED", e.message)
        }
    }

    @ReactMethod
    fun recordIncoming(nudgeId: String, triggerId: String, senderName: String, promise: Promise) {
        promise.resolve(NudgrIncomingState.receivedFromForeground(reactApplicationContext, nudgeId, triggerId, senderName))
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
    fun addListener(eventName: String) {
        // Required for React Native NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for React Native NativeEventEmitter
    }
}
