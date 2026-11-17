package com.nudgr

import android.content.Context
import org.json.JSONObject
import com.google.firebase.auth.FirebaseAuth

/** Small durable counterpart of incomingState.js, usable before React starts. */
object NudgrIncomingState {
    const val RINGING_TIMEOUT_MS = 30_000L
    private const val PREFS = "nudgr_incoming"

    private fun preferences(context: Context) =
        context.getSharedPreferences(if (BuildConfig.NUDGR_QA_BUILD) "${PREFS}_qa" else PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun get(context: Context, nudgeId: String? = null): JSONObject? {
        val prefs = preferences(context)
        val id = nudgeId ?: prefs.getString("current", null) ?: return null
        val stored = prefs.getString("nudge_$id", null) ?: return null
        val state = try { JSONObject(stored) } catch (_: Exception) { return null }
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return null
        if (state.optString("recipientUid") != uid) return null
        if (state.optString("state") == "ringing" &&
            (System.currentTimeMillis() - state.optLong("timestamp") >= RINGING_TIMEOUT_MS ||
                state.optLong("expiresAt", Long.MAX_VALUE) <= System.currentTimeMillis())) {
            state.put("state", "missed")
            prefs.edit().putString("nudge_$id", state.toString()).commit()
            NudgrDeliveryReceipts.record(context, state, "MISSED")
        }
        return state
    }

    @Synchronized
    fun received(context: Context, nudgeId: String, triggerId: String, senderName: String,
                 recipientUid: String = FirebaseAuth.getInstance().currentUser?.uid ?: "",
                 expiresAt: Long = System.currentTimeMillis() + 300_000L) {
        if (recipientUid.isEmpty() || FirebaseAuth.getInstance().currentUser?.uid != recipientUid) return
        val state = JSONObject().apply {
            put("nudgeId", nudgeId)
            put("triggerId", triggerId)
            put("senderName", senderName)
            put("recipientUid", recipientUid)
            put("expiresAt", expiresAt)
            put("intentNonce", java.util.UUID.randomUUID().toString())
            put("state", "ringing")
            put("timestamp", System.currentTimeMillis())
        }
        preferences(context).edit()
            .putString("current", nudgeId)
            .putString("nudge_$nudgeId", state.toString()).commit()
        NudgrDeliveryReceipts.record(context, state, "RECEIVED")
    }

    @Synchronized
    fun receivedFromForeground(context: Context, nudgeId: String, triggerId: String, senderName: String,
                               recipientUid: String, expiresAt: Long): Boolean {
        val previous = get(context, nudgeId)
        val previousTrigger = previous?.optString("triggerId") ?: ""
        val newTrigger = previous == null ||
            (triggerId.isNotEmpty() && previousTrigger.isNotEmpty() && previousTrigger != triggerId)
        if (newTrigger) {
            received(context, nudgeId, triggerId, senderName, recipientUid, expiresAt)
        } else if (previousTrigger.isEmpty() && triggerId.isNotEmpty()) {
            // Firestore can display the call before FCM supplies its trigger ID.
            // Associate that ID without undoing an Answer/Decline or resetting the timer.
            previous.put("triggerId", triggerId)
            preferences(context).edit().putString("nudge_$nudgeId", previous.toString()).commit()
            NudgrDeliveryReceipts.record(context, previous, receiptState(previous.optString("state")))
        }
        return newTrigger
    }

    @Synchronized
    fun set(context: Context, nudgeId: String, value: String, senderName: String = "") {
        val previous = get(context, nudgeId) ?: return
        // A delayed JS initialization must not undo a cold Decline or restart its timer.
        if (value == "ringing") return
        if (value !in listOf("ringing", "answered", "declined", "missed")) return
        if (previous.optString("state") != "ringing" && previous.optString("state") != value) return
        val state = previous
        state.put("state", value)
        if (senderName.isNotEmpty()) state.put("senderName", senderName)
        preferences(context).edit()
            .putString("current", nudgeId)
            .putString("nudge_$nudgeId", state.toString()).commit()
        NudgrDeliveryReceipts.record(context, state, receiptState(value))
    }

    private fun receiptState(value: String) = if (value == "ringing") "RECEIVED" else value.uppercase()

    fun hasRinging(context: Context): Boolean = preferences(context).all.keys
        .filter { it.startsWith("nudge_") }.mapNotNull { get(context, it.removePrefix("nudge_")) }
        .any { it.optString("state") == "ringing" }

    fun clear(context: Context) { preferences(context).edit().clear().commit() }
}
