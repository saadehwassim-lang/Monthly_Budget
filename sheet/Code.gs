/**
 * Personal Budget — the whole backend.
 *
 * Lives inside the spreadsheet itself (Extensions → Apps Script), so there is no
 * server to run, nothing to pay for, and no third service between the phone and
 * the sheet. Deploy it once as a Web App and the URL is the API.
 *
 * Two endpoints:
 *   GET  ?token=…            → categories, budgets and transactions
 *   POST {token, amount, …}  → appends one row, returns what it wrote
 */

// ─── set this to a long random string, and use the same one in the app ──────
const TOKEN = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

const TX_SHEET      = 'Transactions';
const CAT_SHEET     = 'Categories';   // a read-only mirror, for reference
const MONTHLY_SHEET = 'Monthly';      // the single source of truth
const MONTHS        = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TZ            = 'Asia/Dubai';
const CURRENCY      = 'AED';
const PEOPLE        = ['Wassim', 'Jamela'];

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    if ((e.parameter.token || '') !== TOKEN) return json_({ ok: false, error: 'Not recognised' });
    return json_({
      ok: true,
      currency: CURRENCY,
      people: PEOPLE,
      categories: readTaxonomy_(),
      rows: readTransactions_(Number(e.parameter.months || 4)),
      serverMonth: Utilities.formatDate(new Date(), TZ, 'MMM'),
      serverYear: Number(Utilities.formatDate(new Date(), TZ, 'yyyy')),
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if ((body.token || '') !== TOKEN) return json_({ ok: false, error: 'Not recognised' });

    // Removing a test entry, or undoing a mistake, from the phone.
    if (body.action === 'delete') return deleteRow_(String(body.key || ''));

    const amount = Number(body.amount);
    if (!isFinite(amount) || amount <= 0) return json_({ ok: false, error: 'Bad amount' });
    if (!body.category || !body.segment)  return json_({ ok: false, error: 'Missing category' });

    const who = PEOPLE.indexOf(body.who) >= 0 ? body.who : PEOPLE[0];
    const now = body.at ? new Date(body.at) : new Date();
    const date = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const time = Utilities.formatDate(now, TZ, 'HH:mm');
    const month = Utilities.formatDate(now, TZ, 'MMM');
    const year = Number(Utilities.formatDate(now, TZ, 'yyyy'));
    const key = date + '-' + who + '-' + now.getTime() + '-' +
                Math.random().toString(36).slice(2, 8);

    const row = [key, date, time, who, Math.round(amount * 100) / 100, CURRENCY,
                 String(body.category), String(body.segment),
                 String(body.note || '').slice(0, 200), month, year, now.toISOString()];

    // A lock, because two phones saving at the same instant would otherwise both
    // read the same last row and one would overwrite the other.
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = SpreadsheetApp.getActive().getSheetByName(TX_SHEET);
      const newRow = sh.getLastRow() + 1;
      // Date and Time (B:C) have to stay plain text. Sheets auto-detects a
      // string that merely LOOKS like a date or time — "14:23", "2026-09-14"
      // — and silently converts it into a real date/time serial the moment
      // it lands in the cell. Read back later, that serial gets reconstructed
      // as a Date object through whichever timezone Apps Script defaults to
      // at that boundary, which is not necessarily Asia/Dubai — and that
      // mismatch is exactly what turns a 14:23 save into a displayed 02:23.
      // Formatting the cells as text *before* the value is written is the
      // only point this can be stopped at; reformatting afterwards would
      // just redisplay an already-corrupted serial.
      sh.getRange(newRow, 2, 1, 2).setNumberFormat('@');
      sh.getRange(newRow, 1, 1, row.length).setValues([row]);
    } finally {
      lock.releaseLock();
    }

    return json_({ ok: true, row: {
      key: key, date: date, time: time, who: who, amount: row[4], currency: CURRENCY,
      category: row[6], segment: row[7], note: row[8], month: month, year: year } });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * Categories, segments and budgets read straight from the Monthly tab — the same
 * rows and the same yellow cells you edit. There is deliberately no second list
 * to keep in step: change a budget in Monthly column D and the app has changed.
 *
 * A row counts as a real segment when B and C are both filled, B is not the
 * header word, and C is not a "Total …" line.
 */
function readTaxonomy_() {
  const rows = monthlyRows_();
  const out = [], index = {};
  rows.forEach(function (r) {
    if (!(r.category in index)) {
      index[r.category] = out.length;
      out.push({ name: r.category, segments: [], budgets: [] });
    }
    out[index[r.category]].segments.push(r.segment);
    out[index[r.category]].budgets.push(r.budget);
  });
  return out;
}

/** Every real segment row in Monthly, with its sheet row number. */
function monthlyRows_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(MONTHLY_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(1, 2, last, 3).getValues();   // B, C, D
  const out = [];
  for (var i = 1; i < vals.length; i++) {          // row 1 holds the Year, never data
    const cat = String(vals[i][0] || '').trim();
    const seg = String(vals[i][1] || '').trim();
    if (!cat || !seg) continue;
    if (typeof vals[i][0] === 'number') continue;  // a stray number is not a category
    if (cat === 'Category') continue;                    // a block header
    if (seg.indexOf('Total') === 0) continue;            // a subtotal or summary line
    if (cat.indexOf('Jamela') === 0) continue;           // the summary block
    out.push({ row: i + 1, category: cat, segment: seg, budget: Number(vals[i][2]) || 0 });
  }
  return out;
}

/**
 * Removes one row from Transactions by its key (column A). Used for Undo and for
 * tapping a Recent entry — both send { action: 'delete', key }.
 *
 * Column A is searched from the bottom up because a delete almost always targets
 * something logged in the last few minutes, and the same script lock as a save
 * keeps a delete from racing a concurrent append.
 */
function deleteRow_(key) {
  if (!key) return json_({ ok: false, error: 'No key given' });
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(TX_SHEET);
    const last = sh.getLastRow();
    if (last < 2) return json_({ ok: false, error: 'That entry is gone already' });
    const keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = keys.length - 1; i >= 0; i--) {
      if (String(keys[i][0]) === key) { sh.deleteRow(i + 2); return json_({ ok: true }); }
    }
    return json_({ ok: false, error: 'That entry is gone already' });
  } finally {
    lock.releaseLock();
  }
}

