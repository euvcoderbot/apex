/* CSV download for the site's data tables (Car performance, Season and the React tables): each table gets a small "CSV"
   button that saves what the table shows, as text, one row per line. Added by watching the page for new tables, so no view
   has to know about it. Values are the cell text exactly as shown (units included), not the unrounded numbers. */
(() => {
  const SELECTOR = 'table.performance-table, table.season-table';
  const cell = text => { const t = String(text).replace(/\s+/g, ' ').trim(); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  // A table's visible title: the nearest card heading, else its caption or aria-label.
  const titleOf = table => {
    const card = table.closest('.season-card, .performance-card, .dashboard-card, details, section');
    const heading = card?.querySelector('h2, h3, summary');
    return (heading?.textContent || table.caption?.textContent || table.closest('[aria-label]')?.getAttribute('aria-label') || 'table').trim();
  };
  function toCsv(table) {
    return [...table.rows].map(row => [...row.cells].map(c => cell(c.innerText ?? c.textContent)).join(',')).join('\r\n');
  }
  function download(table) {
    const name = `${titleOf(table).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table'}.csv`;
    const url = URL.createObjectURL(new Blob(['\ufeff' + toCsv(table)], {type: 'text/csv;charset=utf-8'}));
    const a = Object.assign(document.createElement('a'), {href: url, download: name});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function decorate(root = document) {
    // A view re-rendered its table: drop the button left behind by the old one.
    for (const old of document.querySelectorAll('.table-csv')) if (!old.csvTable?.isConnected) old.remove();
    for (const table of root.querySelectorAll?.(SELECTOR) || []) {
      if (table.dataset.csv || table.rows.length < 2) continue;
      table.dataset.csv = '1';
      const host = table.closest('.performance-table-wrap, .season-table-wrap') || table;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'table-csv'; button.textContent = 'CSV';
      button.title = 'Download this table as CSV'; button.setAttribute('aria-label', `Download ${titleOf(table)} as CSV`);
      button.csvTable = table;
      button.addEventListener('click', () => download(table));
      host.before(button);
    }
  }
  new MutationObserver(records => { if (records.some(r => r.addedNodes.length)) decorate(); }).observe(document.documentElement, {childList: true, subtree: true});
  decorate();
  window.ApexTableExport = {toCsv};
})();
