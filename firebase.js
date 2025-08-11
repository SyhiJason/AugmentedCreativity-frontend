import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

// --- IMPORTANT: PASTE YOUR FIREBASE CONFIG HERE ---
// Replace this with the configuration object from your Firebase project settings.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/**
 * Gets the current user's authentication state.
 * @returns {Promise<User|null>} A promise that resolves with the user object or null.
 */
const getCurrentUser = () => {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    }, reject);
  });
};

/**
 * Signs in the user anonymously and returns the user object.
 * @returns {Promise<User>} A promise that resolves with the user object.
 */
const ensureAuthenticated = async () => {
  let user = auth.currentUser;
  if (!user) {
    await signInAnonymously(auth);
    user = await getCurrentUser();
  }
  return user;
};


/**
 * Fetches the Gemini API key from Firestore.
 * IMPORTANT: You must create a document in your Firestore with this structure:
 * Collection: 'configs' -> Document: 'api_keys' -> Field: 'gemini': 'YOUR_GEMINI_API_KEY'
 * @returns {Promise<string>} The Gemini API key.
 */
const getApiKey = async () => {
  try {
    const docRef = doc(db, "configs", "api_keys");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().gemini) {
      return docSnap.data().gemini;
    } else {
      console.error("API Key document not found in Firestore!");
      alert("Error: Gemini API Key not found in Firestore. Please check your configuration.");
      return null;
    }
  } catch (error) {
    console.error("Error fetching API key:", error);
    alert("Could not fetch API Key. The application may not function correctly.");
    return null;
  }
};

/**
 * Saves the user's goal structure to their document in Firestore.
 * @param {string} userId - The user's unique ID.
 * @param {object} data - The goal structure data to save.
 */
const saveData = async (userId, data) => {
  if (!userId) return;
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { goalStructure: data }, { merge: true });
  } catch (error) {
    console.error("Error saving data:", error);
  }
};

/**
 * Loads the user's goal structure from Firestore.
 * @param {string} userId - The user's unique ID.
 * @returns {Promise<object|null>} The user's data or null if not found.
 */
const loadData = async (userId) => {
  if (!userId) return null;
  try {
    const userDocRef = doc(db, "users", userId);
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      return docSnap.data().goalStructure;
    }
    return null;
  } catch (error) {
    console.error("Error loading data:", error);
    return null;
  }
};


export { auth, db, getApiKey, saveData, loadData, ensureAuthenticated };
