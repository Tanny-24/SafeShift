"use client";

import { useEffect, useState } from "react";
import SignIn from "./SignIn";
import Dashboard from "./Dashboard";

const DEMO_USER = { name: "TANUJA CHURENDRA", email: "Churendrat@gmail.com" };

export default function Home() {
  const [signedIn, setSignedIn] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Restore session + theme from the browser (simulated auth for the demo).
  useEffect(() => {
    setSignedIn(localStorage.getItem("ct_auth") === "1");
    const t = (localStorage.getItem("ct_theme") as "light" | "dark") || "dark";
    setTheme(t);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ct_theme", theme);
  }, [theme]);

  function signIn() {
    localStorage.setItem("ct_auth", "1");
    setSignedIn(true);
  }
  function signOut() {
    localStorage.removeItem("ct_auth");
    setSignedIn(false);
  }
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  if (!signedIn) return <SignIn onSignIn={signIn} />;
  return (
    <Dashboard
      user={DEMO_USER}
      onSignOut={signOut}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}
