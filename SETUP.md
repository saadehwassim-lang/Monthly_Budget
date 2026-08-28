# Setup — about 25 minutes, no server, nothing monthly

Three pieces: your sheet, a short script that lives *inside* it, and the app on
your phone. No n8n, no Telegram, nothing to keep running.

```
  📱 app  ──►  Apps Script (inside the sheet)  ──►  your sheet
                                                      │
                              Monthly · Budget vs Actual recalculate themselves
```

---

## 1 — The sheet (5 min)

1. Upload `sheet/Personal-Budget-Live.xlsx` to Google Drive
2. Right-click → **Open with → Google Sheets** → File → **Save as Google Sheets**
3. Open the **Monthly** tab. Column D — the yellow one — is your monthly budget per
   segment. I carried across the numbers from your file, so check them and adjust.

Everything else fills itself. The Jan–Dec columns are `SUMIFS` formulas reading the
`Transactions` tab, so the moment the app logs something, your Monthly view updates.
Nothing to press.

**Tabs:**

| | |
|---|---|
| **Monthly** | Your layout. Budget in D, months fill themselves, `Actual YTD` and `Expected / year` on the right. |
| **Budget vs Actual** | This month per segment: Budget · Spent · Left · Used% · **OVER / Close / OK**, colour-coded. |
| **Transactions** | The log. The app appends here. You never type in it. |
| **Categories** | What the app shows as buttons, mirrored from Monthly. |

> To get a real `.xlsx` back at any time: File → Download → Microsoft Excel.

---

## 2 — The script (10 min)

Still in the sheet: **Extensions → Apps Script**.

1. Delete whatever is in `Code.gs` and paste in `sheet/Code.gs`
2. On line 13, replace `REPLACE_WITH_A_LONG_RANDOM_STRING` with a long random
   string of your own. Keep it — the app needs the same one.
3. Save, then run **`selfTest`** once from the toolbar. Google will ask you to
   authorise it; that is you granting your own script access to your own sheet.
   It should log something like *"5 categories, 37 segments, 1 recent transactions."*
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy, then copy the URL ending in `/exec`
5. Add `?t=` and your code to the end of it — `…/exec?t=YOUR_TOKEN` — and keep
   that combined link. It is the one thing the app asks you to paste.

> "Anyone" sounds alarming but is required — your phone is an anonymous visitor to
> Google. The URL is unguessable and the script refuses every request without your
> token, so the token is the actual lock. Keep the combined link out of screenshots.

**Whenever you edit the script, deploy again** (Deploy → Manage deployments → edit →
Version: New version). Saving alone does not update the live URL — this catches
everyone once.

---

## 3 — The app (5 min)

The repo publishes itself to **GitHub Pages**. One setting, once:

**Settings → Pages → Build and deployment → Source: _GitHub Actions_.**

That is all. Every push to `main` rebuilds and redeploys — or run *Deploy app to
GitHub Pages* by hand from the **Actions** tab. A minute later the app is at

```
https://YOUR-USERNAME.github.io/YOUR-REPO/
```

with the read-only demo at `/demo/`. Open it on your phone, paste the combined
link from step 5 above — the `/exec` URL with `?t=YOUR_TOKEN` on the end — into
the one field on the Connect screen, press Connect, then **Share → Add to Home
Screen** so it opens like a normal app.

To skip the typing entirely, open this instead and it fills itself in:

```
https://YOUR-USERNAME.github.io/YOUR-REPO/?url=https://script.google.com/macros/s/…/exec&t=YOUR_TOKEN
```

> That link carries your token, so treat it like a password — send it to your own
> phone, not into a group chat.

