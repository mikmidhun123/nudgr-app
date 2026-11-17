package com.nudgr

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/** JobScheduler owns the wake lock; React runs only the bounded sender check. */
class NudgrSenderScheduleService : JobService(), HeadlessJsTaskEventListener {
    companion object {
        const val JOB_ID = 73122
        @Volatile private var running = false
        private fun preferences(context: Context) = context.getSharedPreferences(
            if (BuildConfig.NUDGR_QA_BUILD) "nudgr_schedule_qa" else "nudgr_schedule", Context.MODE_PRIVATE)
        @Synchronized fun schedule(context: Context, deadline: Long, resetFailures: Boolean = true) {
            val edit = preferences(context).edit().putLong("deadline", deadline)
            if (resetFailures) edit.putBoolean("completed", true).putInt("incompleteRuns", 0)
            edit.commit()
            if (running) return
            val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            if (deadline <= 0) { scheduler.cancel(JOB_ID); return }
            val delay = (deadline - System.currentTimeMillis()).coerceAtLeast(0)
            scheduler.schedule(JobInfo.Builder(JOB_ID, ComponentName(context, NudgrSenderScheduleService::class.java))
                .setMinimumLatency(delay).setOverrideDeadline(delay + 60_000).setPersisted(true)
                .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_LINEAR).build())
        }
    }
    private val handler = Handler(Looper.getMainLooper())
    private var parameters: JobParameters? = null
    private var host: ReactHost? = null
    private var taskContext: HeadlessJsTaskContext? = null
    private var taskId: Int? = null
    private var listener: ReactInstanceEventListener? = null
    private val timeout = Runnable { finish(true) }

    override fun onStartJob(params: JobParameters): Boolean {
        if (com.google.firebase.auth.FirebaseAuth.getInstance().currentUser == null) return false
        parameters = params
        running = true
        preferences(this).edit().putLong("deadline", System.currentTimeMillis() + 60_000).putBoolean("completed", false).commit()
        handler.postDelayed(timeout, 90_000)
        val reactHost = (application as MainApplication).reactHost
        host = reactHost
        val context = reactHost.currentReactContext
        if (context != null) startTask(context) else {
            val nextListener = object : ReactInstanceEventListener {
                override fun onReactContextInitialized(context: ReactContext) { startTask(context) }
            }
            listener = nextListener
            reactHost.addReactInstanceEventListener(nextListener)
            reactHost.start()
        }
        return true
    }
    private fun startTask(context: ReactContext) {
        if (parameters == null || taskId != null) return
        listener?.let { host?.removeReactInstanceEventListener(it) }
        listener = null
        taskContext = HeadlessJsTaskContext.getInstance(context).also {
            it.addTaskEventListener(this)
            taskId = it.startTask(HeadlessJsTaskConfig("NudgrSenderSchedule", Arguments.createMap(), 60_000, true))
        }
    }
    override fun onHeadlessJsTaskStart(taskId: Int) {}
    override fun onHeadlessJsTaskFinish(taskId: Int) { if (this.taskId == taskId) finish(false) }
    private fun finish(retry: Boolean) {
        val params = parameters ?: return
        parameters = null
        detach()
        running = false
        jobFinished(params, retry)
        if (!preferences(this).getBoolean("completed", false)) {
            val failures = preferences(this).getInt("incompleteRuns", 0) + 1
            preferences(this).edit().putInt("incompleteRuns", failures).commit()
            if (failures >= 5) return
        }
        val deadline = preferences(this).getLong("deadline", 0)
        if (deadline > 0) schedule(this, deadline, false)
    }
    private fun detach() {
        handler.removeCallbacks(timeout)
        listener?.let { host?.removeReactInstanceEventListener(it) }
        listener = null
        taskContext?.removeTaskEventListener(this)
        taskContext = null
        taskId = null
    }
    override fun onStopJob(params: JobParameters): Boolean {
        parameters = null; detach(); running = false
        return true
    }
    override fun onDestroy() { detach(); super.onDestroy() }
}
