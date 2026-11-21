/* Reopen and share Session Analysis comparisons by storing their existing URL parameters. */
(() => {
  const key = 'apex:saved-comparisons';
  const valid = params => /^[0-9]{4}$/.test(params?.year) && /^[1-9][0-9]?$/.test(params.round) &&
    typeof params.session === 'string' && /^(?:[A-Z0-9]{2,4}\.[0-9]{1,3})(?:,[A-Z0-9]{2,4}\.[0-9]{1,3})*$/.test(params.laps);
  const href = params => window.ApexUrl.href('session', params);
  const savedKey = params => [params.year, params.round, params.session, params.laps].join('|');
  let records = [];
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(stored)) records = stored.filter(entry => typeof entry?.name === 'string' && valid(entry.params));
  } catch { /* Storage is optional. */ }

  function persist() {
    try { localStorage.setItem(key, JSON.stringify(records)); return true; }
    catch { return false; }
  }

  function mount() {
    const toggle = document.getElementById('comparisonLibraryToggle');
    const panel = document.getElementById('comparisonLibrary');
    if (!toggle || !panel) return;
    const save = document.getElementById('comparisonSave'), copy = document.getElementById('comparisonCopy');
    const fallback = document.getElementById('comparisonShareAddress'), list = document.getElementById('comparisonLibraryList');
    const status = document.getElementById('comparisonLibraryStatus');
    const current = () => {
      const params = window.sessionUrlState?.();
      return valid(params) ? params : null;
    };
    let listKey = null;
    function render() {
      const params = current();
      toggle.hidden = !params && !records.length && panel.hidden;
      save.disabled = !params || records.some(entry => savedKey(entry.params) === savedKey(params));
      copy.disabled = !params;
      if (panel.hidden) return;
      const nextKey = records.map(entry => savedKey(entry.params)).join('\n');
      if (nextKey === listKey) return;
      listKey = nextKey;
      const rows = records.map((entry, index) => {
        const li = document.createElement('li'), link = document.createElement('a'), laps = document.createElement('small');
        link.href = href(entry.params);
        link.textContent = entry.name;
        laps.textContent = entry.params.laps.split(',').map(lap => lap.replace('.', ' L')).join(' · ');
        link.append(laps);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', 'Remove ' + entry.name + ' comparison: ' + laps.textContent);
        remove.addEventListener('click', () => {
          records.splice(index, 1);
          status.textContent = persist() ? 'Comparison removed.' : 'Removed for this visit.';
          render();
          (list.children[index]?.querySelector('button') || list.lastElementChild?.querySelector('button') || toggle).focus();
        });
        li.append(link, remove);
        return li;
      });
      list.replaceChildren(...rows);
      window.ApexUI?.decorate(list);
    }
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      fallback.hidden = true;
      status.textContent = !panel.hidden && !records.length ? 'Save a comparison to reopen it on this browser.' : '';
      render();
    });
    save.addEventListener('click', () => {
      const params = current();
      if (!params || save.disabled) return;
      const context = document.getElementById('loadedSessionContext')?.textContent?.trim();
      records.unshift({name: context || params.year + ' Round ' + params.round + ' · ' + params.session, params});
      status.textContent = persist() ? 'Comparison saved on this browser.' : 'Saved for this visit. Browser storage is unavailable.';
      render();
      list.querySelector('a')?.focus({preventScroll: true});
    });
    copy.addEventListener('click', async () => {
      const params = current();
      if (!params) return;
      const url = new URL(href(params), location.href).href;
      try {
        await navigator.clipboard.writeText(url);
        fallback.hidden = true;
        status.textContent = 'Comparison link copied.';
      } catch {
        fallback.hidden = false;
        fallback.value = url;
        fallback.focus(); fallback.select();
        status.textContent = 'The comparison link is ready to copy.';
      }
    });
    window.ApexComparisonLibrary = {render};
    render();
  }

  addEventListener('DOMContentLoaded', mount);
})();
