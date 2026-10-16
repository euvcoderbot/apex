import postcss from 'postcss';

export const UI_LAYERS = ['focus','legacy','interface','workspace','appearance','components'];
export const UI_STYLES = [
  ['design-system.css','legacy'], ['polish.css','legacy'], ['apple-ui.css','interface'],
  ['car-performance.css','workspace'], ['workspace-ui.css','workspace'], ['trace-focus.css','workspace'],
  ['macos-ui.css','appearance'], ['ui-controls.css','components'],
];
const appearance = /^(?:background(?:-.+)?|color|border(?:-.+)?|box-shadow|text-shadow|font(?:-.+)?|letter-spacing|text-transform|backdrop-filter|filter)$/;
export function prepareStyle(source, filename) {
  const root=postcss.parse(source,{from:filename}), focus=[];
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
  return {css:root.toString(),focus,demoted};
}
export async function buildUiStyles(read) {
  const parts=[],focus=[]; let demoted=0;
  for(const [filename,layer] of UI_STYLES){
    const prepared=prepareStyle(await read(filename),filename);
    focus.push(...prepared.focus);demoted+=prepared.demoted;
    parts.push(`/* ${filename} */\n@layer ${layer} {\n${prepared.css}\n}`);
  }
  return {css:`@layer ${UI_LAYERS.join(', ')};\n${focus.join('\n')}\n${parts.join('\n')}\n`,demoted};
}
