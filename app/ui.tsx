import React from "react";

/* ---------------- icons (inline SVG, no deps) ---------------- */
const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const mk =
  (path: React.ReactNode, box = 24) =>
  (props: React.SVGProps<SVGSVGElement>) =>
    (
      <svg width="18" height="18" viewBox={`0 0 ${box} ${box}`} {...s} {...props}>
        {path}
      </svg>
    );

export const IcoHome = mk(<path d="M4 11 12 4l8 7M6 10v9h12v-9" />);
export const IcoBolt = mk(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />);
export const IcoList = mk(<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />);
export const IcoTarget = mk(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /></>);
export const IcoPlug = mk(<path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v6" />);
export const IcoGear = mk(<><circle cx="12" cy="12" r="3.1" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>);
export const IcoBell = mk(<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0" />);
export const IcoBot = mk(<><rect x="5" y="8" width="14" height="10" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01M2 12v3M22 12v3" /></>);
export const IcoShield = mk(<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />);
export const IcoSpark = mk(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />);
export const IcoSun = mk(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IcoMoon = mk(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />);
export const IcoCheck = mk(<path d="M20 6 9 17l-5-5" />);
export const IcoAlert = mk(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>);
