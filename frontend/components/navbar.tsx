"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clearToken, getToken, getTokenExpiryMs, User, getMe, logout } from "@/lib/api";
import { useRouter } from "next/navigation";

const INACTIVITY_LOGOUT_MS = 30 * 60 * 1000;
const LAST_ACTIVITY_KEY = "algoflow_last_activity";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();

  const handleLogout = useCallback((redirectToLogin = false) => {
    void logout().finally(() => {
      setUser(null);
      router.push(redirectToLogin ? "/login" : "/");
    });
  }, [router]);

  const touchActivity = useCallback(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const expiry = getTokenExpiryMs(token);
    if (expiry && Date.now() >= expiry) {
      handleLogout(true);
      return;
    }

    getMe()
      .then(({ user }) => setUser(user))
      .catch(() => {
        clearToken();
        setUser(null);
      });
  }, [handleLogout]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const updateActivity = () => {
      touchActivity();
    };

    touchActivity();

    window.addEventListener("click", updateActivity);
    window.addEventListener("keydown", updateActivity);
    window.addEventListener("mousemove", updateActivity);
    window.addEventListener("scroll", updateActivity);
    window.addEventListener("touchstart", updateActivity);

    const interval = window.setInterval(() => {
      const rawLast = localStorage.getItem(LAST_ACTIVITY_KEY);
      const lastActivity = rawLast ? Number(rawLast) : Date.now();
      if (Date.now() - lastActivity >= INACTIVITY_LOGOUT_MS) {
        handleLogout(true);
      }
    }, 30_000);

    return () => {
      window.removeEventListener("click", updateActivity);
      window.removeEventListener("keydown", updateActivity);
      window.removeEventListener("mousemove", updateActivity);
      window.removeEventListener("scroll", updateActivity);
      window.removeEventListener("touchstart", updateActivity);
      window.clearInterval(interval);
    };
  }, [handleLogout, touchActivity]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "algoflow_token") return;
      if (event.newValue) return;
      setUser(null);
      router.push("/login");
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const expiry = getTokenExpiryMs(token);
    if (!expiry) return;

    const msUntilExpiry = expiry - Date.now();
    if (msUntilExpiry <= 0) {
      handleLogout(true);
      return;
    }

    const timer = window.setTimeout(() => {
      handleLogout(true);
    }, msUntilExpiry);

    return () => {
      window.clearTimeout(timer);
    };
  }, [handleLogout]);

  return (
    <nav className="flex justify-between items-center mb-12">
      {/* Logo */}
      <Link href="/" className="flex items-center space-x-2">
        <span style={{ fontFamily: 'var(--font-bitcount)' }} className="text-4xl tracking-tight text-white">
          ALGOFLOW
        </span>
      </Link>

      {/* Right side */}
      <div className="flex items-center space-x-6">
        <a
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-tg-muted cursor-pointer hover:text-white transition-colors tracking-widest"
        >
          DOCS
        </a>

        <Link
          href="/mcp"
          className="text-sm font-medium text-tg-muted cursor-pointer hover:text-white transition-colors tracking-widest"
        >
          MCP
        </Link>

        {user ? (
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <button
                onClick={() => handleLogout()}
                title="Logout"
                aria-label="Logout"
                className="group relative w-8 h-8 rounded-full border border-white/10 overflow-hidden transition-colors"
              >
                {user.avatar ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-full h-full object-cover transition-opacity duration-150 group-hover:opacity-0"
                  />
                ) : (
                  <div className="w-full h-full bg-tg-gray flex items-center justify-center text-xs font-bold text-tg-lavender transition-opacity duration-150 group-hover:opacity-0">
                    {user.login?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-red-500 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="M16 17l5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <Link href="/login">
            <div className="h-10 w-10 rounded-full bg-tg-gray border border-white/10 flex items-center justify-center cursor-pointer hover:border-tg-lavender/50 transition-colors">
              <div className="w-2 h-2 rounded-full bg-tg-lime animate-pulse" />
            </div>
          </Link>
        )}
      </div>
    </nav>
  );
}
