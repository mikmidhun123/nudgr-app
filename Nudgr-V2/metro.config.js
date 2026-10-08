const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
// Backend dependencies and generated native/IDE files are never application modules.
const excluded = ['tmp_check', 'functions', 'android/build', 'android/app/build', 'android/app/.cxx', 'android/.gradle']
  .map(directory => new RegExp('^' + path.resolve(__dirname, directory).replace(/[^a-zA-Z0-9 _:-]/g, '\\$&') + '[/\\\\].*'));
config.resolver.blockList = [config.resolver.blockList, ...excluded].flat().filter(Boolean);
module.exports = config;
