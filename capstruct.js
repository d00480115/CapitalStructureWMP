/*
 * capstruct.js: the finance math for the AGE capital structure app.
 *
 * Every function here is plain math: none of them touches the web page.
 * That lets us check the numbers with Node, for example:
 *   node -e "const c = require('./capstruct.js'); console.log(c.roundHalfUp(0.14025 * 100, 2))"
 *
 * In the browser the functions are available as window.CapStruct.
 */
(function (root) {
  'use strict';

  // ---------- Rounding and formatting ----------

  // Round half up on the decimal value. JavaScript's toFixed rounds the
  // binary value instead, so toFixed(2) turns 14.025 into "14.02".
  // toPrecision(12) strips the tiny binary error before rounding.
  function roundHalfUp(x, d) {
    const f = Math.pow(10, d);
    return Math.round(Number((x * f).toPrecision(12))) / f;
  }

  function withCommas(text) {
    const parts = text.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  // Format a number to d decimals with thousands separators.
  function fmtNumber(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    const r = roundHalfUp(Math.abs(x), d);
    const text = withCommas(r.toFixed(d));
    return (x < 0 && r !== 0 ? '−' : '') + text;
  }

  // Dollars to the nearest dollar, e.g. $2,000,000
  function fmtDollars(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    const r = roundHalfUp(Math.abs(x), 0);
    return (x < 0 && r !== 0 ? '−' : '') + '$' + withCommas(r.toFixed(0));
  }

  // A cost shown in parentheses, as in the case's income statements: (4,000)
  function fmtCost(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    return '(' + withCommas(roundHalfUp(x, 0).toFixed(0)) + ')';
  }

  // Prices, EPS and dividends to the cent, e.g. $21.58
  function fmtCents(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    const r = roundHalfUp(Math.abs(x), 2);
    return (x < 0 && r !== 0 ? '−' : '') + '$' + withCommas(r.toFixed(2));
  }

  // A rate such as 0.14025 shown as a percent to two decimals: 14.03%
  function fmtPct(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    return fmtNumber(x * 100, 2) + '%';
  }

  // Multiples such as TIE to two decimals: 20.00×
  function fmtMult(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    return fmtNumber(x, 2) + '×';
  }

  // ---------- Reading CSV text ----------

  // Turn CSV text into an array of objects keyed by the header row.
  // Handles quoted fields that contain commas.
  function parseCSV(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    const src = String(text).replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''));
    if (!nonEmpty.length) return [];
    const header = nonEmpty[0].map(h => h.trim());
    return nonEmpty.slice(1).map(r => {
      const obj = {};
      header.forEach((h, j) => { obj[h] = (r[j] === undefined ? '' : r[j].trim()); });
      return obj;
    });
  }

  // A number from a CSV cell, or null if the cell is empty.
  function num(cell) {
    if (cell === undefined || cell === null || String(cell).trim() === '') return null;
    const v = Number(cell);
    if (!isFinite(v)) throw new Error('Not a number: "' + cell + '"');
    return v;
  }

  // Rows of item,value (with or without a section column) into { item: number }.
  function itemsToObject(rows) {
    const out = {};
    rows.forEach(r => { out[r.item] = num(r.value); });
    return out;
  }

  // The banker's schedule, sorted by amount borrowed.
  function parseSchedule(rows) {
    return rows.map(r => ({
      debt: num(r.debt),
      rd: num(r.cost_of_debt),
      rs: num(r.cost_of_equity)
    })).sort((a, b) => a.debt - b.debt);
  }

  // ---------- Statistics ----------

  // Probability-weighted average.
  function expected(probs, values) {
    return probs.reduce((s, p, i) => s + p * values[i], 0);
  }

  // Square root of the probability-weighted squared deviations.
  function stdDev(probs, values) {
    const m = expected(probs, values);
    return Math.sqrt(probs.reduce((s, p, i) => s + p * Math.pow(values[i] - m, 2), 0));
  }

  // ---------- Firm U and Firm L (question c) ----------

  /*
   * One firm's partial income statements in each kind of year.
   *   scenarios: [{ probability, sales, operating_costs }]
   *   assets, debt, rate (interest rate on debt), tax (T)
   */
  function firmScenarios(scenarios, assets, debt, rate, tax) {
    const equity = assets - debt;
    const years = scenarios.map(s => {
      const ebit = s.sales - s.operating_costs;
      const interest = rate * debt;
      const ebt = ebit - interest;
      const taxes = tax * ebt;
      const netIncome = ebt - taxes;
      return {
        probability: s.probability,
        assets: assets,
        equity: equity,
        sales: s.sales,
        operatingCosts: s.operating_costs,
        ebit: ebit,
        interest: interest,
        ebt: ebt,
        taxes: taxes,
        netIncome: netIncome,
        roe: netIncome / equity,
        tie: interest > 0 ? ebit / interest : null // no interest: TIE is n/a
      };
    });
    const probs = years.map(y => y.probability);
    const roes = years.map(y => y.roe);
    const eRoe = expected(probs, roes);
    const sdRoe = stdDev(probs, roes);
    const hasDebt = debt > 0 && rate > 0;
    const ties = years.map(y => y.tie);
    return {
      debt: debt,
      equity: equity,
      years: years,
      eRoe: eRoe,
      sdRoe: sdRoe,
      cvRoe: sdRoe / eRoe,
      eTie: hasDebt ? expected(probs, ties) : null,
      sdTie: hasDebt ? stdDev(probs, ties) : null
    };
  }

  // ---------- CDSS ----------

  // EBIT = sales × (1 − variable cost rate) − fixed costs
  function cdssEbit(cdss) {
    return cdss.sales * (1 - cdss.variable_cost_rate) - cdss.fixed_costs;
  }

  /*
   * One amount of borrowing under both buyback methods.
   *   row:  { debt, rd, rs } from the banker's schedule
   *   base: { ebit, tax, shares (n), price (P₀), assets (A) }
   */
  function cdssAtDebt(row, base) {
    const D = row.debt;
    const rd = D > 0 ? row.rd : 0;
    const rs = row.rs;
    const T = base.tax;
    const n = base.shares;
    const A = base.assets;

    const interest = rd * D;
    const netIncome = (base.ebit - interest) * (1 - T);
    const tie = interest > 0 ? base.ebit / interest : null;

    // Case method (question d(3) and d(4)): buy back at today's price P₀.
    const caseRepurchased = D / base.price;
    const caseRemaining = n - caseRepurchased;
    const caseEps = netIncome / caseRemaining;
    const caseMethod = {
      repurchased: caseRepurchased,
      remaining: caseRemaining,
      eps: caseEps,
      dps: caseEps, // all earnings paid out
      price: caseEps / rs,
      // Book weights (the AGE solution's method for d(7))
      wacc: (D / A) * rd * (1 - T) + ((A - D) / A) * rs
    };

    // New-price method: buy back at the price after the announcement.
    const S = netIncome / rs;
    const V = S + D;
    const P = V / n;
    const newRepurchased = D / P;
    const newRemaining = n - newRepurchased;
    const newEps = netIncome / newRemaining;
    const newMethod = {
      equityValue: S,
      firmValue: V,
      price: P,
      repurchased: newRepurchased,
      remaining: newRemaining,
      eps: newEps,
      dps: newEps,
      // Market weights
      wacc: (D / V) * rd * (1 - T) + (S / V) * rs,
      // Checks: EPS = r_s × P, and WACC = EBIT × (1 − T) / V
      epsCheck: rs * P,
      waccCheck: base.ebit * (1 - T) / V
    };

    return {
      debt: D,
      rd: D > 0 ? row.rd : null,
      rs: rs,
      interest: interest,
      netIncome: netIncome,
      tie: tie,
      caseMethod: caseMethod,
      newMethod: newMethod
    };
  }

  function cdssTable(schedule, base) {
    return schedule.map(row => cdssAtDebt(row, base));
  }

  // Index of the best row; on an exact tie, keep the smaller amount of debt
  // (rows are sorted by debt, so the first one found wins).
  function bestIndex(rows, valueOf, higherIsBetter) {
    let best = -1;
    rows.forEach((r, i) => {
      const v = valueOf(r);
      if (v === null || !isFinite(v)) return;
      if (best < 0) { best = i; return; }
      const b = valueOf(rows[best]);
      if (higherIsBetter ? v > b : v < b) best = i;
    });
    return best;
  }

  // Which amount of debt is best by each measure.
  function cdssBest(rows) {
    const pick = (f, hi) => {
      const i = bestIndex(rows, f, hi);
      return i < 0 ? null : rows[i].debt;
    };
    return {
      casePrice: pick(r => r.caseMethod.price, true),
      newPrice: pick(r => r.newMethod.price, true),
      caseEps: pick(r => r.caseMethod.eps, true),
      newEps: pick(r => r.newMethod.eps, true),
      bookWacc: pick(r => r.caseMethod.wacc, false),
      marketWacc: pick(r => r.newMethod.wacc, false)
    };
  }

  // Checks that should hold. Each failure is a message to show on the page.
  function cdssChecks(rows, base) {
    const problems = [];
    const zero = rows.find(r => r.debt === 0);
    if (!zero) {
      problems.push('The banker\'s schedule has no $0 row, so the app can\'t check today\'s price.');
    } else {
      const implied = zero.caseMethod.eps / zero.rs;
      if (roundHalfUp(implied, 2) !== roundHalfUp(base.price, 2)) {
        problems.push('With no debt, EPS / r_s = ' + fmtCents(implied) +
          ', but today\'s share price in cdss.csv is ' + fmtCents(base.price) +
          '. The schedule\'s cost of equity at $0 doesn\'t match the market price.');
      }
    }
    rows.forEach(r => {
      if (r.debt > 0 && (r.rd === null || !isFinite(r.rd))) {
        problems.push('The schedule has no cost of debt at ' + fmtDollars(r.debt) + '.');
      }
      const m = r.newMethod;
      if (Math.abs(m.eps - m.epsCheck) > 1e-9 * Math.max(1, Math.abs(m.eps))) {
        problems.push('New-price check failed at ' + fmtDollars(r.debt) + ': EPS ≠ r_s × P.');
      }
      if (Math.abs(m.wacc - m.waccCheck) > 1e-12) {
        problems.push('Market-weight WACC check failed at ' + fmtDollars(r.debt) + '.');
      }
      if (r.caseMethod.remaining <= 0) {
        problems.push('At ' + fmtDollars(r.debt) + ' the $20 buyback would retire every share.');
      }
    });
    return problems;
  }

  const api = {
    roundHalfUp, fmtNumber, fmtDollars, fmtCost, fmtCents, fmtPct, fmtMult,
    parseCSV, num, itemsToObject, parseSchedule,
    expected, stdDev,
    firmScenarios,
    cdssEbit, cdssAtDebt, cdssTable, cdssBest, cdssChecks
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CapStruct = api;
})(typeof self !== 'undefined' ? self : this);
