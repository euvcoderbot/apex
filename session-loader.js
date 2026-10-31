/* Session analysis: custom selects, race calendar and the session loader. */
// Populate select utilities
function selectValue(select) {
  return select && customSelectValues.has(select) ? customSelectValues.get(select) : (select?.value || '');
}

function selectCustomOption(optionButton) {
  const shell = optionButton.closest('.select-shell');
  const select = shell?.querySelector('select');
  const trigger = shell?.querySelector('.select-trigger');
  const optionIndex = Number(optionButton.getAttribute('data-select-index'));
  if (!select || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= select.options.length) return;
  if (select.disabled || select.options[optionIndex].disabled) return;
  customSelectValues.set(select, select.options[optionIndex].value);
  select.selectedIndex = optionIndex;
  closeSelectMenu(shell);
  syncSelectUI(select);
  if (select.id !== 'session') select.dispatchEvent(new Event('change', { bubbles: true }));
  trigger?.focus();
}

function populate(select, values, valueFor = x => x, labelFor = x => x) {
  customSelectValues.delete(select);
  select.innerHTML = values.map(val => `<option value="${valueFor(val)}">${labelFor(val)}</option>`).join('');
  syncSelectUI(select);
}

function syncSelectUI(select) {
  const shell = select?.closest('.select-shell');
  const trigger = shell?.querySelector('.select-trigger');
  const menu = shell?.querySelector('.select-menu');
  if (!trigger || !menu) return;
  const options = [...select.options];
  const selectedOption = options.find(option => option.value === selectValue(select)) || options[0];
  trigger.querySelector('span').innerHTML = selectOptionContent(selectedOption);
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-expanded', String(shell.classList.contains('is-open')));
  menu.innerHTML = options.map((option, optionIndex) => `
    <button type="button" role="option" tabindex="-1" aria-selected="${option === selectedOption}" ${option.disabled ? 'disabled aria-disabled="true"' : ''} data-select-index="${optionIndex}" data-select-value="${encodeURIComponent(option.value)}" onclick="selectCustomOption(this)">
      ${selectOptionContent(option)}
    </button>`).join('');
}

function closeSelectMenu(shell) {
  const menu = shell?.querySelector('.select-menu');
  if (typeof menu?.hidePopover === 'function' && menu.matches(':popover-open')) menu.hidePopover();
  shell?.classList.remove('is-open');
  shell?.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false');
}

function positionSelectMenu(shell) {
  const menu = shell.querySelector('.select-menu'), trigger = shell.querySelector('.select-trigger');
  if (!menu?.hasAttribute('popover')) return;
  const anchor = trigger.getBoundingClientRect(), gutter = 8;
  if (anchor.bottom < gutter || anchor.top > innerHeight - gutter) { closeSelectMenu(shell); return; }
  // Measurements include the page zoom; inline styles are applied in layout px.
  const page = document.documentElement;
  const zoom = page?.offsetWidth ? page.getBoundingClientRect().width / page.offsetWidth || 1 : 1;
  menu.style.minWidth = Math.min(anchor.width, innerWidth - gutter * 2) / zoom + 'px';
  menu.style.maxHeight = Math.max(80, innerHeight - gutter * 2) / zoom + 'px';
  const box = menu.getBoundingClientRect(), width = box.width, height = box.height;
  const below = innerHeight - anchor.bottom - gutter - 4;
  const top = height <= below ? anchor.bottom + 4 : height + gutter + 4 <= anchor.top ? anchor.top - height - 4 : Math.max(gutter, innerHeight - height - gutter);
  menu.style.left = Math.max(gutter, Math.min(anchor.left, innerWidth - width - gutter)) / zoom + 'px';
  menu.style.top = top / zoom + 'px';
}

