// Isolated build fixture. Never use these artifacts for distribution.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const project = 'demo-nudgr-ci';
const fixture = {
  project_info: { project_number: '123456789012', project_id: project, storage_bucket: `${project}.appspot.com` },
  client: [{ client_info: { mobilesdk_app_id: '1:123456789012:android:0123456789abcdef012345',
    android_client_info: { package_name: 'com.nudgr' } }, oauth_client: [],
  api_key: [{ current_key: `AIza${'A'.repeat(35)}` }], services: { appinvite_service: { other_platform_oauth_client: [] } } }],
  configuration_version: '1',
};
const targets = ['google-services.json', 'android/app/google-services.json'].map(file => path.join(root, file));
for (const file of targets) {
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).project_info?.project_id !== project) {
    throw new Error('Refusing to overwrite an existing non-CI Firebase configuration.');
  }
}
for (const file of targets) fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
console.log('Wrote demo-only Firebase build fixtures. Build with -PnudgrCiAuth=true.');
