# Personal Budget — phone app, your own sheet

Log spending on your phone; your Excel updates itself. Set a monthly budget per
segment and see it against what you have actually spent, live.

No n8n, no Telegram, no server, nothing monthly. The backend is a short script that
lives inside the spreadsheet.

## What is here

| | |
|---|---|
| `sheet/Personal-Budget-Live.xlsx` | Your Monthly layout, with the month columns now filling themselves |
| `sheet/Code.gs` | The whole backend. Paste into Extensions → Apps Script |
| `app/` | The phone app. Host the folder; add to home screen |
| `SETUP.md` | Start here — about 25 minutes |

## What changed from your manual file

Your **Monthly** tab keeps its shape: category blocks, `Monthly expected` in column
D, Jan–Dec across, subtotals per category and a grand total. The difference is that
the month columns are no longer typed — each is a `SUMIFS` over a new `Transactions`
tab, matching Category, Segment, Month and Year. Log something on the phone and the
figure appears where you would have typed it.

Two things I changed deliberately, both reversible:

- **Budgets are per segment, not per person.** Your file had `Wassim Gym 300` and
  `Jamela Gym 300` as separate budget rows; the list you sent has no person, so
  segments are budgeted once (Gym 600) and each transaction still records *who*.
  You keep the person breakdown in reporting without maintaining 60 budget rows.
- **Loan is not in the taxonomy**, because it was not in the list you sent. Your old
  file had it at zero throughout. Say the word and it comes back as a sixth category.

Everything else came straight across: 5 categories, 37 segments, and your existing
budget figures — 18,967.76 a month in total.

## The one number worth understanding

Each bar carries a black mark showing how far through the month you are. Being
*under budget* and *past the mark* are different things: half your Outing budget
gone on the 10th is fine on the first count and a problem on the second. That
distinction is what the app is for.

## One copy of the data

The Google Sheet holds everything; the phone, the laptop and any Excel download are
views of it. A tap on the phone appends a row through the Apps Script and every
formula recalculates immediately — the sheet is correct before you have put the
phone down. Other devices refetch when you come back to them, and a downloaded
`.xlsx` is a snapshot, not a live link.

## Removing entries

**Undo** on the confirmation screen for the one you just saved, or tap any row under
Recent and confirm. Deleting the row in the `Transactions` tab does the same thing.
An entry still waiting in the phone's outbox is simply dropped rather than sent.

## Dates

Stamped in Asia/Dubai, and the formulas match on the `Month` and `Year` columns
rather than the date itself — so no amount of re-formatting, downloading or
re-importing can quietly break a total. The entry screen offers **Today ·
Yesterday · Another day**, defaulting to today and resetting after each save, so
spending on the 31st logged on the 1st still lands in the right month.

## Editing it later

The **Monthly** tab is the single source of truth — the app reads its buttons and
budgets from the same rows you edit, so a budget change is one cell and nothing
else. A **Budget** menu appears in the spreadsheet with *Add a segment*, *Repair
totals* and *Refresh Categories tab*, so changing the structure never means editing
formulas by hand. `SETUP.md` has the details.

## Verified

- The workbook recalculates clean: 909 formulas, zero errors, checked with
  LibreOffice — and a logged transaction was traced through to the Monthly month
  column, the category subtotal, the grand total and Budget vs Actual.
- The app was driven end to end in a real mobile browser, both themes: connecting,
  choosing a person, the keypad, category → Back → category → segment, the
  confirmation showing the segment's remaining budget, then the Budget tab.
- Offline entries queue on the phone rather than vanishing.
- Undo and delete were tested against a stand-in sheet: undo after saving removes
  the row, tapping a Recent row arms it, **Keep** backs out without deleting,
  **Delete** removes exactly one, and undoing an entry that never left the phone
  clears the outbox instead of touching the sheet.
- Back-dating was tested: today sends no date at all (the server clock is more
  trustworthy than a phone's), Yesterday sends `2026-08-26T12:00:00+04:00`, the
  choice resets after each save so it cannot leak into the next entry, and future
  dates are blocked.
- Two-device propagation was tested with two live browsers sharing one stand-in
  sheet: logging AED 777 on the "phone" and returning to the "laptop" moved its
  total from 9,667 to 10,400 and put the entry at the top of Recent, with nothing
  pressed by hand.
- `Code.gs` is ES5 throughout, which is what Apps Script wants, and takes a script
  lock so two phones saving at once cannot overwrite each other.
- The segment detection was run against the real workbook: 37 segments across 5
  categories in the right order, budgets matching — and it caught a phantom
  category called "2026" leaking in from the Year cell, now fixed at both ends.
- *Add a segment* and *Repair totals* were simulated against the real file: the new
  row lands in its block, the subtotal and grand total absorb it, and the workbook
  still recalculates with zero errors across 923 formulas.