function enhanceSelect(select) {
  const shell = select.closest('.select-shell');
  if (!shell || shell.dataset.enhanced === 'true') return;
  shell.dataset.enhanced = 'true';
  select.classList.add('native-select-proxy');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  shell.insertAdjacentHTML('beforeend', `
    <button class="select-trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false"><span>Select</span><i aria-hidden="true"></i></button>
    <div class="select-menu" role="listbox"></div>`);
  const trigger = shell.querySelector('.select-trigger');
  const menu = shell.querySelector('.select-menu');
  // The top layer lets all four rounded corners escape the sidebar's clipping.
  if (typeof menu.showPopover === 'function') menu.setAttribute('popover', 'manual');
  const label = document.querySelector(`label[for="${select.id}"]`);
  if (label) {
    label.id = `${select.id}Label`;
    trigger.setAttribute('aria-labelledby', label.id);
    menu.setAttribute('aria-labelledby', label.id);
  }
  menu.id = `${select.id}Options`;
  trigger.setAttribute('aria-controls', menu.id);
  const close = () => closeSelectMenu(shell);
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    document.querySelectorAll('.select-shell.is-open').forEach(openShell => {
      if (openShell !== shell) {
        closeSelectMenu(openShell);
      }
    });
    const open = shell.classList.toggle('is-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      if (typeof menu.showPopover === 'function') menu.showPopover();
      positionSelectMenu(shell);
      const selected = menu.querySelector('[aria-selected="true"]');
      selected?.focus({ preventScroll: true });
      if (selected) menu.scrollTop = selected.offsetTop - (menu.clientHeight - selected.offsetHeight) / 2;
    } else close();
  });
  let searchPrefix = '', lastSearchAt = 0;
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('[data-select-value]:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + direction + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      close();
      trigger.focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault();
      const now = Date.now();
      searchPrefix = now - lastSearchAt < 700 ? searchPrefix + event.key : event.key;
      lastSearchAt = now;
      const labels = items.map(item => item.textContent.trim().toLocaleLowerCase());
      // Search in display order after the focused option, cycling repeated keys.
      const order = items.map((_, offset) => (index + 1 + offset) % items.length);
      let match = order.find(i => labels[i].startsWith(searchPrefix.toLocaleLowerCase()));
      if (match === undefined && searchPrefix.length > 1) {
        searchPrefix = event.key;
        match = order.find(i => labels[i].startsWith(searchPrefix.toLocaleLowerCase()));
      }
      if (match !== undefined) items[match].focus();
    }
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!shell.classList.contains('is-open')) trigger.click();
      else menu.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
    } else if (event.key === 'Escape') close();
  });
  syncSelectUI(select);
}

window.enhanceSelect = enhanceSelect;
window.syncSelectUI = syncSelectUI;
window.selectCustomOption = selectCustomOption;

// Calendar API Loader
async function loadCalendar() {
  const generation = ++calendarGeneration;
  if (calendarRequest) calendarRequest.abort();
  calendarRequest = new AbortController();
  const year = selectValue($('#year'));
  queueMicrotask(() => syncSelectUI($('#gp')));
  customSelectValues.delete($('#gp'));
  $('#gp').innerHTML = '<option>Loading calendar…</option>';
  try {
    const payload = await loadApiData(apiUrl(`/api/events?year=${year}`), { signal: calendarRequest.signal });
    if (generation !== calendarGeneration || year !== selectValue($('#year'))) return;
    calendar = payload;
    $('#gp').innerHTML = calendar.map(event => `<option value="${event.round}" data-country="${grandPrixCountryCode(event) || ''}">R${event.round} · ${escapeUI(event.name)}</option>`).join('');
    syncSelectUI($('#gp'));
    selectLatestCompletedEvent();
  } catch (error) {
    if (generation !== calendarGeneration || error.name === 'AbortError') return;
    $('#gp').innerHTML = '<option value="">Calendar unavailable — retry season</option>';
    syncSelectUI($('#gp'));
    notify(`Could not load calendar. ${error.message}`);
    throw error;
  }
}

function parsedSessionTimestamp(value) {
  if (!value) return NaN;
  const text = String(value).trim();
  // FastF1 historically emitted UTC timestamps with a space separator. That
  // shape is not parsed consistently by every browser, so normalize it to ISO.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:/.test(text)
    ? text.replace(' ', 'T')
    : text;
  return new Date(normalized).getTime();
}

