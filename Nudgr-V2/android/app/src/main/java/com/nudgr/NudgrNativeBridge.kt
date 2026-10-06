package com.nudgr

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object NudgrNativeBridge {
    private const val TAG = "NudgrNativeBridge"
    var reactContext: ReactApplicationContext? = null

    // Holds pending action if app was launched from cold start via Answer or notification tap
    var pendingInitialAction: Map<String, Any?>? = null

    fun setInitialAction(action: String, nudgeId: String, triggerId: String, startAnswered: Boolean) {
        pendingInitialAction = mapOf(
            "action" to action,
            "nudgeId" to nudgeId,
            "triggerId" to triggerId,
            "startAnswered" to startAnswered
        )
        Log.d(TAG, "Recorded initial action: $pendingInitialAction")
    }

    fun sendActionToJs(action: String, nudgeId: String, triggerId: String, startAnswered: Boolean) {
        val context = reactContext ?: return
        try {
            val params = Arguments.createMap().apply {
                putString("action", action)
                putString("nudgeId", nudgeId)
                putString("triggerId", triggerId)
                putBoolean("startAnswered", startAnswered)
            }
            context
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onNudgrNativeAction", params)
            Log.d(TAG, "Emitted onNudgrNativeAction to JS: action=$action nudgeId=$nudgeId triggerId=$triggerId")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit onNudgrNativeAction to JS", e)
        }
    }
}
