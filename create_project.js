const fs = require('fs');
const path = require('path');

// Create project directory
const projectDir = path.join('C:\\Users\\mikmi\\Desktop\\App', 'WakeMom');
if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
}

// Create package.json
const packageJson = {
    name: 'WakeMom',
    version: '1.0.0',
    main: 'App.js',
    scripts: {
        start: 'expo start',
        android: 'expo run:android',
        ios: 'expo run:ios'
    },
    dependencies: {
        'react': '18.3.1',
        'react-native': '0.76.7',
        'expo': '~52.0.35',
        'expo-status-bar': '~2.0.0'
    },
    devDependencies: {
        '@babel/react': '^7.0.0',
        'typescript': '^5.3.3'
    }
};

fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(packageJson, null, 2));

// Create app.json
const appJson = {
    expo: {
        name: 'Wake Mom',
        slug: 'wake-mom',
        version: '1.0.0',
        orientation: 'portrait',
        icon: './assets/icon.png',
        scheme: 'wake-mom',
        userInterfaceStyle: 'automatic',
        jsEngine: 'hermes',
        plugins: [],
        splash: {
            image: './assets/splash.png',
            resizeMode: 'contain',
            backgroundColor: '#ffffff'
        },
        updates: {
            fallbackToCacheTimeout: 0
        },
        assetBundlePatterns: ['**/*'],
        font: ['../node_modules/expo-font/fonts/*.ttf'],
        // Enable Android and iOS configurations
        android: {
            permissions: [],
            package: 'com.wake.mom',
            versionCode: 1
        },
        ios: {
            supportsTablet: true
        }
    }
};

fs.writeFileSync(path.join(projectDir, 'app.json'), JSON.stringify(appJson, null, 2));

// Create App.js
const appJs = `import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.center}>
      <Text>Wake Mom</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  }
});
`;

fs.writeFileSync(path.join(projectDir, 'App.js'), appJs);

// Create assets directory
const assetsDir = path.join(projectDir, 'assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

// Create android directory structure (basic)
const androidDir = path.join(projectDir, 'android');
if (!fs.existsSync(androidDir)) {
    fs.mkdirSync(androidDir, { recursive: true });
    // Create AndroidManifest.xml placeholder
    const androidManifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.wake.mom">
    <application
        android:allowBackup="true"
        android:label="Wake Mom"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:theme="@style/Theme.WakeMom">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;
    fs.writeFileSync(path.join(androidDir, 'AndroidManifest.xml'), androidManifest);
}

// Create android/app directory
const androidAppDir = path.join(androidDir, 'app');
if (!fs.existsSync(androidAppDir)) {
    fs.mkdirSync(androidAppDir, { recursive: true });
}

// Create android/build.gradle placeholder
const buildGradle = `buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradules:8.1.0'
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}`;
    fs.writeFileSync(path.join(androidDir, 'build.gradle'), buildGradle);
}

// Create android/gradle.properties placeholder
const gradleProps = `org.gradle.jvmargs=-Djava.awt.headless=true
sun.java.command=Main
android.enableJetifier=true
android.useAndroidX=true`;
    fs.writeFileSync(path.join(androidDir, 'gradle.properties'), gradleProps);

console.log('Project WakeMom created successfully at:', projectDir);