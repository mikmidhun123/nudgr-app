package com.nudgr

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/** Retries queued acknowledgements after process death, reboot or lost connectivity. */
class NudgrReceiptService : JobService() {
    private val executor = Executors.newSingleThreadExecutor()
    private var operation: Future<*>? = null

    override fun onStartJob(params: JobParameters): Boolean {
        operation = executor.submit {
            NudgrDeliveryReceipts.draining = true
            var retry = false
            try {
                val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return@submit
                NudgrIncomingState.hasRinging(this)
                for ((key, snapshot) in NudgrDeliveryReceipts.pending(this)) {
                    if (Thread.currentThread().isInterrupted) break
                    val entry = JSONObject(snapshot)
                    if (entry.optString("recipientUid") != uid) continue
                    try {
                        val ref = FirebaseFirestore.getInstance().collection("nudges").document(entry.getString("nudgeId"))
                            .collection("triggerEvents").document(entry.getString("triggerId"))
                            .collection("receipts").document(entry.getString("deviceId"))
                        Tasks.await(ref.set(mapOf("recipientUid" to uid, "deviceId" to entry.getString("deviceId"),
                            "state" to entry.getString("state"), "updatedAt" to FieldValue.serverTimestamp())), 8, TimeUnit.SECONDS)
                        NudgrDeliveryReceipts.acknowledge(this, key, snapshot)
                        Log.i("NudgrReceipt", "[DEVICE_RECEIPT_ACKNOWLEDGED] state=${entry.optString("state")}")
                    } catch (failure: Exception) {
                        val cause = failure.cause ?: failure
                        val code = (cause as? FirebaseFirestoreException)?.code
                        if (code == FirebaseFirestoreException.Code.PERMISSION_DENIED || code == FirebaseFirestoreException.Code.NOT_FOUND) {
                            NudgrDeliveryReceipts.acknowledge(this, key, snapshot)
                            Log.w("NudgrReceipt", "[DEVICE_RECEIPT_REJECTED] code=$code")
                        } else retry = true
                    }
                }
                retry = retry || NudgrIncomingState.hasRinging(this) || NudgrDeliveryReceipts.pending(this).values.any {
                    JSONObject(it).optString("recipientUid") == uid
                }
            } finally {
                NudgrDeliveryReceipts.draining = false
                jobFinished(params, retry)
            }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { operation?.cancel(true); return true }
    override fun onDestroy() { operation?.cancel(true); executor.shutdownNow(); super.onDestroy() }
}
