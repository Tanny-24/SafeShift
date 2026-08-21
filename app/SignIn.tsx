"use client";

import { useState } from "react";
import { IcoGoogle, IcoBot, IcoSpark, IcoShield } from "./ui";

export default function SignIn({ onSignIn }: { onSignIn: () => void }) {
  const [loading, setLoading] = useState(false);

  function go() {
    setLoading(true);
    // Simulated Google auth. Replace with Google Identity Services for production.
    setTimeout(() => onSignIn(), 650);
  }

  return (
    <div className="auth">
      <div className="auth-left">
        <div className="brand-lg">
          <span className="logo-mark">S</span> SafeShift
        </div>
        <h1 className="auth-h1">
          Know if your agent
          <br />
          would betray you.
        </h1>
        <p className="auth-sub">
          Companies are handing AI agents their email, files, and money — with no
          safety testing. SafeShift drops your agent into trap situations from
          Anthropic&apos;s misalignment research and rates whether it blackmails,
          leaks, or sabotages under pressure. Crash tests for agents, before you
          ship.
        </p>
        <ul className="auth-points">
          <li>
            <span className="ap-ico"><IcoBot /></span> Stress-tests any agent from
            just its system prompt + tools
          </li>
          <li>
            <span className="ap-ico"><IcoSpark /></span> A Gemini judge scores every
            run and cites the exact offense
          </li>
          <li>
            <span className="ap-ico"><IcoShield /></span> Built on Anthropic&apos;s
            Agentic Misalignment experiment
          </li>
        </ul>
      </div>

      <div className="auth-right">
        <div className="auth-card">
          <div className="logo-mark lg">S</div>
          <h2>Sign in to SafeShift</h2>
          <p className="auth-card-sub">Use your Google account to get started.</p>

          <button className="google-btn" onClick={go} disabled={loading}>
            {loading ? <span className="spin" /> : <IcoGoogle />}
            {loading ? "Signing in…" : "Continue with Google"}
          </button>

          <div className="auth-divider"><span>secure sign-in</span></div>
          <p className="auth-fine">
            By continuing you agree to the demo Terms. Sign-in is simulated and
            stored only in your browser.
          </p>
        </div>
        <p className="auth-foot">SafeShift · Pre-deployment safety testing for AI agents</p>
      </div>
    </div>
  );
}
