// Login + cloud sync. Each synced localStorage key is one Firestore doc users/<uid>/kv/<key> = { v: JSON text, t: ms };
// the newer t wins (last write wins). The rules in firestore.rules only let invited emails touch their own users/<uid>.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut, EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocsFromServer, setDoc, addDoc, deleteDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

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
export const SYNCED = /^(profiles|autoplay_prefs|(installed_addon_urls|addon_enabled_states|library|watch_progress|settings|shows|trakt|history_\d{4})_\w+)$/;
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

// Per-profile keys end in _<profileId>; profile ids never contain '_'.
export const profileOf = (k) => (/^(profiles|autoplay_prefs)$/.test(k) ? null : k.slice(k.lastIndexOf('_') + 1));

// Drop deleted profiles from a profiles list (never the last one). Returns raw unchanged when nothing goes.
export function pruneProfiles(raw, dead) {
  const p = JSON.parse(raw);
  const list = (p.list || []).filter((x) => !dead.has(x.id));
  if (!list.length || list.length === p.list.length) return raw;
  return JSON.stringify({ ...p, list, active: list.some((x) => x.id === p.active) ? p.active : list[0].id });
}

let uid = null;
const kv = (k) => doc(db, 'users', uid, 'kv', k);
// Tombstones: a deleted key becomes { v: null, t } in the cloud, so other PCs delete it too instead of re-uploading it.
// Deleting wins: once a profile id has a tombstone, its keys and its place in the profiles list never come back.
// shortcut: tombstones are never purged (a few bytes per deleted key); add a cleanup if profiles get deleted by the thousand.
const deadLocal = () => JSON.parse(localStorage.getItem('sync_dead') || '{}');
let dead = new Set(Object.keys(deadLocal()).map(profileOf).filter(Boolean));

function pull(k, v, t) {
  if (v === null) { localStorage.removeItem(k); dead.add(profileOf(k)); }
  else if (dead.has(profileOf(k))) return; // a stale copy of a deleted profile's data
  else if (k === 'profiles') {
    const merged = mergeProfiles(localStorage.getItem(k), v), pruned = pruneProfiles(merged, dead);
    localStorage.setItem(k, pruned);
    if (pruned !== merged) return push(k, pruned); // the cloud list still had a deleted profile: fix it there too
  } else localStorage.setItem(k, v);
  stamp(k, t);
}

export function push(k, raw) {
  if (!SYNCED.test(k) || !localStorage.getItem('sync_uid')) return;
  if (raw !== null && dead.has(profileOf(k))) return localStorage.removeItem(k); // a screen still open on a deleted profile
  const t = Date.now();
  stamp(k, t); // stamped even offline, so the next sync uploads this change instead of overwriting it
  if (!uid) return;
  setDoc(kv(k), { v: raw, t }).catch((e) => console.warn('sync push failed', k, e.code));
}

// A deleted profile's keys go from this PC and become tombstones in the cloud (uploaded on the next sync if offline now).
export function drop(k) {
  localStorage.removeItem(k);
  if (!SYNCED.test(k)) return;
  localStorage.setItem('sync_dead', JSON.stringify({ ...deadLocal(), [k]: Date.now() }));
  dead.add(profileOf(k));
  push(k, null);
}

function forget() {
  syncedKeys().forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem('sync_stamps');
  localStorage.removeItem('sync_dead');
  dead = new Set();
}

