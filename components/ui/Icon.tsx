"use client";

import * as React from "react";

type IconName =
  | "grid"
  | "chart"
  | "flask"
  | "stethoscope"
  | "portfolio"
  | "layers"
  | "report"
  | "news"
  | "calendar"
  | "mentor"
  | "settings"
  | "search"
  | "sun"
  | "moon"
  | "menu"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "arrowUp"
  | "arrowDown"
  | "arrowRight"
  | "check"
  | "x"
  | "alert"
  | "info"
  | "loader"
  | "empty"
  | "external"
  | "download"
  | "refresh"
  | "filter"
  | "sparkles"
  | "logout"
  | "bell"
  | "command"
  | "trash"
  | "plus"
  | "copy"
  | "clock"
  | "shield"
  | "calculator";

const PATHS: Record<IconName, React.ReactNode> = {
  grid: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  chart: <path d="M3 21h18M6 17V9m5 8V5m5 12v-6" />,
  flask: (
    <>
      <path d="M9 3h6M10 3v6L4.5 18A2 2 0 007 21h10a2 2 0 001.5-3.5L14 9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M6 3v5a4 4 0 008 0V3M6 3H4m2 0h1m7 0h1m-2 0h1" />
      <path d="M10 12v2a5 5 0 0010 0v-1" />
      <circle cx="20" cy="11" r="2" />
    </>
  ),
  portfolio: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5M3 17.5l9 5 9-5" />
    </>
  ),
  report: (
    <>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  news: (
    <>
      <path d="M4 5h13a1 1 0 011 1v12a2 2 0 002 2H5a1 1 0 01-1-1V5z" />
      <path d="M18 8h2a1 1 0 011 1v9a2 2 0 01-2 2M7 9h7M7 13h7M7 16h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  mentor: (
    <>
      <path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <path d="M9 9.5a2.5 2.5 0 113.5 2.3c-.6.3-1 .8-1 1.4v.3M12 17h.01" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
  arrowRight: <path d="M5 12h14M12 5l7 7-7 7" />,
  check: <path d="M4 12l5 5L20 6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: (
    <>
      <path d="M12 3l9.5 17h-19L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  loader: <path d="M12 3v4m0 10v4M5.6 5.6l2.8 2.8m7.2 7.2l2.8 2.8M3 12h4m10 0h4M5.6 18.4l2.8-2.8m7.2-7.2l2.8-2.8" />,
  empty: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 10h8M8 14h5" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />,
  download: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 10-2.3 6.3" />
      <path d="M20 5v6h-6" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  sparkles: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2 2.2.8-2.2.8L18 22l-.8-2.2-2.2-.8 2.2-.8z" />,
  logout: <path d="M15 17l5-5-5-5M20 12H9M12 3H6a2 2 0 00-2 2v14a2 2 0 002 2h6" />,
  bell: (
    <>
      <path d="M18 9a6 6 0 10-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M13.7 20a2 2 0 01-3.4 0" />
    </>
  ),
  command: (
    <path d="M9 6a2 2 0 10-4 0c0 1.1.9 2 2 2h10a2 2 0 10-4 0v12a2 2 0 104 0 2 2 0 00-2-2H7a2 2 0 10-4 0c0 1.1.9 2 2 2h10a2 2 0 10-4 0z" />
  ),
  trash: <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a1 1 0 011-1h9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5-4.5-1-8-4.5-8-9.5V6z" />,
  calculator: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 7h8M8 12h3m5 0h-2m-1-1v2M8 17h2m4 0h2M8 15h2m4 0h2" />
    </>
  ),
};

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  spin?: boolean;
}

export function Icon({ name, size = 16, spin = false, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={[className, spin ? "icon-spin" : ""].filter(Boolean).join(" ") || undefined}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };