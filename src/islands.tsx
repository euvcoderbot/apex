/**
 * React views inside the existing page. car-performance.js renders a
 * placeholder `<div data-react-view="name">` and hands this module plain view
 * data; React owns everything inside the placeholder. Clicks still bubble to
 * the page's delegated handlers (same data-* attributes), which change state
 * and render again, so there is one owner of state per view.
 *
 * Built by scripts/sync-static.mjs with esbuild into public/apex/react-islands.js.
 */
import type {ComponentType} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';
import {PaceView} from './views/PaceView';
import {PitsView} from './views/PitsView';
import {ResultsView} from './views/ResultsView';
import {TrendView} from './views/TrendView';
import {TyresView} from './views/TyresView';

const VIEWS: Record<string, ComponentType<any>> = {results: ResultsView, pits: PitsView, trend: TrendView, pace: PaceView, tyres: TyresView};
const roots = new WeakMap<Element, Root>();

/** Render every placeholder in `container` synchronously, so code that runs
 *  right after (layout arrangement, component decoration) sees the DOM. */
function mountAll(container: ParentNode, props: Map<string, unknown>) {
  for (const element of container.querySelectorAll<HTMLElement>('[data-react-view]')) {
    const name = element.dataset.reactView!, View = VIEWS[name];
    if (!View || !props.has(name)) continue;
    let root = roots.get(element);
    if (!root) { root = createRoot(element); roots.set(element, root); }
    flushSync(() => root!.render(<View {...(props.get(name) as object)} />));
  }
}

declare global { interface Window { ApexReact?: {mountAll: typeof mountAll; views: string[]} } }
window.ApexReact = {mountAll, views: Object.keys(VIEWS)};
