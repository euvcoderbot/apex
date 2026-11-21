// Shared by legacy-overrides.mjs and prune-legacy.mjs: selectors whose states the check cannot open (hover, focus, invalid
// fields, transient surfaces). Their declarations are never removed, and the check leaves them in place too.
export const UNOBSERVED = /:(hover|focus|focus-visible|focus-within|active|disabled|enabled|checked|indeterminate|invalid|user-invalid|placeholder-shown|target|visited|popover-open|modal|fullscreen)\b|\[aria-invalid|\[aria-busy|\[open\]|toast|tooltip|season-tip|hover-card|chart-tip|is-loading|is-error|::selection|::-webkit|::-moz|::placeholder/;
