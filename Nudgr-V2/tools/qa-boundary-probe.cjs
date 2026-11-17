// Self-targeted live FCM checks on the explicitly created QA account only.
const fs = require('node:fs');
const option = name => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
async function main() {
  if (!process.argv.includes('--live-fcm')) throw new Error('Explicit --live-fcm is required.');
  const kind = option('--kind');
  if (!['foreign', 'expired', 'duplicate'].includes(kind)) throw new Error('Choose a boundary probe kind.');
  const account = JSON.parse(fs.readFileSync('tmp_check/hardening-accounts.json', 'utf8')).recipient;
  if (!/^qa-recipient-[a-f0-9]+@nudgr\.example$/.test(account.email)) throw new Error('Only the temporary QA recipient may be targeted.');
  const config = JSON.parse(fs.readFileSync('google-services.json', 'utf8'));
  const apiKey = config.client.find(client => client.client_info.android_client_info.package_name === 'com.nudgr').api_key[0].current_key;
  const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
    signal: AbortSignal.timeout(20000),
  });
  if (!login.ok) throw new Error('QA-only authentication failed.');
  const identity = await login.json();
  if (identity.localId !== account.uid) throw new Error('The QA identity changed; refresh the private fixture.');
  const response = await fetch('http://127.0.0.1:5008/qa/probe', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.idToken}` },
    body: JSON.stringify({ kind, nudgeId: option('--nudge') }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || result.accepted !== 1 || result.failed !== 0) throw new Error(`QA probe was not accepted: ${result.code || response.status}`);
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
