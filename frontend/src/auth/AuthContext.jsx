import PropTypes from 'prop-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from 'firebase/auth';

import { auth } from './firebase';

/**
 * AuthContext exposes the current Firebase user, loading state, and helpers for
 * sign-in / sign-out. It subscribes to onAuthStateChanged so any consumer of
 * `useAuth()` re-renders when the user signs in elsewhere or the session expires.
 *
 * Shape:
 *   {
 *     user:    firebase.User | null,
 *     status:  'loading' | 'authenticated' | 'unauthenticated',
 *     signIn:  ({ email, password }) => Promise<UserCredential>,
 *     signOut: () => Promise<void>,
 *     getIdToken: (forceRefresh?: boolean) => Promise<string | null>,
 *   }
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setStatus(next ? 'authenticated' : 'unauthenticated');
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(({ email, password }) => {
    return signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  const getIdToken = useCallback(
    async (forceRefresh = false) => {
      if (!auth.currentUser) return null;
      try {
        return await auth.currentUser.getIdToken(forceRefresh);
      } catch {
        return null;
      }
    },
    []
  );

  const value = useMemo(
    () => ({ user, status, signIn, signOut, getIdToken }),
    [user, status, signIn, signOut, getIdToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

AuthProvider.propTypes = { children: PropTypes.node };

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
