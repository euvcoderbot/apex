# Menu and lap-summary refinement

- Custom select menus retain their existing DOM parent, handlers, native select,
  ARIA relationship, and keyboard controls. Supported browsers show them in the
  Popover API top layer to escape sidebar overflow clipping. Menus are positioned
  within the viewport, reposition on resize/scroll, and dismiss when their field
  leaves the viewport. Shorter windows retain an overflow safety limit.
- Full race lists use compact rows and natural height. The selected tick moves
  to the trailing edge, leaving flag and text columns aligned with the field.
- Performance track lists have no nested height cap or scrollbar. Rows retain
  highlighted selection without extra track checkboxes.
- Trace input checked styles outrank the generic checkbox background. A white
  checkmark appears in the same blue circle used in the driver list.
- Lap summaries separate lap identity, tyre age, main time, sector times and
  deltas. Main times align across cards. Conditions use quiet text labels instead
  of emoji. Sector status colors, precise values and all measurements are retained.

Browser checks: 23 GP choices fit in full at desktop and 390×844; menu/field flag
and text alignment differs by less than one CSS pixel. Season/session selection,
Escape dismissal, switching menus, loaded Singapore qualifying VER/LEC summaries,
checked/unchecked traces, and full 17-track lists were verified. No horizontal
page overflow was observed at desktop, tablet or phone widths.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using.
