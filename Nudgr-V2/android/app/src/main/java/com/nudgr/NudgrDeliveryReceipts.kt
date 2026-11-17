package com.nudgr

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.util.UUID

/** Durable metadata only; transport acceptance and user actions remain separate. */
object NudgrDeliveryReceipts {
    const val JOB_ID = 73121
    @Volatile var draining = false
    private fun preferences(context: Context) = context.getSharedPreferences(
        if (BuildConfig.NUDGR_QA_BUILD) "nudgr_receipts_qa" else "nudgr_receipts", Context.MODE_PRIVATE)

    @Synchronized fun installationId(context: Context): String {
        val prefs = context.getSharedPreferences("nudgr_installation", Context.MODE_PRIVATE)
        return prefs.getString("id", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("id", it).commit()
        }
    }

    @Synchronized fun record(context: Context, incoming: JSONObject, state: String) {
        val uid = incoming.optString("recipientUid")
        val nudgeId = incoming.optString("nudgeId")
        val triggerId = incoming.optString("triggerId")
        if (uid.isEmpty() || FirebaseAuth.getInstance().currentUser?.uid != uid || triggerId.isEmpty()) return
        val key = "$uid|$nudgeId|$triggerId"
        val previous = preferences(context).getString(key, null)?.let { JSONObject(it) }
        if (previous != null && previous.optString("state") != "RECEIVED" && state == "RECEIVED") return
        val entry = JSONObject().apply {
            put("recipientUid", uid); put("nudgeId", nudgeId); put("triggerId", triggerId)
            put("deviceId", installationId(context)); put("state", state)
        }
        preferences(context).edit().putString(key, entry.toString()).commit()
        if (!draining) schedule(context)
    }

    fun pending(context: Context): Map<String, String> = preferences(context).all
        .mapNotNull { (key, value) -> (value as? String)?.let { key to it } }.toMap()

    @Synchronized fun acknowledge(context: Context, key: String, snapshot: String) {
        if (preferences(context).getString(key, null) == snapshot) preferences(context).edit().remove(key).commit()
    }

    fun schedule(context: Context) {
        val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        scheduler.schedule(JobInfo.Builder(JOB_ID, ComponentName(context, NudgrReceiptService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
            .setMinimumLatency(250).setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_LINEAR).build())
    }
}
