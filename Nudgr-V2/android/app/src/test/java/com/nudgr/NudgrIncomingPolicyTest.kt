package com.nudgr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NudgrIncomingPolicyTest {
    @Test fun onlyTheSignedInRecipientCanReceiveAnUnexpiredIncoming() {
        val now = 2_000_000_000_000L
        assertTrue(NudgrIncomingPolicy.accepts("recipient", "recipient", now + 300_000, now))
        assertFalse(NudgrIncomingPolicy.accepts("recipient", null, now + 300_000, now))
        assertFalse(NudgrIncomingPolicy.accepts("recipient", "another", now + 300_000, now))
        assertFalse(NudgrIncomingPolicy.accepts("recipient", "recipient", now, now))
        assertFalse(NudgrIncomingPolicy.accepts("recipient", "recipient", now + 86_400_000, now))
    }
}
