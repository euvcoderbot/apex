/**
 * macOS segmented control. Each button carries `data-<name>="<value>"`, so the
 * page's delegated click handler stays the single owner of the state change
 * (ui-system.js gives it the `segment` component styling).
 */
export function SegmentedControl({name, label, value, options}: {
  name: string; label: string; value: string; options: ReadonlyArray<readonly [string, string]>;
}) {
  const attribute = 'data-' + name;
  return (
    <div className="performance-scope-toggle" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" {...{[attribute]: key}} aria-pressed={value === key}>{text}</button>
      ))}
    </div>
  );
}