**What is public and what is not.** The published page contains no URL and no
token: both are typed in once and live in that phone's local storage, so anyone
who finds the Pages URL sees the empty Connect screen and nothing else. The
*repository*, though, is a different question — `sheet/`, `taxonomy.json` and the
README carry your real budget figures, and Pages on a private repo needs a paid
GitHub plan. If those figures are not for public reading, host the app somewhere
else instead: `app/` is a plain static folder, so [Cloudflare
Pages](https://pages.cloudflare.com) or [Netlify
Drop](https://app.netlify.com/drop) will take it as a drag and drop.

**Building the site yourself:**

```
node build-site.mjs      # writes _site/ — the app at the root, demo at /demo/
```

Anything served over HTTPS works; every path in the app is relative, so it does
not care whether it sits at a domain root or under `/YOUR-REPO/`.

---

## How a tap on your phone reaches everything else

There is **one copy of the data** — the Google Sheet. The phone app, the laptop and
the Excel download are all views of it, which is why they cannot disagree.

```
  phone: tap "Lebanon Ticket"
        │
        │  HTTPS POST  {token, amount, who, category, segment}
        ▼
  Apps Script (inside the sheet)
        │  appends one row to Transactions
        ▼
  ┌──────────────────────────────────────────────┐
  │  Transactions   ← the new row                │
  │  Monthly        ← SUMIFS recalculates, instantly
  │  Budget vs Actual ← recalculates, instantly  │
  └──────────────────────────────────────────────┘
        │                              │
        │ GET (on open / focus)        │ File → Download
        ▼                              ▼
  laptop + phone app              a real .xlsx
```

**Into the sheet: immediate.** The moment you tap the segment, the row is appended
and every formula depending on it recalculates on Google's servers. Open the sheet
on your laptop and the number is already there — no import, no sync step. If the
sheet is *already open*, Google refreshes it on its own within a few seconds.

**Into the app on another device: when you come back to it.** The laptop refetches
on open, when you switch back to its window, and when you open the Budget tab. So
log something on the phone, click over to the laptop, and it is there. It does not
poll in the background — an app sitting untouched for an hour would burn Apps Script
quota for nothing.

**Into an Excel file: when you download one.** File → Download → Microsoft Excel
gives you a real `.xlsx`. That is a **snapshot** — editing that downloaded file does
not send anything back. Treat the Google Sheet as the live book and the download as
a copy for records or for your accountant.

**Both of you at once is safe.** The script takes a lock before appending, so two
phones saving in the same second queue rather than overwrite each other.

**No signal?** The entry is kept on the phone with a "waiting to reach the sheet"
banner and goes up by itself when you are back online.

---

## How the date is decided

Every row carries four date fields, all stamped in **Asia/Dubai** — never UTC, so a
purchase at 1am belongs to that night, not the next morning.

| Column | Example | What it is |
|---|---|---|
| `Date` | `2026-08-27` | the day, for reading and sorting |
| `Time` | `22:05` | when it was entered |
| `Month` | `Aug` | **what the formulas match on** |
| `Year` | `2026` | **what the formulas match on** |

`Monthly` and `Budget vs Actual` both match on `Month` + `Year`, not on `Date`. That
is deliberate: text and numbers compare identically however Google or Excel decides
to format a date column, so uploading, downloading or re-importing the file cannot
quietly break the totals.

**Which day gets used.** By default the day you log it — the phone sends no date at
all and the script stamps its own clock, which is more trustworthy than a phone's.

If you are logging something from an earlier day, the entry screen has
**Today · Yesterday · Another day**. Pick one and the entry is filed under that
date instead. It resets to Today after every save, so a back-dated entry cannot
silently apply to the next one, and future dates are blocked.

This matters most at a month boundary: dinner on 31 August logged on 1 September
would otherwise be charged to September's budget. Tap **Yesterday** and it lands
where it belongs.

**Offline entries keep their real time.** If you log with no signal, the moment you
made the entry is stored on the phone and sent with it — syncing an hour later does
not move it to the hour it synced.

---

## Removing an entry

Three ways, all of which end up in the same place — the row leaves `Transactions`
and every total recalculates.

**Straight after saving** — the confirmation screen has **Undo — remove that
entry**. One tap and it is gone. This is the one for test entries.

**Later, from the phone** — Budget tab → Recent → tap the entry. It turns red and
offers **Keep** or **Delete**. Two taps, so nothing is lost by brushing the screen.

**From the sheet** — right-click the row in `Transactions` → Delete row. Works the
same; use it for a bulk clear-out after testing.

An entry you logged with no signal has not reached the sheet yet, and undoing it
just takes it out of the phone's outbox — it will not surface later.

> The example row that ships in `Transactions` is there to show the format. Delete
> it whenever you like; nothing depends on it.

---

## Changing budgets and categories later

**One place to edit: the Monthly tab.** The app reads its buttons and budgets from
those same rows — there is no second list to keep in step.

### Change a budget

Monthly tab → column D (yellow) → type the new number. That is the whole job.

- The sheet updates instantly: `Budget vs Actual` and the subtotals recalculate.
- The app picks it up when you press **Refresh** on the Budget tab, or next time you
  open it. Nothing to redeploy.

### Add a segment

**Budget menu → Add a segment…** — it asks for the category, the name and the
budget, inserts the row in the right block with all its formulas, fixes the totals,
and refreshes the Categories tab. Press Refresh in the app and the new button is
there.

Doing it by hand works too: insert a row inside the block, fill B (category),
C (segment) and D (budget), then run **Budget → Repair totals** to write the
formulas and extend the subtotal.

### Rename or delete a segment

- **Rename:** edit column C. Note that past transactions keep the old name, so the
  old spending stops matching the renamed row. Rename only for a genuine
  correction, and if you have history you care about, use Find & Replace on the
  `Transactions` tab's Segment column too.
- **Delete:** delete the row, then **Budget → Repair totals**. Any past transactions
  in that segment stay in `Transactions` but stop appearing in Monthly — nothing is
  lost, it just no longer has a home. Set the budget to 0 instead if you would
  rather keep the history visible.

### Add a whole category

Copy an existing block — its header row, its segment rows and its `Total …` row —
paste it below the last block, rename column B and C in the pasted rows, then run
**Budget → Repair totals**. The menu item explains the same thing when you click it.

### If anything looks wrong

**Budget → Repair totals** rewrites every month formula, every subtotal and the
summary block from the sheet's current shape. It is the undo for a row inserted or
deleted in the wrong place, and it is safe to run any time.

---

## Using it

**Add** — pick who spent it, type the amount, tap category, tap segment. Both grids
show `spent of budget` on every button, so you can see a category is nearly gone
*before* you add to it. Back at every step.

**Budget** — this month against your budgets. The black mark on each bar is where
an even spender would be today, so being past it means running hot even when you
are still under budget. Categories sort worst-first, and each opens to its segments.

**Offline** — entries queue on the phone and go up when you have signal again.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Could not read the reply" | The URL must end in `/exec`, not `/dev` |
| Connects but shows no categories | The `Categories` tab is empty, or was renamed |
| Changes to the script do nothing | You saved but did not redeploy a **new version** |
| "Not recognised" | Token in the app ≠ `TOKEN` in the script |
| Sheet updates but Monthly stays 0 | The year in `Monthly!B1` does not match the transaction's year |
| Budget vs Actual all zero | The month in `B3` must be a three-letter name — `Aug`, not `August` |
| Two entries at once, one lost | Should not happen — the script takes a lock. Report it if it does. |
