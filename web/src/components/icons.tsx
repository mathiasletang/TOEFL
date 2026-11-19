import type { ReactNode, SVGProps } from "react";

/** Line icons (24 × 24 grid, 1.75 stroke, currentColor). Decorative unless a title is given. */
type P = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Svg({ size = 18, title, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className="shrink-0"
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Svg>
);
export const IconSwap = (p: P) => (
  <Svg {...p}>
    <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" />
  </Svg>
);
export const IconSpeaker = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M10 2h4" />
  </Svg>
);
export const IconReplay = (p: P) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" />
  </Svg>
);
export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const IconArrowLeft = (p: P) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const IconArrowUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const IconArrowDown = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 2.5 20h19L12 3.5Z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5v.01" />
  </Svg>
);
export const IconDot = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="5" fill={filled ? "currentColor" : "none"} />
  </Svg>
);
