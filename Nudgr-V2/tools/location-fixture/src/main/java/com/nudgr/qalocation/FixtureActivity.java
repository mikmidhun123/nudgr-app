package com.nudgr.qalocation;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.widget.TextView;

/** Shell-only entry point for an isolated synthetic-location provider. */
public final class FixtureActivity extends Activity {
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    TextView label = new TextView(this);
    label.setText("QA synthetic location fixture. No physical location is recorded.");
    setContentView(label);
    Intent service = new Intent(this, LocationFixtureService.class);
    service.putExtras(getIntent());
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
  }
}
