import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBclouv8Hot0kKiykpGjEjMw7yKsGXQjGI",
  authDomain: "projetoafiliado-9ff07.firebaseapp.com",
  projectId: "projetoafiliado-9ff07",
  storageBucket: "projetoafiliado-9ff07.firebasestorage.app",
  messagingSenderId: "977662411284",
  appId: "1:977662411284:web:dc8c0b82ccfa82dfa41d01",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
