/*
 * app.js: reads the CSV files in data/ and fills in the page.
 * The finance math lives in capstruct.js (window.CapStruct).
 */
(function () {
  'use strict';
  const C = window.CapStruct;

  async function loadCSV(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load ' + path + ' (' + res.status + ')');
    return C.parseCSV(await res.text());
  }

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // A statement table: one row per line item, one column per kind of year.
  function fillStatement(table, headers, rows) {
    table.textContent = '';
    const thead = el('thead');
    const hr = el('tr');
    hr.appendChild(el('th', { scope: 'col' }, ''));
    headers.forEach(h => hr.appendChild(el('th', { scope: 'col' }, h)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach(r => {
      const tr = el('tr', r.cls ? { class: r.cls } : null);
      tr.appendChild(el('th', { scope: 'row' }, r.label));
      r.cells.forEach(c => tr.appendChild(el('td', null, c)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // A results grid: one row per amount of borrowing. Each cell carries its
  // column name in data-label so phones can show each row as a card.
  function fillGrid(table, columns, rows) {
    table.textContent = '';
    const thead = el('thead');
    const hr = el('tr');
    columns.forEach(c => hr.appendChild(el('th', { scope: 'col' }, c.label)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      columns.forEach((c, i) => {
        const cell = el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : { 'data-label': c.label }, c.value(r));
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function firmRows(f, tax) {
    const y = f.years;
    const map = fn => y.map(fn);
    return [
      { label: 'Assets', cells: map(v => C.fmtDollars(v.assets)) },
      { label: 'Equity', cells: map(v => C.fmtDollars(v.equity)) },
      { label: 'Probability', cells: map(v => C.fmtNumber(v.probability, 2)) },
      { label: 'Sales', cells: map(v => C.fmtDollars(v.sales)) },
      { label: 'Oper. costs', cells: map(v => C.fmtCost(v.operatingCosts)) },
      { label: 'EBIT', cells: map(v => C.fmtDollars(v.ebit)), cls: 'sum' },
      { label: 'Interest', cells: map(v => C.fmtCost(v.interest)) },
      { label: 'EBT', cells: map(v => C.fmtDollars(v.ebt)), cls: 'sum' },
      { label: 'Taxes (' + C.fmtNumber(tax * 100, 0) + '%)', cells: map(v => C.fmtCost(v.taxes)) },
      { label: 'Net income', cells: map(v => C.fmtDollars(v.netIncome)), cls: 'sum' },
      { label: 'ROE', cells: map(v => C.fmtPct(v.roe)), cls: 'key' },
      { label: 'TIE', cells: map(v => C.fmtMult(v.tie)), cls: 'key' }
    ];
  }

  function renderFirms(scenarios, firms, tax) {
    const u = C.firmScenarios(scenarios, firms.total_assets, 0, firms.interest_rate, tax);
    const l = C.firmScenarios(scenarios, firms.total_assets, firms.firm_l_debt, firms.interest_rate, tax);
    const headers = scenarios.map(s => 'p = ' + C.fmtNumber(s.probability, 2));

    document.getElementById('firms-intro').textContent =
      'Both firms have ' + C.fmtDollars(firms.total_assets) + ' of assets and a ' +
      C.fmtNumber(tax * 100, 0) + '% tax rate and face the same EBIT in each kind of year. ' +
      'Firm L has ' + C.fmtDollars(firms.firm_l_debt) + ' of debt at ' + C.fmtPct(firms.interest_rate) + '.';
    document.getElementById('firm-l-sub').textContent =
      C.fmtDollars(firms.firm_l_debt) + ' debt at ' + C.fmtPct(firms.interest_rate);

    fillStatement(document.getElementById('firm-u'), headers, firmRows(u, tax));
    fillStatement(document.getElementById('firm-l'), headers, firmRows(l, tax));
    fillStatement(document.getElementById('firm-stats'), ['Firm U', 'Firm L'], [
      { label: 'E(ROE)', cells: [C.fmtPct(u.eRoe), C.fmtPct(l.eRoe)] },
      { label: 'σ(ROE)', cells: [C.fmtPct(u.sdRoe), C.fmtPct(l.sdRoe)] },
      { label: 'CV', cells: [C.fmtNumber(u.cvRoe, 2), C.fmtNumber(l.cvRoe, 2)] },
      { label: 'E(TIE)', cells: [C.fmtMult(u.eTie), C.fmtMult(l.eTie)] },
      { label: 'σ(TIE)', cells: [C.fmtMult(u.sdTie), C.fmtMult(l.sdTie)] }
    ]);
    document.getElementById('firms').hidden = false;
  }

  function renderCdss(cdss, schedule, tax) {
    const base = {
      ebit: C.cdssEbit(cdss),
      tax: tax,
      shares: cdss.shares_outstanding,
      price: cdss.share_price,
      assets: cdss.total_assets
    };
    const rows = C.cdssTable(schedule, base);

    document.querySelectorAll('.p0').forEach(s => { s.textContent = C.fmtCents(base.price); });
    document.getElementById('cdss-intro').textContent =
      'EBIT = ' + C.fmtDollars(cdss.sales) + ' × (1 − ' + C.fmtPct(cdss.variable_cost_rate) + ') − ' +
      C.fmtDollars(cdss.fixed_costs) + ' = ' + C.fmtDollars(base.ebit) +
      ', the same at every amount of debt. Tax rate ' + C.fmtPct(tax) + '. ' +
      C.fmtNumber(base.shares, 0) + ' shares outstanding today at ' + C.fmtCents(base.price) +
      '. Total book assets ' + C.fmtDollars(base.assets) + '. CDSS pays out all its earnings, so dividends per share = EPS.';

    const common = [
      { label: 'Debt', value: r => C.fmtDollars(r.debt) },
      { label: 'r_d', value: r => C.fmtPct(r.rd) },
      { label: 'r_s', value: r => C.fmtPct(r.rs) },
      { label: 'Net income', value: r => C.fmtDollars(r.netIncome) }
    ];

    fillGrid(document.getElementById('case-table'), common.concat([
      { label: 'Shares repurchased', value: r => C.fmtNumber(r.caseMethod.repurchased, 2) },
      { label: 'Shares remaining', value: r => C.fmtNumber(r.caseMethod.remaining, 2) },
      { label: 'EPS', value: r => C.fmtCents(r.caseMethod.eps) },
      { label: 'TIE', value: r => C.fmtMult(r.tie) },
      { label: 'Share price', value: r => C.fmtCents(r.caseMethod.price) },
      { label: 'WACC (book)', value: r => C.fmtPct(r.caseMethod.wacc) }
    ]), rows);

    fillGrid(document.getElementById('new-table'), common.concat([
      { label: 'Equity value S', value: r => C.fmtDollars(r.newMethod.equityValue) },
      { label: 'Firm value V', value: r => C.fmtDollars(r.newMethod.firmValue) },
      { label: 'Share price', value: r => C.fmtCents(r.newMethod.price) },
      { label: 'Shares repurchased', value: r => C.fmtNumber(r.newMethod.repurchased, 2) },
      { label: 'Shares remaining', value: r => C.fmtNumber(r.newMethod.remaining, 2) },
      { label: 'EPS', value: r => C.fmtCents(r.newMethod.eps) },
      { label: 'TIE', value: r => C.fmtMult(r.tie) },
      { label: 'WACC (market)', value: r => C.fmtPct(r.newMethod.wacc) }
    ]), rows);

    renderBest(C.cdssBest(rows));
    showWarnings(C.cdssChecks(rows, base));
    document.getElementById('cdss').hidden = false;
  }

  function renderBest(b) {
    const box = document.getElementById('best');
    box.textContent = '';
    box.appendChild(el('h3', null, 'Which amount of debt is best?'));
    const list = el('ul', { class: 'best-list' });
    [
      ['Highest share price, case method', b.casePrice],
      ['Highest share price, new-price method', b.newPrice],
      ['Lowest WACC, book weights', b.bookWacc],
      ['Lowest WACC, market weights', b.marketWacc]
    ].forEach(([label, debt]) => {
      const li = el('li');
      li.appendChild(el('span', null, label));
      li.appendChild(el('strong', null, debt === null ? 'n/a' : C.fmtDollars(debt)));
      list.appendChild(li);
    });
    box.appendChild(list);
    const all = [b.casePrice, b.newPrice, b.bookWacc, b.marketWacc];
    const agree = all.every(d => d === all[0]);
    box.appendChild(el('p', { class: 'note' }, agree
      ? 'All four measures point to the same amount of debt.'
      : 'These measures don\'t all point to the same amount of debt, so the page doesn\'t pick one.'));
    box.appendChild(el('p', { class: 'note' },
      'Highest EPS: ' + C.fmtDollars(b.caseEps) + ' (case method), ' + C.fmtDollars(b.newEps) +
      ' (new-price method). On an exact tie the smaller amount of debt is shown.'));
  }

  function showWarnings(problems) {
    const box = document.getElementById('warnings');
    box.textContent = '';
    problems.forEach(p => box.appendChild(el('p', { class: 'warning', role: 'alert' }, '⚠ ' + p)));
  }

  async function main() {
    const status = document.getElementById('status');
    try {
      const [cdssRows, assumptionRows, scheduleRows, firmRowsCsv, scenarioRows] = await Promise.all([
        loadCSV('data/cdss.csv'),
        loadCSV('data/assumptions.csv'),
        loadCSV('data/banker_schedule.csv'),
        loadCSV('data/example_firms.csv'),
        loadCSV('data/ebit_scenarios.csv')
      ]);
      const tax = C.itemsToObject(assumptionRows.map(r => ({ item: r.assumption, value: r.value }))).tax_rate;
      const cdss = C.itemsToObject(cdssRows);
      const firms = C.itemsToObject(firmRowsCsv);
      const scenarios = scenarioRows.map(r => ({
        probability: C.num(r.probability),
        sales: C.num(r.sales),
        operating_costs: C.num(r.operating_costs)
      }));
      const schedule = C.parseSchedule(scheduleRows);

      renderFirms(scenarios, firms, tax);
      renderCdss(cdss, schedule, tax);
      status.hidden = true;
    } catch (err) {
      status.textContent = 'Something went wrong loading the data: ' + err.message +
        '. If you opened index.html straight from your computer, serve it from a web address instead (GitHub Pages does this).';
      status.classList.add('warning');
    }
  }

  main();
})();
