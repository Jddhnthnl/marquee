// Login + cloud sync. Each synced localStorage key is one Firestore doc users/<uid>/kv/<key> = { v: JSON text, t: ms };
// the newer t wins (last write wins). The rules in firestore.rules only let invited emails touch their own users/<uid>.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, setDoc, deleteDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

// Web config only names the project; it is public by design.
const fb = initializeApp({
  apiKey: 'AIzaSyAwV70-3AEnmCnAnxGOoJvfDgmVOz_hU74',
  authDomain: 'marquee-9dd1d.firebaseapp.com',
  projectId: 'marquee-9dd1d',
  appId: '1:620468741059:web:dd094d2a8db216cd27d376',
});
const auth = getAuth(fb);
const db = getFirestore(fb);

// Player fit/volume stay per device on purpose.
export const SYNCED = /^(profiles|autoplay_prefs|(installed_addon_urls|addon_enabled_states|library|watch_progress|settings)_\w+)$/;
const stamps = () => JSON.parse(localStorage.getItem('sync_stamps') || '{}');
const stamp = (k, t) => localStorage.setItem('sync_stamps', JSON.stringify({ ...stamps(), [k]: t }));
const syncedKeys = () => Object.keys(localStorage).filter((k) => SYNCED.test(k));

// Which copy of one key wins: 'pull' (remote newer), 'push' (only/newer local), or null (same).
export function decide(localT, remoteT, hasLocal) {
  if (remoteT != null && remoteT > (localT ?? 0)) return 'pull';
  if (hasLocal && (remoteT == null || (localT ?? 0) > remoteT)) return 'push';
  return null;
}

// The active profile is a per-device choice; keep ours if it still exists in the incoming list.
export function mergeProfiles(localRaw, remoteRaw) {
  const remote = JSON.parse(remoteRaw);
  const active = JSON.parse(localRaw || 'null')?.active;
  return JSON.stringify(remote.list?.some((p) => p.id === active) ? { ...remote, active } : remote);
}

let uid = null;
const kv = (k) => doc(db, 'users', uid, 'kv', k);

function pull(k, v, t) {
  localStorage.setItem(k, k === 'profiles' ? mergeProfiles(localStorage.getItem(k), v) : v);
  stamp(k, t);
}

export function push(k, raw) {
  if (!SYNCED.test(k) || !localStorage.getItem('sync_uid')) return;
  const t = Date.now();
  stamp(k, t); // stamped even offline, so the next sync uploads this change instead of overwriting it
  if (!uid) return;
  setDoc(kv(k), { v: raw, t }).catch((e) => console.warn('sync push failed', k, e.code));
}

// A deleted profile's keys go from this PC and the cloud, so the next sign-in doesn't pull them back.
export function drop(k) {
  localStorage.removeItem(k);
  if (uid && SYNCED.test(k)) deleteDoc(kv(k)).catch((e) => console.warn('sync delete failed', k, e.code));
}

function forget() {
  syncedKeys().forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem('sync_stamps');
}

// First sync after login. Rejects with code 'permission-denied' when the email is not on the invite list.
async function start(user) {
  // read first: an account that isn't invited is refused here, before anything on this PC is touched
  const remote = new Map((await getDocs(collection(db, 'users', user.uid, 'kv'))).docs.map((d) => [d.id, d.data()]));
  if (localStorage.getItem('sync_uid') !== user.uid) {
    if (localStorage.getItem('sync_uid')) forget(); // another account used this PC: never mix its data into ours
    localStorage.setItem('sync_uid', user.uid);
  }
  uid = user.uid;
  const local = stamps();
  for (const k of new Set([...remote.keys(), ...syncedKeys()])) {
    const r = remote.get(k);
    const what = decide(local[k], r?.t, localStorage.getItem(k) != null);
    if (what === 'pull') pull(k, r.v, r.t);
    if (what === 'push') push(k, localStorage.getItem(k));
  }
  // Live changes from the user's other devices show up on the next screen; our own writes echo back with an equal t and are skipped.
  stopListening = onSnapshot(collection(db, 'users', uid, 'kv'), (snap) => {
    snap.docChanges().forEach(({ doc: d }) => {
      const r = d.data();
      if (decide(stamps()[d.id], r.t, true) === 'pull') pull(d.id, r.v, r.t);
    });
  }, (e) => console.warn('sync listen failed', e.code));
}
let stopListening = () => {};

// onIn(user) after the first sync, onOut(errorCode?) when signed out or refused.
export function watch(onIn, onOut) {
  onAuthStateChanged(auth, async (user) => {
    stopListening();
    if (!user) { uid = null; return onOut(); }
    try { await start(user); onIn(user); }
    catch (e) {
      uid = null;
      // Offline or Firebase down: stay signed in on this PC's copy and sync once it answers. Only refusal (or a new account) signs out.
      if (keepOffline(e.code, localStorage.getItem('sync_uid') === user.uid)) { onIn(user); retry(user, onOut); }
      else { await signOut(auth); onOut(e.code || 'unknown'); }
    }
  });
}
export const keepOffline = (code, sameAccount) => sameAccount && code !== 'permission-denied';
let retryTimer = 0;
function retry(user, onOut) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(async () => {
    if (auth.currentUser?.uid !== user.uid) return; // signed out meanwhile
    try { await start(user); }
    catch (e) { if (keepOffline(e.code, true)) retry(user, onOut); else { uid = null; await signOut(auth); onOut(e.code); } }
  }, 30000);
}

export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export async function signOutAndForget() {
  await signOut(auth);
  forget();
  localStorage.removeItem('sync_uid');
}
