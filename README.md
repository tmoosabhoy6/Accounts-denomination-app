# Cash Book

A simple app for recording cash handed out, by note, in Iraqi Dinar (IQD) or US Dollar (USD).

## The two screens

1. **New Entry**
   - Pick **IQD** or **USD**, then count the notes. Each line works out its amount, and the total is shown at the bottom.
   - Write who received the cash, pick the department and press **Save Entry**. The date fills in with today automatically.
   - New departments can be added from the bottom of the department list.
2. **History**
   - Every saved entry, grouped by day, with the date shown clearly on each one.
   - Filter by currency, name, department, date range and amount.
   - Tap an entry to see its notes. **Download for Excel** saves the filtered list.

## Where the records are kept

There is no online database. Records are kept on the accounts computer:

- **In the browser.** Each entry is kept the moment it is saved.
- **In the chosen folder.** Each day is written into its own dated folder:

  ```
  Cash Book\
    2026\
      11 - November\
        2026-11-02\
          Cash Book 2026-11-02.csv          ← open this in Excel
          Cash Book 2026-11-02 - data.json  ← read back by the History screen
    Cash Book departments.json              ← departments added in the app
  ```

Entries are written into the folder automatically. If the browser is waiting for permission, a banner appears; press **Allow** or **Save now**.

**Use Chrome or Edge on the accounts computer.** Other browsers and phones can't save into folders. On those, the app downloads the day's Excel file instead.

**Don't clear the browser's history or site data** while the top-right button says "not saved yet".

## Publishing the site (GitHub Pages)

Go to **Settings → Pages**, set Source to **Deploy from a branch**, pick branch `main` and folder `/ (root)`, and click **Save**.
The site appears at `https://<username>.github.io/<repository-name>/` after a minute or two.
