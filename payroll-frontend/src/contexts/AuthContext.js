import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let didCancel = false;
    const getInitialSession = async () => {
      setLoading(true);
      setAuthError('');
      const { data: { session }, error } = await supabase.auth.getSession();
      if (didCancel) return;
      if (error || !session) {
        setUser(null);
        setRole(null);
        setLoading(false);
        setAuthError('No session found. Please log in.');
        return;
      }
      setUser(session.user);
      // Try to load role from `user_roles` table instead of hardcoding
      try {
        const { data: roleData, error: roleError } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .single();
        if (roleError || !roleData) {
          setRole(null);
        } else {
          setRole(roleData.role ?? null);
        }
      } catch (err) {
        setRole(null);
      }
      setLoading(false);
    };
    getInitialSession();
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        // Load role for the signed-in user
        try {
          const { data: roleData, error: roleError } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', session.user.id)
            .single();
          if (roleError || !roleData) {
            setRole(null);
          } else {
            setRole(roleData.role ?? null);
          }
        } catch (err) {
          setRole(null);
        }
      } else {
        setRole(null);
        setLoading(false);
      }
    });
    return () => {
      didCancel = true;
      subscription.unsubscribe();
    };
  }, []);

  const logout = async (onSuccess) => {
    try {
      setUser(null);
      setRole(null);
      setLoading(false);
      setAuthError('');
      await supabase.auth.signOut();
      if (typeof onSuccess === 'function') {
        onSuccess();
      }
    } catch (error) {
      setAuthError('Error during logout: ' + error.message);
      setLoading(false);
    }
  };

  const contextValue = {
    user,
    role,
    loading,
    logout,
    authError,
  };
  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 