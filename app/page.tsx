"use client";

import { useEffect, useState } from "react";
import Dashboard from "./Dashboard";

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Theme preference is local presentation state; SafeShift has no auth layer.
  useEffect(() => {
    const t = (localStorage.getItem("ct_theme") as "light" | "dark") || "dark";
    setTheme(t);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ct_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return <Dashboard theme={theme} onToggleTheme={toggleTheme} />;
}
