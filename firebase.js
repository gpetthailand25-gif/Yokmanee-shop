// firebase.js
// การตั้งค่าเชื่อมต่อ Firebase — เอาค่าจริงมาจาก Firebase Console
// Project Settings > General > Your apps > SDK setup and configuration

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyC7KO82gNgJJDFK8zBUaVFOQPAXuzcOPv8",
  authDomain: "yokmanee-shop.firebaseapp.com",
  projectId: "yokmanee-shop",
  storageBucket: "yokmanee-shop.firebasestorage.app",
  messagingSenderId: "1005934411766",
  appId: "1:1005934411766:web:8ea01c6f963c826ad3d1d7",
  measurementId: "G-C7FFW84M26",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
