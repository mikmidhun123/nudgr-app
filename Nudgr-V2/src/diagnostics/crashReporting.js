import { NativeModules } from 'react-native';
import { getCrashlytics, recordError } from '@react-native-firebase/crashlytics';

// Release activation is explicit. QA, CI and the unsigned candidate keep collection off.
export function reportUiError(error) {
  if (NativeModules.NudgrNativeModule?.crashReportingEnabled !== true) return;
  try { recordError(getCrashlytics(), error); }
  catch (_) { /* Reporting must never prevent recovery from the original UI error. */ }
}