function latestCompletedSelection(events, now = Date.now()) {
  let latest = null;
  (events || []).forEach((event, eventIndex) => {
    (event.sessions || []).forEach((session, sessionIndex) => {
      const status = String(event.session_statuses?.[session] || '').toLowerCase();
      if (['cancelled', 'live', 'upcoming', 'interrupted', 'aborted', 'suspended'].includes(status)) return;
      const timestamp = parsedSessionTimestamp(
        event.session_end_dates?.[session] || event.session_dates?.[session]
      );
      // A missing finish flag can leave a published weekend marked unknown.
      // After 36 hours, it is safe to offer the session as the default; this
      // only changes the selection and never fetches its data automatically.
      if (status === 'unknown' && timestamp > now - 36 * 3600000) return;
      if (!Number.isFinite(timestamp) || timestamp > now) return;
      if (!latest || timestamp > latest.timestamp) {
        latest = { event, session, timestamp, eventIndex, sessionIndex };
      }
    });
  });
  if (latest) return latest;

  // Older calendars can lack session timestamps. Use only weekends whose
  // event date has passed, and keep future seasons on their opening session.
  const completedEvents = (events || []).filter(event => {
    const eventDate = parsedSessionTimestamp(`${event.date || ''}T23:59:59Z`);
    return Number.isFinite(eventDate) && eventDate <= now
      && !Object.keys(event.session_dates || {}).length
      && !Object.keys(event.session_end_dates || {}).length;
  });
  const event = completedEvents.at(-1) || events?.find(candidate =>
    candidate.sessions?.some(session => !['cancelled', 'interrupted', 'aborted', 'suspended'].includes(
      String(candidate.session_statuses?.[session] || '').toLowerCase()
    ))) || events?.[0] || null;
  const sessions = (event?.sessions || []).filter(session =>
    !['cancelled', 'interrupted', 'aborted', 'suspended'].includes(
      String(event.session_statuses?.[session] || '').toLowerCase()
    ));
  return event ? {
    event,
    session: completedEvents.length ? sessions.at(-1) : sessions[0],
    timestamp: NaN,
  } : null;
}

function verifiedTireNominations(year, eventName, reported) {
  if (year !== 2026) return reported;
  const name = String(eventName || '').toLowerCase();
  // Pirelli's confirmed 2026 allocations override older venue heuristics in
  // the separately deployed telemetry API.
  if (['barcelona', 'catalunya', 'dutch', 'netherlands', 'zandvoort',
    'spanish', 'madrid', 'bahrain', 'sepang'].some(venue => name.includes(venue))) {
    return ['C2', 'C3', 'C4'];
  }
  return reported;
}

function orderedWeekendSessions(event, year = Number(selectValue($('#year')))) {
  const sprint = (event?.sessions || []).some(name => /sprint/i.test(name));
  const order = sprint
    ? year >= 2024
      ? ['Practice 1','Sprint Qualifying','Sprint Shootout','Sprint','Qualifying','Race']
      : year === 2023
        ? ['Practice 1','Qualifying','Sprint Shootout','Sprint Qualifying','Sprint','Race']
        : ['Practice 1','Qualifying','Practice 2','Sprint','Race']
    : ['Practice 1','Practice 2','Practice 3','Qualifying','Race'];
  const rank = name => { const index = order.indexOf(name); return index < 0 ? 99 : index; };
  return [...(event?.sessions || [])].sort((a,b) => {
    const startA = parsedSessionTimestamp(event.session_dates?.[a]);
    const startB = parsedSessionTimestamp(event.session_dates?.[b]);
    return Number.isFinite(startA) && Number.isFinite(startB) && startA !== startB
      ? startA - startB : rank(a) - rank(b);
  });
}

function populateSessions(preferredSession = null) {
  const selectedVal = selectValue($('#gp'));
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const sessions = orderedWeekendSessions(event);
  populate($('#session'), sessions);
  if (!sessions.length) return;

  const latestForEvent = latestCompletedSelection([event]);
  const target = sessions.includes(preferredSession)
    ? preferredSession
    : sessions.includes(latestForEvent?.session) ? latestForEvent.session : sessions[0];
  $('#session').value = target;
  syncSelectUI($('#session'));
}

function selectLatestCompletedEvent() {
  // Compare timestamps directly instead of relying on calendar ordering. A
  // weekend in progress therefore selects its latest completed session.
  const latest = latestCompletedSelection(calendar);
  if (latest?.event) {
    customSelectValues.delete($('#gp'));
    $('#gp').value = String(latest.event.round);
  }
  syncSelectUI($('#gp'));
  populateSessions(latest?.session || null);
}

