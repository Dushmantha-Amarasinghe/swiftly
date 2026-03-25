# Swiftly

Swiftly is a real-time chat web application built with React + Vite.
It combines Firebase (Auth, Firestore, Realtime Database, Messaging) with Supabase Storage for media delivery and persistence.

## Proprietary Notice

This project is proprietary software.
All rights are reserved.

You may not copy, redistribute, sublicense, modify for resale, or use this codebase outside authorized internal/team use without explicit written permission from the project owner.

## Core Features

- Google authentication and profile bootstrap
- Mandatory first-time profile setup with username availability validation
- Real-time 1:1 and group chat flows
- Presence system (online, away, offline) backed by Firebase Realtime Database
- Typing indicators per room
- Message reactions and edit/delete flows
- Media handling for image, audio, and avatar uploads via Supabase Storage
- Background and foreground push notification plumbing via Firebase Cloud Messaging (FCM)
- Offline-oriented cache helpers using LocalForage for data/media reuse
- Responsive chat shell with mobile-specific interactions

## Tech Stack

- Frontend: React 19, Vite
- Styling: Tailwind CSS 4 + custom CSS
- Auth and data: Firebase Auth, Firestore, Realtime Database
- Push notifications: Firebase Cloud Messaging
- Media storage: Supabase Storage (via @supabase/supabase-js)
- Client caching: localforage

## Project Structure

- src/App.jsx: auth bootstrap, profile flow, app shell routing
- src/components/ChatShell.jsx: main chat UI and room/message interactions
- src/components/ProfileSetup.jsx: user onboarding and username checks
- src/components/SignIn.jsx: sign-in view and Google auth trigger
- src/lib/firebase.js: Firebase client initialization
- src/lib/supabase.js: Supabase client initialization
- src/lib/presence.js: online/offline/typing state logic
- src/lib/storage.js: media upload and deletion utilities
- src/lib/notifications.js: browser permission + FCM token update
- public/firebase-messaging-sw.js: service worker for background notifications

## Prerequisites

- Node.js 20+
- npm 10+
- A Firebase project configured for Auth/Firestore/RTDB/Cloud Messaging
- A Supabase project with a storage bucket named media

## Local Setup

1. Install dependencies.

	npm install

2. Create a local environment file named .env.local in the project root.

3. Add the required Vite variables.

	VITE_FIREBASE_API_KEY=
	VITE_FIREBASE_AUTH_DOMAIN=
	VITE_FIREBASE_PROJECT_ID=
	VITE_FIREBASE_STORAGE_BUCKET=
	VITE_FIREBASE_MESSAGING_SENDER_ID=
	VITE_FIREBASE_APP_ID=
	VITE_FIREBASE_DB_URL=
	VITE_FIREBASE_VAPID_KEY=
	VITE_SUPABASE_URL=
	VITE_SUPABASE_ANON_KEY=

4. Create a local-only service worker Firebase config file at public/firebase-sw-config.json.

	{
	  "apiKey": "",
	  "authDomain": "",
	  "databaseURL": "",
	  "projectId": "",
	  "storageBucket": "",
	  "messagingSenderId": "",
	  "appId": ""
	}

5. Start the app.

	npm run dev

## Scripts

- npm run dev: start local dev server
- npm run build: production build
- npm run preview: preview production build locally
- npm run lint: run ESLint checks

## Security and Secret Handling

- Do not commit any real credentials to source files.
- .env files are ignored by git.
- public/firebase-sw-config.json is ignored by git.
- Service worker config is loaded at runtime from the ignored JSON file.
- Keep production keys in your deployment platform secrets or CI/CD secret store.

## Deployment Notes

- Ensure all Vite env vars are provided in the deployment environment.
- Ensure public/firebase-sw-config.json is generated during deployment from secure secrets (or injected by your hosting pipeline).
- If service worker config is missing, background push notifications will stay disabled by design.

## Current Status

This README is aligned with the current codebase modules and repository layout as of March 2026.