/** Recent transactions, newest first. */
function readTransactions_(months) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TX_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, 12).getValues();
  const cut = new Date();
  cut.setMonth(cut.getMonth() - Math.max(1, months));
  const cutStr = Utilities.formatDate(cut, TZ, 'yyyy-MM-dd');

  const out = [];
  vals.forEach(function (v) {
    const date = v[1] instanceof Date ? Utilities.formatDate(v[1], TZ, 'yyyy-MM-dd') : String(v[1] || '');
    if (!date || date < cutStr) return;
    const amt = Number(v[4]);
    if (!isFinite(amt)) return;
    out.push({ key: String(v[0]), date: date,
      time: v[2] instanceof Date ? Utilities.formatDate(v[2], TZ, 'HH:mm') : String(v[2] || ''),
      who: String(v[3]), amount: amt, currency: String(v[5] || CURRENCY),
      category: String(v[6]), segment: String(v[7]), note: String(v[8] || ''),
      month: String(v[9]), year: Number(v[10]) });
  });
  out.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Menu — so changing the budget structure never means editing formulas by hand.
 * Reload the spreadsheet after pasting this and a "Budget" menu appears.
 * ══════════════════════════════════════════════════════════════════════════ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Budget')
    .addItem('Add a segment…', 'addSegment')
    .addItem('Add a category…', 'addCategory')
    .addSeparator()
    .addItem('Repair totals', 'repairTotals')
    .addItem('Refresh Categories tab', 'syncCategories')
    .addSeparator()
    .addItem('Check setup', 'selfTestUi')
    .addToUi();
}

