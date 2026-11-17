package com.nudgr

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onResume() {
    super.onResume()
    NudgrNotificationHelper.setActivityResumed(true)
  }

  override fun onPause() {
    NudgrNotificationHelper.setActivityResumed(false)
    super.onPause()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)

    allowIncomingOnLockscreen(false)
    handleIncomingNudgrIntent(intent)
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncomingNudgrIntent(intent)
  }

  private fun handleIncomingNudgrIntent(intent: android.content.Intent?) {
    if (intent == null) return
    val nudgeId = intent.getStringExtra("nudgeId") ?: return
    val triggerId = intent.getStringExtra("triggerId")
        ?: intent.getStringExtra("triggerEventId")
        ?: ""
    val action = intent.getStringExtra("action") ?: "OPEN"
    val startAnswered = intent.getBooleanExtra("startAnswered", action == "ANSWER")
    val incoming = NudgrIncomingState.get(this, nudgeId) ?: return
    if (intent.getStringExtra("authNonce") != incoming.optString("intentNonce")) return
    if (incoming.optString("triggerId") != triggerId || incoming.optLong("expiresAt") <= System.currentTimeMillis() ||
        incoming.optString("state") !in listOf("ringing", "answered")) return
    allowIncomingOnLockscreen(true)

    android.util.Log.d("MainActivity", "[NUDGR_INTENT] action=$action nudgeId=$nudgeId triggerId=$triggerId startAnswered=$startAnswered")

    if (startAnswered) {
      NudgrIncomingState.set(this, nudgeId, "answered")
      NudgrNotificationHelper.cancelNotification(this, nudgeId)
    }
    // OPEN/full-screen keeps native ringing until IncomingNudge's audio is ready.
    NudgrNativeBridge.setInitialAction(this, action, nudgeId, triggerId, startAnswered)
    NudgrNativeBridge.sendActionToJs(action, nudgeId, triggerId, startAnswered)
  }

  fun allowIncomingOnLockscreen(allowed: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(allowed)
      setTurnScreenOn(allowed)
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
