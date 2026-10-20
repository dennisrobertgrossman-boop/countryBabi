// Firebase project settings for the online features (Google sign-in, profile, friends,
// leaderboard, challenges). While this is null the game runs offline, as a guest only.
//
// To turn the features on, replace null with the "firebaseConfig" object from
// Firebase console → Project settings → General → Your apps → Web app, for example:
//
// export const FIREBASE_CONFIG = {
//   apiKey: '…',
//   authDomain: 'your-project.firebaseapp.com',
//   projectId: 'your-project',
//   storageBucket: 'your-project.firebasestorage.app',
//   messagingSenderId: '…',
//   appId: '…',
// };
//
// These values identify the project; they are not passwords. Access is controlled by
// the sign-in settings and by the database rules in firestore.rules.
export const FIREBASE_CONFIG = null;
