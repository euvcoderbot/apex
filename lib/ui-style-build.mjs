import postcss from 'postcss';

// Leave interface scaling to browser zoom and the user's text preferences.
export const UI_ZOOM = 1;
export function scaleMediaParams(params, zoom = UI_ZOOM) {
  return params.replace(/((?:min|max)-(?:width|height)\s*:\s*)([0-9.]+)px/g, (_, prop, value) => prop + Math.round(Number(value) * zoom) + 'px');
}
export const UI_LAYERS = ['focus','legacy','interface','workspace','appearance','components','window','system'];
export const UI_STYLES = [
  ['design-system.css','legacy'], ['polish.css','legacy'], ['apple-ui.css','interface'],
  ['car-performance.css','workspace'], ['workspace-ui.css','workspace'], ['trace-focus.css','workspace'],
  ['macos-ui.css','appearance'], ['ui-controls.css','components'], ['macos-window.css','window'], ['hig-system.css','system'],
];
const appearance = /^(?:background(?:-.+)?|color|border(?:-.+)?|box-shadow|text-shadow|font(?:-.+)?|letter-spacing|text-transform|backdrop-filter|filter)$/;
// Confirmed retired UI only; do not guess that scientific/data styles are unused.
const retiredUi=/(?:lap-selection-mark|speed-annotation-evidence|speed-annotation-table-wrap|measurement-table-heading|trace-color-picker|track-tray-title|track-tray-disclosure|track-tray-label)/;
export function prepareStyle(source, filename) {
  const root=postcss.parse(source,{from:filename}), focus=[];
  root.walkAtRules('media',rule=>{rule.params=scaleMediaParams(rule.params);});
  let retired=0;
  root.walkRules(rule=>{
    const selectors=postcss.list.comma(rule.selector),kept=selectors.filter(selector=>!retiredUi.test(selector));
    retired+=selectors.length-kept.length;
    if(!kept.length)rule.remove();else rule.selector=kept.join(',');
  });
  root.walkAtRules('layer',rule=>{
    if(rule.params==='focus') { focus.push(rule.toString()); rule.remove(); }
  });
  // Old visual !important declarations must not outrank the component contract.
  // Preserve layout, canvas sizing, hidden, forced-colour and motion safeguards.
  let demoted=0;
  root.walkDecls(decl=>{
    if(!decl.important||!appearance.test(decl.prop))return;
    for(let parent=decl.parent;parent;parent=parent.parent)
      if(parent.type==='atrule'&&parent.name==='media'&&/forced-colors|prefers-contrast/.test(parent.params))return;
    decl.important=false;demoted++;
  });
  return {css:root.toString(),focus,demoted,retired};
}
export async function buildUiStyles(read) {
  const parts=[],focus=[]; let demoted=0,retired=0;
  for(const [filename,layer] of UI_STYLES){
    const prepared=prepareStyle(await read(filename),filename);
    focus.push(...prepared.focus);demoted+=prepared.demoted;retired+=prepared.retired;
    parts.push(`/* ${filename} */\n@layer ${layer} {\n${prepared.css}\n}`);
  }
  return {css:`@layer ${UI_LAYERS.join(', ')};\n${focus.join('\n')}\n${parts.join('\n')}\n`,demoted,retired};
}
