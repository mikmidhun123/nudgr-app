package com.nudgr

object NudgrIncomingPolicy {
    fun accepts(recipientUid: String?, currentUid: String?, expiresAt: Long, now: Long = System.currentTimeMillis()): Boolean =
        !currentUid.isNullOrEmpty() && recipientUid == currentUid && expiresAt > now && expiresAt <= now + 330_000L
}
