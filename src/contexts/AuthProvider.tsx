import { useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, ssoClaims } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import posthog from 'posthog-js';
import { AuthContext } from './AuthContext';

// Build an absolute, same-frontend redirect URL for Supabase auth emails / OAuth.
// Uses the current origin + Vite base path so links return to whichever Brepia
// frontend initiated them rather than falling back to a project-level Site URL.
function getAppRedirectUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  return `${window.location.origin}${basePath}${path}`;
}

const ensurePermission = async () => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(
    typeof window === 'undefined'
      ? null
      : JSON.parse(localStorage.getItem('session') ?? 'null'),
  );
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const posthogSent = useRef(false);
  const queryClient = useQueryClient();

  // Initialize auth state and set up session listener
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.refreshSession();
        setSession(session);
        localStorage.setItem('session', JSON.stringify(session));
        setUser(session?.user ?? null);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      localStorage.setItem('session', JSON.stringify(session));
      setUser(session?.user ?? null);
      if (event === 'PASSWORD_RECOVERY') {
        navigate({ to: '/update-password' });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Fetch user's profile data directly (avoiding circular dependency)
  const { data: profile, isLoading: isProfileLoading } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user?.id || '')
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Initialize notifications preference once on first render after profile loads
  useEffect(() => {
    if (profile?.notifications_enabled) void ensurePermission();
  }, [profile?.notifications_enabled]);

  // Set up real-time subscription for meshes table to update meshData immediately and notify the user
  useEffect(() => {
    if (!user) {
      return;
    }

    // Supabase realtime
    const channel = supabase
      .channel(`mesh-updates-${user.id}`)
      .on(
        'broadcast',
        {
          event: 'mesh-updated',
        },
        async ({ payload }) => {
          if (payload.kind === 'mesh') {
            queryClient.invalidateQueries({
              queryKey: ['meshData', payload.id],
            });
            queryClient.invalidateQueries({ queryKey: ['mesh', payload.id] });

            if (
              payload.status === 'success' &&
              profile?.notifications_enabled &&
              !window.location.pathname.includes(
                `/editor/${payload.conversation_id}`,
              )
            ) {
              if (await ensurePermission()) {
                const notification = new Notification('3D model is ready', {
                  body: 'Your generated 3D model has finished. Click to open.',
                  icon: `${import.meta.env.BASE_URL}brepia-mark.svg`,
                });
                notification.onclick = () => {
                  window.focus();
                  navigate({
                    to: '/editor/$id',
                    params: { id: payload.conversation_id },
                  });
                  notification.close();
                };
              }
            }
          }

          if (payload.kind === 'preview') {
            queryClient.invalidateQueries({
              queryKey: ['preview', payload.id],
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient, navigate, profile?.notifications_enabled]);

  // Track identity/profile only. Billing attributes are intentionally excluded.
  useEffect(() => {
    if (user && !posthogSent.current && !isProfileLoading) {
      posthog.identify(user.id, {
        email: user.email,
        full_name: ssoClaims(user)?.name || profile?.full_name,
      });
      posthogSent.current = true;
    }
  }, [user, profile, isProfileLoading]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: getAppRedirectUrl('/'),
      },
    });
    if (signUpError) throw signUpError;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: getAppRedirectUrl('/'),
      },
    });
    if (error) throw error;
  };

  const verifyOtp = async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error) throw error;
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getAppRedirectUrl('/update-password'),
    });
    if (error) throw error;
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        isLoading: isLoading || (!!user && isProfileLoading),
        signIn,
        signUp,
        signInWithMagicLink,
        verifyOtp,
        signOut,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
