package com.nudgr

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      useDevSupport = BuildConfig.DEBUG && !BuildConfig.NUDGR_QA_BUILD,
      packageList =
        PackageList(this).packages.apply {
          add(NudgrNativePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    if (BuildConfig.NUDGR_QA_BUILD) {
      // QA uses a local backend and memory cache, keeping production's disk cache untouched.
      com.google.firebase.firestore.FirebaseFirestore.getInstance().firestoreSettings =
        com.google.firebase.firestore.FirebaseFirestoreSettings.Builder()
          .setHost("127.0.0.1:8088").setSslEnabled(false).setPersistenceEnabled(false).build()
      if (BuildConfig.NUDGR_CI_AUTH) com.google.firebase.auth.FirebaseAuth.getInstance().useEmulator("127.0.0.1", 9099)
    }
    com.google.firebase.messaging.FirebaseMessaging.getInstance().isAutoInitEnabled = !BuildConfig.NUDGR_CI_AUTH
    val crashReporting = BuildConfig.NUDGR_CRASH_REPORTING && !BuildConfig.DEBUG && !BuildConfig.NUDGR_QA_BUILD
    io.invertase.firebase.common.ReactNativeFirebasePreferences.getSharedInstance()
      .setBooleanValue("crashlytics_auto_collection_enabled", crashReporting)
    com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance().setCrashlyticsCollectionEnabled(crashReporting)
    if (BuildConfig.NUDGR_QA_BUILD) com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance().deleteUnsentReports()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
