import { db } from './firebase';
import {
  doc, getDoc, setDoc, serverTimestamp,
  query, collection, where, getDocs
} from 'firebase/firestore';

export async function ensureProfileDoc(user) {
  const ref = doc(db, 'profiles', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const displayName = user.displayName || '';
    const [firstName, ...rest] = displayName.split(' ');
    const lastName = rest.join(' ');
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || null,
      displayName: displayName || null,
      firstName: firstName || '',
      lastName: lastName || '',
      photoURL: user.photoURL || null,
      setupComplete: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      privacy: { showOnline: true, showReadReceipts: true },
    }, { merge: true });
  }
}

export async function isUsernameAvailable(name) {
  const uname = (name || '').trim().toLowerCase();
  if (!uname) return false;
  const q = query(collection(db, 'profiles'), where('usernameLower', '==', uname));
  const snap = await getDocs(q);
  return snap.empty;
}