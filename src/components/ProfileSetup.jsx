import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { uploadAvatar } from '../lib/storage';
import { isUsernameAvailable } from '../lib/profile';

function normalizeGooglePhotoURL(url, size = 64) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('googleusercontent.com')) {
      if (url.includes('=s')) return url.replace(/=s\d+(?:-[a-z])?/i, `=s${size}-c`);
      return `${url}=s${size}-c`;
    }
  } catch {}
  return url;
}

function initialFrom(s) {
  const v = (s || '').trim();
  return v ? v[0].toUpperCase() : 'U';
}

export default function ProfileSetup({ user, seedProfile, onComplete, onSignOut }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [username, setUsername] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [unameStatus, setUnameStatus] = useState({ state: 'idle', msg: '' });
  const [topImgError, setTopImgError] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);
  const [unameTimeout, setUnameTimeout] = useState(null);

  // Check if user already has a profile
  useEffect(() => {
    async function checkExistingProfile() {
      try {
        const profileDoc = await getDoc(doc(db, 'profiles', user.uid));
        if (profileDoc.exists() && profileDoc.data().setupComplete) {
          setHasProfile(true);
          onComplete?.(profileDoc.data());
          return;
        }
      } catch (error) {
        console.error('Error checking profile:', error);
      } finally {
        setCheckingProfile(false);
      }
    }

    checkExistingProfile();
  }, [user.uid, onComplete]);

  useEffect(() => {
    const gName = user.displayName || '';
    const gFirst = gName.split(' ')[0] || '';
    const gLast = gName.split(' ').slice(1).join(' ') || '';
    setFirst((prev) => prev || seedProfile.firstName || gFirst);
    setLast((prev) => prev || seedProfile.lastName || gLast);
  }, [user, seedProfile]);

  useEffect(() => {
    return () => {
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
      if (unameTimeout) clearTimeout(unameTimeout);
    };
  }, [preview, unameTimeout]);

  function onPick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return alert('Please choose an image');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function localUnameError(v) {
    const val = v.trim();
    if (val.length < 3 || val.length > 20) return '3–20 characters';
    if (!/^[a-zA-Z0-9_.-]+$/.test(val)) return 'Only letters, numbers, _, . or -';
    return '';
  }

  async function checkUname(v) {
    const val = v.trim();
    if (!val) {
      setUnameStatus({ state: 'idle', msg: '' });
      return;
    }

    const err = localUnameError(val);
    if (err) {
      setUnameStatus({ state: 'invalid', msg: err });
      return;
    }

    setUnameStatus({ state: 'checking', msg: 'Checking…' });
    
    try {
      const ok = await isUsernameAvailable(val);
      setUnameStatus(ok ? { state: 'ok', msg: 'Available' } : { state: 'taken', msg: 'Taken' });
    } catch (error) {
      setUnameStatus({ state: 'error', msg: 'Check failed' });
    }
  }

  function handleUsernameChange(value) {
    const formattedValue = value.replace(/\s+/g, '-');
    setUsername(formattedValue);

    // Clear previous timeout
    if (unameTimeout) clearTimeout(unameTimeout);

    // Set new timeout to check username after user stops typing (500ms delay)
    const timeout = setTimeout(() => {
      checkUname(formattedValue);
    }, 500);

    setUnameTimeout(timeout);

    // Immediate validation for basic format
    const immediateErr = localUnameError(formattedValue);
    if (immediateErr) {
      setUnameStatus({ state: 'invalid', msg: immediateErr });
    } else if (formattedValue) {
      setUnameStatus({ state: 'checking', msg: 'Checking…' });
    } else {
      setUnameStatus({ state: 'idle', msg: '' });
    }
  }

  const canSubmit = useMemo(
    () => first.trim().length >= 1 && username.trim().length >= 3 && unameStatus.state === 'ok' && !saving,
    [first, username, unameStatus.state, saving]
  );

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      setSaving(true);
      let photoURL = seedProfile.photoURL || user.photoURL || null;
      if (file) photoURL = await uploadAvatar(file, user.uid);

      const displayName = [first.trim(), last.trim()].filter(Boolean).join(' ');
      const data = {
        uid: user.uid,
        email: user.email || null,
        displayName,
        firstName: first.trim(),
        lastName: last.trim(),
        username: username.trim(),
        usernameLower: username.trim().toLowerCase(),
        photoURL,
        setupComplete: true,
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'profiles', user.uid), data, { merge: true });
      onComplete?.(data);
    } catch (e) {
      alert(e.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  const rawTopUrl = user.photoURL || seedProfile.photoURL || '';
  const topRightUrl = normalizeGooglePhotoURL(rawTopUrl, 64);
  const topRightInitial = initialFrom(user.displayName || user.email);

  // Show loading state while checking profile
  if (checkingProfile) {
    return (
      <div className="relative flex min-h-screen flex-col bg-[#101a23] text-gray-200 items-center justify-center" style={{ fontFamily: 'Inter, Noto Sans, sans-serif' }}>
        <div className="flex items-center gap-3 text-white mb-4">
          <img src="/logo-swiftly.svg" className="h-8 w-8" alt="Swiftly" />
          <h1 className="text-white text-2xl font-bold tracking-[-0.015em]">Swiftly</h1>
        </div>
        <p className="text-gray-400">Checking your profile...</p>
      </div>
    );
  }

  // If user already has a profile, show a brief message before redirecting
  if (hasProfile) {
    return (
      <div className="relative flex min-h-screen flex-col bg-[#101a23] text-gray-200 items-center justify-center" style={{ fontFamily: 'Inter, Noto Sans, sans-serif' }}>
        <div className="flex items-center gap-3 text-white mb-4">
          <img src="/logo-swiftly.svg" className="h-8 w-8" alt="Swiftly" />
          <h1 className="text-white text-2xl font-bold tracking-[-0.015em]">Swiftly</h1>
        </div>
        <p className="text-gray-400">Welcome back! Redirecting to chat...</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-[#101a23] text-gray-200" style={{ fontFamily: 'Inter, Noto Sans, sans-serif' }}>
      <header className="flex items-center justify-between whitespace-nowrap border-b border-[#223749] px-4 sm:px-10 py-3">
        <div className="flex items-center gap-3 text-white">
          <img src="/logo-swiftly.svg" className="h-6 w-6" alt="Swiftly" />
          <h1 className="text-white text-xl font-bold tracking-[-0.015em]">Swiftly</h1>
        </div>
        <div className="flex items-center gap-4">
          <p className="hidden sm:block text-sm text-gray-400">
            Authenticated as {user.displayName || user.email}
          </p>
          {topRightUrl && !topImgError ? (
            <img
              src={topRightUrl}
              alt="Google avatar"
              className="h-10 w-10 rounded-full object-cover ring-2 ring-[#101a23]"
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={() => setTopImgError(true)}
            />
          ) : (
            <div className="h-10 w-10 rounded-full bg-white/10 grid place-items-center text-sm font-semibold ring-2 ring-[#101a23]">
              {topRightInitial}
            </div>
          )}
          <button onClick={onSignOut} className="text-xs text-gray-400 hover:text-white">Sign out</button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center py-10 px-4">
        <div className="flex w-full max-w-lg flex-col items-center rounded-2xl bg-[#182834] p-6 sm:p-10 shadow-2xl">
          <div className="text-center mb-8">
            <h2 className="text-white text-3xl font-bold">Welcome to Swiftly!</h2>
            <p className="text-gray-400 text-base mt-2">Let&apos;s get your profile set up.</p>
          </div>

          <div className="w-full space-y-6">
            {/* Upload placeholder (original design) */}
            <div className="flex items-center justify-center">
              <label className="relative cursor-pointer group" htmlFor="profile-picture-upload">
                <div className="h-32 w-32 rounded-full bg-[#101a23] flex items-center justify-center border-2 border-dashed border-[#314f68] group-hover:border-[var(--primary-color)] transition-colors">
                  {preview ? (
                    <img src={preview} alt="Preview" className="h-32 w-32 rounded-full object-cover" />
                  ) : (
                    <span
                      className="material-symbols-outlined text-gray-500 group-hover:text-[var(--primary-color)] transition-colors leading-none"
                      style={{ fontSize: 44 }}
                    >
                      add_a_photo
                    </span>
                  )}
                </div>
                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <p className="text-white text-xs font-bold text-center">Upload Photo</p>
                </div>
              </label>
              <input className="hidden" id="profile-picture-upload" type="file" accept="image/*" onChange={onPick} />
            </div>

            {/* Names */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-white text-sm font-medium" htmlFor="first-name">First Name</label>
                <input
                  id="first-name"
                  value={first}
                  onChange={(e) => setFirst(e.target.value)}
                  placeholder="e.g. John"
                  className="form-input mt-1 w-full rounded-md text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] border border-[#314f68] bg-[#101a23] h-12 placeholder:text-gray-500 px-4 text-base"
                />
              </div>
              <div>
                <label className="text-white text-sm font-medium" htmlFor="last-name">Last Name</label>
                <input
                  id="last-name"
                  value={last}
                  onChange={(e) => setLast(e.target.value)}
                  placeholder="e.g. Appleseed"
                  className="form-input mt-1 w-full rounded-md text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] border border-[#314f68] bg-[#101a23] h-12 placeholder:text-gray-500 px-4 text-base"
                />
              </div>
            </div>

            {/* Username */}
            <div>
              <label className="text-white text-sm font-medium" htmlFor="username">Username</label>
              <div className="relative mt-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <span className="text-gray-500 sm:text-sm">@</span>
                </div>
                <input
                  id="username"
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  placeholder="your-unique-username"
                  className="form-input w-full rounded-md text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] border border-[#314f68] bg-[#101a23] h-12 placeholder:text-gray-500 px-4 pl-7 text-base"
                />
              </div>
              <div className="mt-1 text-xs">
                {unameStatus.state === 'checking' && <span className="text-gray-400">Checking…</span>}
                {unameStatus.state === 'ok' && <span className="text-emerald-400">Available</span>}
                {unameStatus.state === 'taken' && <span className="text-red-400">Taken</span>}
                {unameStatus.state === 'invalid' && <span className="text-orange-400">{unameStatus.msg}</span>}
                {unameStatus.state === 'error' && <span className="text-red-400">Check failed</span>}
                <p className="text-gray-500 mt-1">This will be your unique identifier on Swiftly.</p>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex w-full items-center justify-center rounded-md h-12 px-4 bg-[var(--primary-color)] text-white text-base font-bold tracking-wide hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Complete Profile'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}