// First sync after login. Rejects with code 'permission-denied' when the email is not on the invite list.
async function start(user) {
  // read first: an account that isn't invited is refused here, before anything on this PC is touched
  const remote = new Map((await getDocsFromServer(collection(db, 'users', user.uid, 'kv'))).docs.map((d) => [d.id, d.data()]));
  if (localStorage.getItem('sync_uid') !== user.uid) {
    if (localStorage.getItem('sync_uid')) forget(); // another account used this PC: never mix its data into ours
    localStorage.setItem('sync_uid', user.uid);
  }
  uid = user.uid;
  const local = stamps(), gone = Object.keys(deadLocal());
  dead = new Set([...gone, ...[...remote].filter(([, r]) => r.v === null).map(([k]) => k)].map(profileOf).filter(Boolean));
  for (const k of new Set([...remote.keys(), ...syncedKeys(), ...gone])) {
    const r = remote.get(k);
    if (dead.has(profileOf(k))) { // deleting wins over any copy, older or newer
      localStorage.removeItem(k);
      if (r?.v !== null) push(k, null);
      continue;
    }
    const what = decide(local[k], r?.t, localStorage.getItem(k) != null);
    if (what === 'pull') pull(k, r.v, r.t);
    if (what === 'push') push(k, localStorage.getItem(k));
  }
  const p = localStorage.getItem('profiles'), pruned = p && pruneProfiles(p, dead);
  if (pruned !== p) { localStorage.setItem('profiles', pruned); push('profiles', pruned); }
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
    if (!user.emailVerified) return onOut(await gate(user));
    try { await start(user); onIn(user); }
    catch (e) {
      uid = null;
      // Offline or Firebase down: stay signed in on this PC's copy and sync once it answers. Only refusal (or a new account) signs out.
      if (keepOffline(e.code, localStorage.getItem('sync_uid') === user.uid)) { onIn(user); retry(user, onOut); }
      else { await signOut(auth); onOut(e.code || 'unknown'); }
    }
  });
}
// Sign-up is open to anyone, so an unverified account is checked here and never synced.
// Not invited: the account is deleted again. Invited: a confirmation link is (re)sent and it waits signed out.
async function gate(user) {
  const email = user.email.toLowerCase();
  const invited = await getDoc(doc(db, 'allowlist', email)).then((d) => d.exists(), () => null);
  if (invited === false) { await user.delete().catch(() => signOut(auth)); return 'not-invited'; }
  if (invited) await sendEmailVerification(user).catch(() => {}); // too-many-requests: the earlier link still works
  await signOut(auth);
  return invited ? 'unverified' : 'auth/network-request-failed';
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
export const signUp = (email, password) => createUserWithEmailAndPassword(auth, email, password); // watch() gates it
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
// "Forgot PIN?": proves the account password without signing out. Rejects on a wrong password.
export const checkPassword = (pw) => reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, pw));
export async function signOutAndForget() {
  await signOut(auth);
  forget();
  localStorage.removeItem('sync_uid');
}

// Invites (admin only; firestore.rules enforce it, these just call through). allowlist/<lowercase email> = { added: ms }.
export const isAdmin = () => (uid ? getDoc(doc(db, 'admins', uid)).then((d) => d.exists(), () => false) : Promise.resolve(false));
export const invites = async () => (await getDocsFromServer(collection(db, 'allowlist'))).docs.map((d) => d.id).sort();
export const invite = (email) => setDoc(doc(db, 'allowlist', email.trim().toLowerCase()), { added: Date.now() });
export const uninvite = (email) => deleteDoc(doc(db, 'allowlist', email));

// Diagnostics: reports/<auto id> = buildReport() + from. Any invited account sends; only the admin lists and deletes.
export const sendReport = (r) => addDoc(collection(db, 'reports'), { ...r, from: auth.currentUser?.email?.toLowerCase() ?? '' });
export const reports = async () => (await getDocsFromServer(collection(db, 'reports'))).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at);
export const deleteReport = (id) => deleteDoc(doc(db, 'reports', id));

// Friends: every invited account is a friend. people/<uid> = { name }, inbox/<uid>/items/<auto id>, activity/<uid> = { items }.
const listed = async (path) => (await getDocsFromServer(collection(db, path))).docs.filter((d) => d.id !== uid).map((d) => ({ uid: d.id, ...d.data() }));
export const myName = async () => (uid ? (await getDoc(doc(db, 'people', uid))).data()?.name ?? null : null);
export const setMyName = (name) => setDoc(doc(db, 'people', uid), { name });
export const friends = () => listed('people');
export const recommend = (to, item) => addDoc(collection(db, 'inbox', to, 'items'), { ...item, from: uid, at: Date.now() });
export const dismiss = (key) => deleteDoc(doc(db, 'inbox', uid, 'items', key));
// onChange(all, added): all = the inbox, newest first; added = items that arrived while listening (not the first load).
export function watchInbox(onChange) {
  let first = true;
  return onSnapshot(collection(db, 'inbox', uid, 'items'), (snap) => {
    const all = snap.docs.map((d) => ({ key: d.id, ...d.data() })).sort((a, b) => b.at - a.at);
    onChange(all, first ? [] : snap.docChanges().filter((c) => c.type === 'added').map((c) => ({ key: c.doc.id, ...c.doc.data() })));
    first = false;
  }, (e) => console.warn('inbox listen failed', e.code));
}
export const friendActivity = () => listed('activity');
export async function shareFinished(item) { // newest first, one entry per title, last 20
  const ref = doc(db, 'activity', uid), items = (await getDoc(ref)).data()?.items ?? [];
  await setDoc(ref, { items: [item, ...items.filter((x) => x.id !== item.id)].slice(0, 20) });
}