const MONTH_COLS = 12, FIRST_MONTH_COL = 5;   // E..P

/** The formulas a segment row carries, written for one specific row. */
function segmentFormulas_(row, headerRow) {
  const f = [];
  for (var i = 0; i < MONTH_COLS; i++) {
    const col = columnLetter_(FIRST_MONTH_COL + i);
    f.push('=SUMIFS(Transactions!$E:$E,Transactions!$G:$G,$B' + row +
           ',Transactions!$H:$H,$C' + row +
           ',Transactions!$J:$J,' + col + '$' + headerRow +
           ',Transactions!$K:$K,$B$1)');
  }
  return f;
}
function columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/** The header row of the block a given row sits in (the row saying "Category"). */
function blockHeaderFor_(sh, row) {
  for (var r = row; r >= 1; r--) {
    if (String(sh.getRange(r, 2).getValue()).trim() === 'Category') return r;
  }
  return 2;
}

function addSegment() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActive().getSheetByName(MONTHLY_SHEET);
  const tax = readTaxonomy_();
  const names = tax.map(function (c) { return c.name; });

  const a = ui.prompt('Add a segment', 'Which category?\n\n' + names.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const cat = a.getResponseText().trim();
  if (names.indexOf(cat) < 0) { ui.alert('No category called "' + cat + '".'); return; }

  const b = ui.prompt('Add a segment', 'Name of the new segment?', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  const seg = b.getResponseText().trim();
  if (!seg) return;
  if (tax.filter(function (c) { return c.name === cat; })[0].segments.indexOf(seg) >= 0) {
    ui.alert('"' + seg + '" already exists in ' + cat + '.'); return;
  }

  const c = ui.prompt('Add a segment', 'Monthly budget for ' + seg + '? (0 is fine)', ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  const budget = Number(c.getResponseText()) || 0;

  const rows = monthlyRows_().filter(function (r) { return r.category === cat; });
  const lastRow = rows[rows.length - 1].row;
  const headerRow = blockHeaderFor_(sh, lastRow);

  sh.insertRowAfter(lastRow);
  const nr = lastRow + 1;
  sh.getRange(nr, 1).setValue(rows.length + 1);
  sh.getRange(nr, 2).setValue(cat);
  sh.getRange(nr, 3).setValue(seg);
  const bud = sh.getRange(nr, 4);
  bud.setValue(budget).setFontColor('#0000FF').setBackground('#FFFF00')
     .setNumberFormat('#,##0.00;(#,##0.00);-');
  sh.getRange(nr, FIRST_MONTH_COL, 1, MONTH_COLS)
    .setFormulas([segmentFormulas_(nr, headerRow)])
    .setNumberFormat('#,##0.00;(#,##0.00);-');
  sh.getRange(nr, 17).setFormula('=SUM(E' + nr + ':P' + nr + ')')
    .setNumberFormat('#,##0.00;(#,##0.00);-');
  sh.getRange(nr, 18).setFormula('=D' + nr + '*12')
    .setNumberFormat('#,##0.00;(#,##0.00);-');

  repairTotals();
  syncCategories();
  ui.alert('Added "' + seg + '" to ' + cat + '.\n\nOn your phone, open the app and pull Refresh — the new button appears.');
}

function addCategory() {
  SpreadsheetApp.getUi().alert(
    'Adding a whole category',
    'Copy an existing block in Monthly — its header row, its segment rows and its ' +
    '"Total …" row — paste it below the last block, then rename column B and C ' +
    'in the pasted rows.\n\nThen run Budget → Repair totals.\n\n' +
    'Doing it this way keeps the block shape the rest of the sheet expects.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Rewrites every subtotal, the summary block and every month formula from the
 * sheet's current shape. Safe to run any time — it is the undo for a row
 * inserted or deleted in the wrong place.
 */
function repairTotals() {
  const sh = SpreadsheetApp.getActive().getSheetByName(MONTHLY_SHEET);
  const last = sh.getLastRow();
  const colB = sh.getRange(1, 2, last, 2).getValues();

  // month formulas, so a row that was copied or moved still points at itself
  const rows = monthlyRows_();
  rows.forEach(function (r) {
    const headerRow = blockHeaderFor_(sh, r.row);
    sh.getRange(r.row, FIRST_MONTH_COL, 1, MONTH_COLS)
      .setFormulas([segmentFormulas_(r.row, headerRow)]);
    sh.getRange(r.row, 17).setFormula('=SUM(E' + r.row + ':P' + r.row + ')');
    sh.getRange(r.row, 18).setFormula('=D' + r.row + '*12');
  });

  // one subtotal per category block
  const byCat = {};
  rows.forEach(function (r) {
    if (!byCat[r.category]) byCat[r.category] = [];
    byCat[r.category].push(r.row);
  });
  const subtotalRow = {};
  Object.keys(byCat).forEach(function (cat) {
    const rs = byCat[cat];
    const first = rs[0], lastR = rs[rs.length - 1];
    for (var r = lastR + 1; r <= Math.min(lastR + 4, last); r++) {
      if (String(colB[r - 1][1] || '').indexOf('Total') === 0) {
        subtotalRow[cat] = r;
        for (var col = 4; col <= 18; col++) {
          const L = columnLetter_(col);
          sh.getRange(r, col).setFormula('=SUM(' + L + first + ':' + L + lastR + ')');
        }
        break;
      }
    }
  });

  // the summary block at the top points at each subtotal
  for (var r = 3; r < 12; r++) {
    const label = String(sh.getRange(r, 3).getValue() || '');
    if (label.indexOf('Total ') !== 0) continue;
    const cat = label.replace('Total ', '');
    if (!subtotalRow[cat]) continue;
    for (var col = 4; col <= 18; col++) {
      sh.getRange(r, col).setFormula('=' + columnLetter_(col) + subtotalRow[cat]);
    }
  }
  SpreadsheetApp.flush();
}

/** Rewrites the Categories tab to match Monthly. Purely for your reference. */
function syncCategories() {
  const ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CAT_SHEET);
  if (!sh) sh = ss.insertSheet(CAT_SHEET);
  const rows = monthlyRows_();
  sh.clear();
  sh.getRange(1, 1, 1, 3).setValues([['Category', 'Segment', 'Monthly budget']])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3864');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 3).setValues(rows.map(function (r) {
      return [r.category, r.segment, r.budget];
    }));
  }
  sh.getRange(1, 5).setValue('Read-only. Edit budgets in Monthly column D; this mirrors them.')
    .setFontStyle('italic').setFontColor('#808080');
  sh.setFrozenRows(1);
}

function selfTestUi() {
  SpreadsheetApp.getUi().alert('Check setup', selfTest(), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Run this once from the editor to check everything is wired up. */
function selfTest() {
  const ss = SpreadsheetApp.getActive();
  [TX_SHEET, MONTHLY_SHEET].forEach(function (n) {
    if (!ss.getSheetByName(n)) throw new Error('Missing sheet: ' + n);
  });
  const tax = readTaxonomy_();
  const segs = tax.reduce(function (a, c) { return a + c.segments.length; }, 0);
  const tx = readTransactions_(12);
  const msg = tax.length + ' categories, ' + segs + ' segments, ' + tx.length + ' recent transactions.' +
    (TOKEN === 'REPLACE_WITH_A_LONG_RANDOM_STRING' ? '\n\n⚠ Set TOKEN before deploying.' : '\n\nToken is set.');
  Logger.log(msg);
  return msg;
}
