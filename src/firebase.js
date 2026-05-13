import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDRO0Q_bJJgzofs3IXAbODD-gXtEYsmpdI",
  authDomain: "pinewood-derby-ed016.firebaseapp.com",
  databaseURL: "https://pinewood-derby-ed016-default-rtdb.firebaseio.com",
  projectId: "pinewood-derby-ed016",
  storageBucket: "pinewood-derby-ed016.firebasestorage.app",
  messagingSenderId: "1063151776355",
  appId: "1:1063151776355:web:57fd09104bbe85e440be56"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