// UI State Resets
function clearBeforeSessionLoad() {
  clearTimeout(raceResultRefreshTimer);
  raceResultRefreshAttempts=0;
  drawGeneration++;
  drivers.splice(0, drivers.length);
  realDrivers.clear();
  selected = [];
  loaded = [];
  openStint = {};
  corners = [];
  sessionEventName = '';
  sessionYear = null;
  sessionCircuitKey = null;
  sessionLocation = '';
  openf1SessionKey = null;
  nominatedCompounds = [];
  selectedCornerIndices = new Set();
  automaticStraightIndices = new Set();
  traceZoom = { start: 0, end: 1 };
  zoomDrag = null;
  hiddenTraceKeys.clear();
  dominanceMapHitPoints = [];
  dominanceMapGeometryCache = null;
  telemetryCache.clear();
  sessionSectorGuide = null;
  telemetryRequests.clear();
  lapColorOverrides.clear();
  $('#driverPills').innerHTML = '<span class="section-empty">Load a session to see its drivers.</span>';
  $('#stintPanels').innerHTML = '<span class="section-empty">Select a driver to inspect their runs and laps.</span>';
  $('#sectorRows').innerHTML = '';
  
  const tireCard = $('#tireCard');
  if (tireCard) tireCard.style.display = 'none';
  updateTelemetryVisibility();
}

// Main Session API Loader
async function loadRealSession() {
  const button = $('#loadSession');
  if(button.classList.contains('is-loading')) {
    sessionRequest?.abort();button.disabled=true;button.textContent='Stopping…';return;
  }
  button.disabled = false;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  // Keep the progress label compact enough for split-screen and mobile cards.
  // The full action remains available to assistive technology.
  button.textContent = 'Stop loading';
  button.setAttribute('aria-label', 'Stop loading session');
  setSessionLoading(true);
  if (sessionRequest) sessionRequest.abort();
  sessionRequest = new AbortController();
  const request = sessionRequest;
  const requestedQuery = String(currentQuery());
  
  try {
    const payload = await loadApiData(apiUrl(`/api/session?${requestedQuery}`), {signal:request.signal});
    if (request !== sessionRequest || requestedQuery !== String(currentQuery())) return;
    if (!Array.isArray(payload.drivers) || !payload.drivers.length) throw new Error('No driver data is available for this session yet.');
    clearBeforeSessionLoad();
    loadedSessionQuery = requestedQuery;
    renderCharts();
    
    realDrivers = new Map(payload.drivers.map(driver => [driver.code, driver]));
    drivers.splice(0, drivers.length, ...payload.drivers.map(driver => [
      driver.code, driver.number, driver.name, driver.team_color, driver.team, driver.position
    ]));
    corners = payload.corners || [];
    sessionEventName = payload.event || '';
    loadedSessionName = payload.session || '';
    sessionYear = Number(new URLSearchParams(requestedQuery).get('year'));
    sessionCircuitKey = Number.isInteger(payload.circuit_key) ? payload.circuit_key : null;
    sessionLocation = payload.location || '';
    openf1SessionKey = Number.isInteger(payload.openf1_session_key) ? payload.openf1_session_key : null;
    nominatedCompounds = verifiedTireNominations(sessionYear, sessionEventName, payload.compounds || []);
    // Archive-free summaries can have complete laps but no CircuitInfo rows.
    // Fetch venue annotations independently and share them with every view.
    if (!corners.length && sessionCircuitKey && !isSepangCircuit()) {
      try {
        const guide = await loadCircuitAnnotations(sessionCircuitKey, sessionYear, request.signal);
        if (request !== sessionRequest || requestedQuery !== String(currentQuery())) return;
        corners = circuitAnnotationRows(guide);
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        console.warn('Circuit annotations unavailable', error.message);
      }
    }
    
    renderDrivers();
    renderTireNomination();
    renderStints();
    renderAll();
    void refreshRaceResults(request,requestedQuery);
  } catch (error) {
    if (error.name !== 'AbortError') notify(`Could not load this session. ${error.message}`);
  } finally {
    // A newer request owns the button now. (No return here: a return in finally would swallow an error in flight.)
    if (request === sessionRequest) {
      setSessionLoading(false);
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
      button.removeAttribute('aria-label');
      button.textContent = 'Load session';
    }
  }
}

function setSessionLoading(value) {
  const analysis=$('.analysis-column'),sidebar=$('#driverSidebar');
  if(analysis){analysis.inert=value;analysis.setAttribute('aria-busy',String(value));}
  if(sidebar)sidebar.inert=value||$('main')?.classList.contains('sidebar-collapsed');
}

function setLapSelectionExpanded(expanded, focus = false) {
  const body = $('#lapSelectionBody'), toggle = $('#lapWorkspaceToggle');
  if (!body || !toggle) return;
  body.hidden = !expanded;
  body.inert = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.querySelector('span').textContent = expanded ? 'Choose laps' : 'Edit laps';
  if (focus) toggle.focus({preventScroll: true});
}

