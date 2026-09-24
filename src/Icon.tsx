/* The chrome's icons. Drawn in the same 2px round-jointed line as every other
 * edge here, so an icon button reads as the same thing as a worded one. Every
 * button that shows one carries an aria-label and a title as well: an icon is
 * a shorthand, never the only name a control has. */

const PATHS = {
  undo: "M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  hidden: "M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.8 M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6",
  lock: "M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  unlock: "M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2",
  up: "M12 19V5 M6 11l6-6 6 6",
  down: "M12 5v14 M6 13l6 6 6-6",
  x: "M6 6l12 12 M18 6 6 18",
  star: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z",
  "align-left": "M4 3v18 M8 7h12 M8 12h7 M8 17h10",
  "align-cx": "M12 3v18 M5 7h14 M8 12h8 M6 17h12",
  "align-right": "M20 3v18 M4 7h12 M9 12h7 M6 17h10",
  "align-top": "M3 4h18 M7 8v12 M12 8v7 M17 8v10",
  "align-cy": "M3 12h18 M7 5v14 M12 8v8 M17 6v12",
  "align-bottom": "M3 20h18 M7 4v12 M12 9v7 M17 6v10",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
