// Checks the bundled JS/native bridge on a fresh installation; no account or network is required.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const option = name => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const serial = option('--serial') || process.env.ANDROID_SERIAL;
const adb = process.env.ADB || (process.env.ANDROID_HOME
  ? path.join(process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb');
const out = path.resolve(option('--output') || 'android-smoke-evidence'); fs.mkdirSync(out, { recursive: true });
const args = serial ? ['-s', serial] : [];
const run = (...cmd) => execFileSync(adb, [...args, ...cmd], { encoding: 'utf8', timeout: 30000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hierarchy = () => {
  run('shell', 'uiautomator', 'dump', '/sdcard/nudgr-smoke.xml');
  return run('shell', 'cat', '/sdcard/nudgr-smoke.xml');
};
async function main() {
  if (option('--apk')) run('install', '-r', path.resolve(option('--apk')));
  run('shell', 'pm', 'grant', 'com.nudgr', 'android.permission.POST_NOTIFICATIONS');
  run('shell', 'cmd', 'statusbar', 'collapse');
  run('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  run('logcat', '-c');
  run('shell', 'am', 'start', '-n', 'com.nudgr/.MainActivity');
  let xml = '', ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      xml = hierarchy();
      if ((xml.match(/class="android.widget.EditText"/g) || []).length >= 2 && /nudgr/i.test(xml)) { ready = true; break; }
      if (/Something went wrong/.test(xml)) throw new Error('Application error boundary is visible.');
    } catch (error) { if (/error boundary/.test(error.message)) throw error; }
    await pause(2000);
  }
  fs.writeFileSync(path.join(out, 'startup.xml'), xml);
  if (!ready) throw new Error('The fresh-install authentication screen did not render.');
  run('shell', 'input', 'swipe', '360', '1050', '360', '500', '350');
  await pause(500); xml = hierarchy();
  const login = [...xml.matchAll(/<node\b[^>]*>/g)].map(match => match[0])
    .filter(node => /text="(?:Sign in|Sign In|Log in|Log In|Login)"/.test(node)).at(-1);
  if (!login) throw new Error('Login control is missing.');
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(login);
  if (!bounds) throw new Error('Login control has no bounds.');
  run('shell', 'input', 'tap', String(Math.floor((+bounds[1] + +bounds[3]) / 2)), String(Math.floor((+bounds[2] + +bounds[4]) / 2)));
  await pause(1500); xml = hierarchy(); fs.writeFileSync(path.join(out, 'validation.xml'), xml);
  if (!xml.includes('Email and password are required.')) throw new Error('Empty login did not show validation.');
  const logs = run('logcat', '-d', '-v', 'brief', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E');
  fs.writeFileSync(path.join(out, 'runtime.log'), logs);
  if (/FATAL EXCEPTION|ReferenceError|TypeError|Invariant Violation/.test(logs)) throw new Error('Runtime errors were captured.');
  if (!run('shell', 'pidof', 'com.nudgr').trim()) throw new Error('Application process exited.');
  console.log('PASS: bundled app rendered authentication, validated an empty login, and stayed alive.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
