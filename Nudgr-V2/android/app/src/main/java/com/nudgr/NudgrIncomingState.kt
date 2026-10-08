package com.nudgr

import android.content.Context
import org.json.JSONObject

/** Small durable counterpart of incomingState.js, usable before React starts. */
object NudgrIncomingState {
    const val RINGING_TIMEOUT_MS = 30_000L
    private const val PREFS = "nudgr_incoming"

    private fun preferences(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun get(context: Context, nudgeId: String? = null): JSONObject? {
        val prefs = preferences(context)
        val id = nudgeId ?: prefs.getString("current", null) ?: return null
        val stored = prefs.getString("nudge_$id", null) ?: return null
        val state = try { JSONObject(stored) } catch (_: Exception) { return null }
        if (state.optString("state") == "ringing" &&
            System.currentTimeMillis() - state.optLong("timestamp") >= RINGING_TIMEOUT_MS) {
            state.put("state", "missed")
            prefs.edit().putString("nudge_$id", state.toString()).commit()
        }
        return state
    }

    @Synchronized
    fun received(context: Context, nudgeId: String, triggerId: String, senderName: String) {
        val state = JSONObject().apply {
            put("nudgeId", nudgeId)
            put("triggerId", triggerId)
            put("senderName", senderName)
            put("state", "ringing")
            put("timestamp", System.currentTimeMillis())
        }
        preferences(context).edit()
            .putString("current", nudgeId)
            .putString("nudge_$nudgeId", state.toString()).commit()
    }

    @Synchronized
    fun receivedFromForeground(context: Context, nudgeId: String, triggerId: String, senderName: String): Boolean {
        val previous = get(context, nudgeId)
        val previousTrigger = previous?.optString("triggerId") ?: ""
        val newTrigger = previous == null ||
            (triggerId.isNotEmpty() && previousTrigger.isNotEmpty() && previousTrigger != triggerId)
        if (newTrigger) {
            received(context, nudgeId, triggerId, senderName)
        } else if (previous != null && previousTrigger.isEmpty() && triggerId.isNotEmpty()) {
            // Firestore can display the call before FCM supplies its trigger ID.
            // Associate that ID without undoing an Answer/Decline or resetting the timer.
            previous.put("triggerId", triggerId)
            preferences(context).edit().putString("nudge_$nudgeId", previous.toString()).commit()
        }
        return newTrigger
    }

    @Synchronized
    fun set(context: Context, nudgeId: String, value: String, senderName: String = "") {
        val previous = get(context, nudgeId)
        // A delayed JS initialization must not undo a cold Decline or restart its timer.
        if (value == "ringing" && previous != null) return
        val state = previous ?: JSONObject().apply {
            put("nudgeId", nudgeId)
            put("triggerId", "")
            put("timestamp", System.currentTimeMillis())
        }
        state.put("state", value)
        if (senderName.isNotEmpty()) state.put("senderName", senderName)
        preferences(context).edit()
            .putString("current", nudgeId)
            .putString("nudge_$nudgeId", state.toString()).commit()
    }
}
