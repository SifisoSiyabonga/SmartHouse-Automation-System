// Firebase connection for the Smart Home website.
// Paste YOUR firebaseConfig here (copy it from Project settings -> Your apps -> Config).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDcGZNiC3919COGfoU-joLntl9cxUjzioc",
  authDomain: "smarthome-55c42.firebaseapp.com",
  databaseURL: "https://smarthome-55c42-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "smarthome-55c42",
  storageBucket: "smarthome-55c42.firebasestorage.app",
  messagingSenderId: "373924647429",
  appId: "1:373924647429:web:c6cfacaf8746d345e0426c"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getDatabase(app);

// Turns Firebase error codes into simple messages
export function niceError(err) {
  const map = {
    "auth/invalid-email": "That email address is not valid.",
    "auth/missing-password": "Please enter your password.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "No account with that email. Register first.",
    "auth/email-already-in-use": "An account with this email already exists. Log in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many tries. Wait a minute and try again.",
    "auth/network-request-failed": "No internet connection.",
    "auth/operation-not-allowed": "Email/Password login is not enabled in Firebase Authentication."
  };
  return map[err && err.code] || (err && err.message) || "Something went wrong.";
}
