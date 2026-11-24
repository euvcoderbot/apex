import {useSyncExternalStore} from 'react';

function subscribe(changed: () => void) {
  window.addEventListener('apex-descriptions', changed);
  return () => window.removeEventListener('apex-descriptions', changed);
}

export function useExplanations() {
  return useSyncExternalStore(subscribe,
    () => document.getElementById('explanationsToggle')?.getAttribute('aria-pressed') === 'true',
    () => false);
}
