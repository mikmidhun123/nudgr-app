# Isolated emulator location fixture

This optional test app publishes synthetic positions through Google Play Services' Fused Location Provider. It runs separately so Nudgr can be backgrounded or killed during acceptance checks. Its components require the shell's `DUMP` permission and a mock-location app-op. It is not included in the Nudgr APK or AAB.

Build from `Nudgr-V2/android`:

```powershell
.\gradlew.bat --init-script ..\tools\location-fixture\include.gradle :qa-location-fixture:assembleDebug --max-workers=1
```

Use only explicitly selected temporary emulators. Install the resulting fixture APK, grant coarse/fine/background location and notifications, then set:

```text
adb -s emulator-5558 shell appops set com.nudgr.qalocation android:mock_location allow
adb -s emulator-5558 shell am start -n com.nudgr.qalocation/.FixtureActivity --es latitude 37.5 --es longitude -122.084
```

Return to Nudgr after the fixture starts. Update the position without opening its activity:

```text
adb -s emulator-5558 shell am start-foreground-service -n com.nudgr.qalocation/.LocationFixtureService --es latitude 37.422 --es longitude -122.084
```

The service refreshes timestamps every second at the requested point. `37.5,-122.084` is outside a 5 km fence centered at `37.422,-122.084`; the center itself is inside. These are synthetic coordinates, not physical GPS evidence.

Stop the fixture with `adb shell am stopservice -n com.nudgr.qalocation/.LocationFixtureService`. Stop/remove it after testing. The production app has no mock-location receiver or test hook.
