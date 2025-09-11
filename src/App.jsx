import { useEffect, useState } from 'react';
import { auth, db, makeGoogleProvider } from './lib/firebase';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { setupPresence, updatePresence } from './lib/presence';

import SignIn from './components/SignIn';
import ProfileSetup from './components/ProfileSetup';
import ChatShell from './components/ChatShell';

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const ref = doc(db, 'profiles', u.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          const dn = u.displayName || '';
          const [firstName, ...rest] = dn.split(' ');
          const lastName = rest.join(' ');
          await setDoc(ref, {
            uid: u.uid,
            email: u.email || null,
            displayName: dn || null,
            firstName: firstName || '',
            lastName: lastName || '',
            photoURL: u.photoURL || null,
            setupComplete: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            privacy: { showOnline: true, showReadReceipts: true },
          }, { merge: true });
          const fresh = await getDoc(ref);
          setProfile(fresh.data());
        } else {
          setProfile(snap.data());
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;

    setupPresence(user.uid);
    updatePresence(user.uid, 'online');

    const toOnline = () => updatePresence(user.uid, 'online');
    const toAway = () => updatePresence(user.uid, 'away');
    const toOffline = () => updatePresence(user.uid, 'offline');

    const onVis = () =>
      updatePresence(user.uid, document.visibilityState === 'visible' ? 'online' : 'away');

    window.addEventListener('focus', toOnline);
    window.addEventListener('blur', toAway);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', toOffline);

    // Optional: reflect network connectivity
    const onOnline = () => toOnline();
    const onOffline = () => toAway();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      toAway();
      window.removeEventListener('focus', toOnline);
      window.removeEventListener('blur', toAway);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', toOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [user?.uid]);

  const signInGoogle = async () => {
    try {
      const provider = makeGoogleProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error('Google sign-in failed:', e);
      alert(e.message || 'Sign-in failed');
    }
  };

  if (loading) return <div className="h-screen grid place-items-center text-slate-400">Loading…</div>;
  if (!user) return <SignIn onGoogle={signInGoogle} />;

  if (!profile || !profile.setupComplete) {
    return (
      <ProfileSetup
        user={user}
        seedProfile={profile || {}}
        onComplete={(p) => setProfile(p)}
        onSignOut={() => signOut(auth)}
      />
    );
  }

  return <ChatShell 
  me={user} 
  meProfile={profile} 
  onLogout={() => signOut(auth)} // This should be passed correctly
/>;
}