package com.nudgr.qalocation;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;

/** Separate QA app keeps a fresh FLP mock stream alive while Nudgr is backgrounded or killed. */
public final class LocationFixtureService extends Service {
  private final Handler handler = new Handler(Looper.getMainLooper());
  private FusedLocationProviderClient client;
  private double latitude = Double.NaN, longitude = Double.NaN;
  private boolean ready;
  private final Runnable tick = new Runnable() {
    @Override public void run() { publish(); handler.postDelayed(this, 1000); }
  };

  @SuppressLint("MissingPermission")
  @Override public void onCreate() {
    super.onCreate();
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
        new NotificationChannel("qa_location", "QA synthetic location", NotificationManager.IMPORTANCE_LOW));
    Notification.Builder notification = Build.VERSION.SDK_INT >= 26
        ? new Notification.Builder(this, "qa_location") : new Notification.Builder(this);
    startForeground(42, notification.setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setContentTitle("QA synthetic location is active").setOngoing(true).build());
    client = LocationServices.getFusedLocationProviderClient(this);
    client.setMockMode(true).addOnSuccessListener(ignored -> {
      ready = true; handler.post(tick); Log.i("NudgrQaLocation", "[QA_FLP_READY]");
    }).addOnFailureListener(error -> Log.e("NudgrQaLocation", "[QA_FLP_FAILED] " + error.getClass().getSimpleName()));
  }

  @Override public int onStartCommand(Intent intent, int flags, int id) {
    if (intent != null) {
      try {
        double lat = Double.parseDouble(intent.getStringExtra("latitude"));
        double lon = Double.parseDouble(intent.getStringExtra("longitude"));
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new IllegalArgumentException();
        latitude = lat; longitude = lon; publish();
      } catch (Exception error) { Log.e("NudgrQaLocation", "[QA_COORDINATES_REJECTED]"); }
    }
    return START_NOT_STICKY;
  }

  @SuppressLint("MissingPermission")
  private void publish() {
    if (!ready || !Double.isFinite(latitude)) return;
    Location fix = new Location("fused");
    fix.setLatitude(latitude); fix.setLongitude(longitude); fix.setAccuracy(5);
    fix.setTime(System.currentTimeMillis()); fix.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());
    client.setMockLocation(fix).addOnFailureListener(error ->
        Log.e("NudgrQaLocation", "[QA_FIX_FAILED] " + error.getClass().getSimpleName()));
  }

  @SuppressLint("MissingPermission")
  @Override public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    if (client != null) client.setMockMode(false);
    super.onDestroy();
  }
  @Override public IBinder onBind(Intent intent) { return null; }
}
