const { exec } = require('child_process');
exec('C:\Program Files\nodejs\npm install -g expo-cli', { cwd: 'C:\\Users\\mikmi\\Desktop\\App' }, (error, stdout, stderr) => {
  if (error) {
    console.error(`exec error: ${error.message}`);
    return;
  }
  console.log(`stdout: ${stdout}`);
  console.log(`stderr: ${stderr}`);
});