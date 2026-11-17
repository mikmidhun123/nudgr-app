import { firebase } from '@react-native-firebase/app';
import firestore from '@react-native-firebase/firestore';
import '@react-native-firebase/auth';
import '@react-native-firebase/messaging';
import { NativeModules } from 'react-native';
export const isQaBuild = NativeModules.NudgrNativeModule?.qaBuild === true;

export const getApp = () => firebase.app();
export const getAuth = () => firebase.auth();
export const getFirestore = () => firebase.firestore();
export const getMessaging = () => firebase.messaging();

/**
 * Returns a sentinel for the server timestamp using React Native Firebase's FieldValue.
 */
export const getServerTimestamp = () => firestore.FieldValue.serverTimestamp();

/**
 * Returns a sentinel for deleting a field in Firestore.
 */
export const getFieldDelete = () => firestore.FieldValue.delete();

const log = (tag, value) => {
  if (__DEV__) {
    console.log(`[Firebase:${tag}]`, value);
  }
};

export function attachFirebaseFoundation() {
  const app = getApp();
  log('app', app.name);

  return app;
}
