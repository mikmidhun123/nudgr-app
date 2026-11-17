// UI checks on explicitly selected local QA emulators. Never logs private fixture values.
const fs = require('node:fs');
const { ui, tap, run, pause } = require('./qa-device.cjs');
const option = name => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
async function find(text, predicate = node => node.text === text) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const node = ui().find(node => {
      const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(node.bounds || '');
      return predicate(node) && b && +b[4] > +b[2] && +b[3] > +b[1] && +b[4] < 1220;
    });
    if (node) return node;
    run('shell', 'input', 'swipe', '360', '700', '360', '300', '350'); await pause(350);
  }
  throw new Error(`Expected QA control was not visible: ${text}`);
}
async function main() {
  const action = option('--action');
  if (action === 'connect') {
    const accounts = JSON.parse(fs.readFileSync('tmp_check/hardening-accounts.json', 'utf8'));
    if (!accounts.recipient.connectionCode) throw new Error('Recipient QA profile is not ready.');
    tap(await find('My Connection')); await pause(600);
    const input = await find('connection code input', node => node.class === 'android.widget.EditText');
    tap(input); run('shell', 'input', 'text', accounts.recipient.connectionCode);
    run('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await pause(350);
    run('shell', 'input', 'swipe', '360', '700', '360', '300', '350'); await pause(350);
    tap(await find('Connect Peer')); await pause(4000);
    const rows = ui();
    if (!rows.some(node => node.text === 'Connected successfully!')) throw new Error('UI connection did not report success.');
    console.log('PASS: authenticated connection-by-code completed through the app UI.');
    return;
  }
  if (action === 'open-create') {
    run('shell', 'am', 'start', '-n', 'com.nudgr/.MainActivity'); await pause(500);
    if (!ui().some(node => node.text === 'Create a Nudgr')) {
      run('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await pause(350);
    }
    run('shell', 'input', 'swipe', '360', '350', '360', '1050', '350'); await pause(350);
    tap(await find('Create a Nudgr')); await pause(500);
    console.log('Opened the recipient Nudgr form.'); return;
  }
  if (action === 'create-tts') {
    tap(await find('QA recipient'));
    tap(await find('message input', node => node.class === 'android.widget.EditText'));
    run('shell', 'input', 'text', 'Arrival%sQA%sforeground%sdelivery');
    run('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await pause(350);
    tap(await find('Current Location')); await pause(1500);
    if (option('--outside') === 'true') {
      run('shell', 'am', 'start-foreground-service', '-n', 'com.nudgr.qalocation/.LocationFixtureService', '--es', 'latitude', '37.5', '--es', 'longitude', '-122.084');
      await pause(1500);
    }
    if (option('--voice') === 'true') {
      tap(await find('Record Personal Voice Note')); await pause(4500);
      tap(await find('Stop')); await pause(1000);
      if (!ui().some(node => node.text.startsWith('Voice note ready'))) throw new Error('Recording was not retained by the UI.');
    }
    if (option('--prepare') === 'true') { console.log('Prepared recipient and location; submission deferred.'); return; }
    const create = await find('Create Nudgr');
    tap(create); await pause(2000);
    console.log('Submitted a recipient Nudgr through the app UI.'); return;
  }
  if (action === 'resume-create') {
    const consent = ui().find(node => node.text === 'Turn on');
    if (consent) { tap(consent); await pause(4000); }
    tap(await find('Create Nudgr')); await pause(2000);
    console.log('Submitted the GPS recipient Nudgr.'); return;
  }
  if (action === 'pick-location') {
    for (let i = 0; i < 5; i++) run('shell', 'input', 'swipe', '360', '350', '360', '1050', '300');
    tap(await find('Current Location')); await pause(5000);
    console.log('Requested a fresh location from the sender emulator.'); return;
  }
  throw new Error('Choose an explicit QA flow action.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
