// Explicit local acceptance helper. Credentials come from an ignored fixture and are never logged.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const option = name => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const serial = option('--serial'), role = option('--role');
if (!serial?.startsWith('emulator-') || !['sender', 'recipient'].includes(role)) throw new Error('Choose an explicit QA emulator and role.');
const adb = path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk'), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 30000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'");
function nodes(xml) {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(match => Object.fromEntries(
    [...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(value => [value[1], decode(value[2])])));
}
function ui() {
  run('shell', 'rm', '-f', '/sdcard/nudgr-qa.xml');
  run('shell', 'uiautomator', 'dump', '/sdcard/nudgr-qa.xml');
  const xml = run('shell', 'cat', '/sdcard/nudgr-qa.xml');
  fs.writeFileSync(`tmp_check/qa-${role}-ui.xml`, xml);
  return nodes(xml);
}
function tap(node) {
  if (!node) throw new Error('Expected QA control was not visible.');
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(node.bounds || '');
  if (!match || +match[3] <= +match[1] || +match[4] <= +match[2]) throw new Error('QA control has no visible bounds.');
  run('shell', 'input', 'tap', String(Math.floor((+match[1] + +match[3]) / 2)), String(Math.floor((+match[2] + +match[4]) / 2)));
}
async function fill(hint, value) {
  let field = ui().find(node => node.class === 'android.widget.EditText' && (node.hint === hint || node.text === hint));
  if (!field) {
    run('shell', 'input', 'swipe', '360', '1050', '360', '450', '350'); await pause(400);
    field = ui().find(node => node.class === 'android.widget.EditText' && (node.hint === hint || node.text === hint));
  }
  tap(field);
  if (field.text && field.text !== hint) {
    run('shell', 'input', 'keycombination', '113', '29');
    run('shell', 'input', 'keyevent', 'KEYCODE_DEL');
  }
  if (!/^[a-zA-Z0-9 @._-]+$/.test(value)) throw new Error('Fixture contains unsupported input characters.');
  run('shell', 'input', 'text', value.replaceAll(' ', '%s'));
  await pause(300);
  // Close the IME directly. dumpsys input_method can itself hang on a cold AVD.
  run('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  run('shell', 'am', 'start', '-n', 'com.nudgr/.MainActivity');
  await pause(300);
}
async function main() {
  run('reverse', 'tcp:8088', 'tcp:8088');
  run('reverse', 'tcp:5008', 'tcp:5008');
  const fixture = JSON.parse(fs.readFileSync(option('--accounts') || 'tmp_check/hardening-accounts.json', 'utf8'))[role];
  if (!fixture?.email || !fixture.password) throw new Error('Private QA fixture is missing.');
  run('shell', 'am', 'start', '-n', 'com.nudgr/.MainActivity'); await pause(1000);
  let current = ui();
  const wait = current.find(node => node.text === 'Wait');
  if (wait) { tap(wait); await pause(1000); }
  run('shell', 'input', 'swipe', '360', '350', '360', '1150', '400'); await pause(400);
  current = ui();
  const signup = option('--signup') === 'true';
  if (signup) {
    tap(current.find(node => node.text === 'Create Account')); await pause(500);
  }
  run('shell', 'input', 'swipe', '360', '1050', '360', '450', '350'); await pause(400);
  if (signup) await fill('Your name', fixture.displayName);
  await fill('your@email.com', fixture.email);
  await fill(signup ? 'Min. 6 characters' : 'Your password', fixture.password);
  run('shell', 'input', 'swipe', '360', '760', '360', '300', '350'); await pause(400);
  current = ui();
  tap(current.filter(node => node.text === (signup ? 'Create Account' : 'Sign In')).at(-1));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await pause(1500); current = ui();
    if (current.some(node => node.text === 'Create a Nudgr')) {
      console.log(`PASS: ${role} ${signup ? 'signup' : 'login'} reached Home.`); return;
    }
    const error = current.find(node => /already exists|Something went wrong|Network error|Incorrect password|incorrect|permission-denied/i.test(node.text));
    if (error) throw new Error(`QA ${role} authentication did not complete: ${error.text}`);
  }
  throw new Error(`QA ${role} authentication did not reach Home before its deadline.`);
}
module.exports = { ui, tap, run, pause };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
