package com.nudgr

import android.util.Log
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

object NudgrNativeBridge {
    private const val TAG = "NudgrNativeBridge"
    var reactContext: ReactApplicationContext? = null

    // Holds pending action if app was launched from cold start via Answer or notification tap
    fun setInitialAction(context: Context, action: String, nudgeId: String, triggerId: String, startAnswered: Boolean) {
        val initial = mapOf(
            "action" to action,
            "nudgeId" to nudgeId,
            "triggerId" to triggerId,
            "startAnswered" to startAnswered
        )
        context.getSharedPreferences(if (BuildConfig.NUDGR_QA_BUILD) "nudgr_incoming_qa" else "nudgr_incoming", Context.MODE_PRIVATE).edit()
            .putString("pending_action", JSONObject(initial).toString()).commit()
        Log.d(TAG, "Recorded initial action: action=$action nudgeId=$nudgeId triggerId=$triggerId")
    }

    fun getInitialAction(context: Context): Map<String, Any?>? {
        val stored = context.getSharedPreferences(if (BuildConfig.NUDGR_QA_BUILD) "nudgr_incoming_qa" else "nudgr_incoming", Context.MODE_PRIVATE)
            .getString("pending_action", null) ?: return null
        val value = JSONObject(stored)
        val incoming = NudgrIncomingState.get(context, value.optString("nudgeId")) ?: return null
        if (incoming.optString("triggerId") != value.optString("triggerId")) return null
        return mapOf(
            "action" to value.optString("action"),
            "nudgeId" to value.optString("nudgeId"),
            "triggerId" to value.optString("triggerId"),
            "startAnswered" to value.optBoolean("startAnswered")
        )
    }

    fun clearInitialAction(context: Context) {
        context.getSharedPreferences(if (BuildConfig.NUDGR_QA_BUILD) "nudgr_incoming_qa" else "nudgr_incoming", Context.MODE_PRIVATE).edit()
            .remove("pending_action").commit()
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
