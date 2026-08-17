const { exec } = require('child_process');
exec('npx expo init WakeMom --template expo-template-blank', { cwd: 'C:\\Users\\mikmi\\Desktop\\App' }, (error, stdout, stderr) => {
  if (error) {
    console.error(`exec error: ${error.message}`);
    return;
  }
  console.log(`stdout: ${stdout}`);
  console.log(`stderr: ${stderr}`);
});