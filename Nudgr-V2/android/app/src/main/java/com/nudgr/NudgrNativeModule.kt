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
            val active = NudgrNotificationHelper.isNotificationActive(nudgeId)
            promise.resolve(active)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getInitialAction(promise: Promise) {
        try {
            val initial = NudgrNativeBridge.pendingInitialAction
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
        NudgrNativeBridge.pendingInitialAction = null
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
