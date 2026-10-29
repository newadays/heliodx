/**
 * Inline SVG icons (design/components.md: 16 px, stroke 1.75). No icon font.
 * Decorative by default (`aria-hidden`); pass `label` when an icon stands alone.
 */
import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  check: <path d="M3.5 8.5l3 3 6-7" strokeWidth={2} />,
  checkAll: <path d="M2.5 8.5l3 3 6-7M8.5 11.5l5.5-7" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  edit: <path d="M11.5 2.5l2 2L5 13H3v-2z" />,
  chevronDown: <path d="M4 6l4 4 4-4" />,
  chevronUp: <path d="M4 10l4-4 4 4" />,
  chevronRight: <path d="M6 3l5 5-5 5" />,
  download: <path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3 13.5h10" />,
  external: <path d="M9 3h4v4M13 3L7 9M11 9v4H3V5h4" />,
  lock: (
    <>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  panel: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M9.5 3v10" />
    </>
  ),
  send: <path d="M14 2L7.5 8.5M14 2l-4 12-2.5-5.5L2 6z" />,
  mail: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2.5 4.5L8 8.5l5.5-4" />
    </>
  ),
  chat: <path d="M2.5 13.5l1-3A5.5 5.5 0 1 1 5.5 12.5z" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7v4M8 5v.5" />
    </>
  ),
  file: (
    <>
      <path d="M4 1.75h5l3 3v9.5H4z" />
      <path d="M9 1.75v3h3" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </>
  ),
  refresh: <path d="M13 3.5v3h-3M3 12.5v-3h3M12.5 6.5A5 5 0 0 0 4 4.5L3 5.5M3.5 9.5a5 5 0 0 0 8.5 2l1-1" />,
  warn: (
    <>
      <path d="M8 2l6.25 11H1.75z" />
      <path d="M8 6.5v3M8 11.25v.25" />
    </>
  ),
  arrowLeft: <path d="M10 3L5 8l5 5" />,
  upload: <path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M3 13.5h10" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="12.5" cy="8" r="1.4" />
    </g>
  ),
  trash: <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 9h6.8l.6-9M6.75 6.75v4.5M9.25 6.75v4.5" />,
  reset: <path d="M3 8a5 5 0 1 0 1.5-3.55M3 2.75v2.5h2.5" />,
  shield: <path d="M8 1.75l5 2v3.75c0 3-2.1 5.4-5 6.75-2.9-1.35-5-3.75-5-6.75V3.75z" />,
  text: <path d="M3 4V2.75h10V4M8 2.75v10.5M6 13.25h4" />,
  play: <path d="M5 3.25l7.5 4.75L5 12.75z" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, label, strokeWidth = 1.75 }: { name: IconName; size?: number; label?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The small check used inside done step-rail dots. */
export function DotCheck() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6.5l2.3 2.3L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
