# Cash Book

A very simple app for recording cash handed out, by note denomination.

**Live app:** https://tmoosabhoy6.github.io/Accounts-denomination-app/

## The two screens

1. **New Entry** – count the notes (50,000 · 25,000 · 10,000 · 5,000 · 1,000 · 500 · 250).
   Each line works out its amount and the total is shown at the bottom right.
   Then write who received the cash, pick the department, and press **Save Entry**.
   The date is filled in with today's date automatically.
2. **History** – every saved entry, grouped by day. Filter by name, department,
   date range, and by amount (more than / less than). Tap an entry to see its
   note breakdown. **Download for Excel** saves the filtered list as a spreadsheet file.

## Where the data is kept

Everything is stored in this repository, in [`data/entries.json`](data/entries.json).
Each save writes to that file straight away, and the app checks for new
entries every 30 seconds, so several phones can be used at the same time.
If the internet drops, entries stay on the phone and upload automatically
when it is back.

## Access key (entered once, on any one device)

Saving to GitHub needs an access key. It only has to be entered **once, on any
device**: the app then stores it (encoded) in `data/app-config.json`, and every
other phone or computer that opens the app picks it up and connects by itself.

To create a key:

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. **Repository access** → *Only select repositories* → `Accounts-denomination-app`.
3. **Permissions → Contents** → *Read and write*. Pick the longest expiration offered.
4. Generate, copy the key, open the app, tap the status button at the top right and paste it.

When the key expires, the status button shows **Key not working**. Enter a new key
on any one device and all the others switch to it automatically.

> Because the repository is public, the shared key can be read by anyone who
> looks at `data/app-config.json`. Keep the key limited to this one repository
> with only *Contents* permission, so the most it can do is change files in this
> project (everything stays recoverable through the git history).

## Hosting

The site is published to GitHub Pages by `.github/workflows/pages.yml` on every
push to `main` (changes to `data/` are skipped, since the app reads the data live).
