# FuelTrack: Google Sheets + Google Drive setup

This backend is intended for **personal use by one Google account**. Fuel
records live in your Google Sheet; vehicle photos are stored as private files
in a Drive folder. The browser keeps a local copy so the tracker remains
usable if sync is temporarily unavailable.

## 1. Prepare your Google Sheet

1. Create or open the Google Sheet you want FuelTrack to use.
2. Copy the spreadsheet ID from its URL:
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
3. Keep the Sheet private. Do not enable link sharing.

The setup script creates two tabs: **Vehicles** and **Fuel Entries**. It resets
those two tabs when run, so use a blank spreadsheet or back up those tab
contents before setup.

## 2. Create the Apps Script backend

1. Open [script.google.com](https://script.google.com/) and create a standalone
   Apps Script project.
2. Replace the contents of `Code.gs` with the repository file
   `apps-script/Code.gs`.
3. In the Apps Script editor, run `setupFuelTrack('YOUR_SPREADSHEET_ID')`
   once, replacing the value with your spreadsheet ID.
4. Approve the requested Google Sheets and Drive permissions. The function
   creates the tab headers and a private **FuelTrack Vehicle Photos** folder.

## 3. Deploy it privately

1. Select **Deploy → New deployment → Web app**.
2. Set **Execute as** to **User accessing the web app**.
3. Set **Who has access** to **Only myself**.
4. Deploy and copy the Web app URL ending in `/exec`.

Do not choose **Anyone** or **Anyone with a Google account**. Do not share the
spreadsheet or Drive folder publicly. The backend checks that Google identifies
the signed-in account; the deployment restriction is an additional security
boundary.

## 4. Connect the website

1. In the repository, open `apps-script-config.js`.
2. Set `window.FUELTRACK_APPS_SCRIPT_URL` to your deployed `/exec` URL.
3. Commit the config change and reload FuelTrack over HTTPS.
4. Open **Vehicles**. The status should change from local mode to connected.

The app uses JSONP for reads and a POST for writes because Apps Script web app
responses redirect. If the browser blocks third-party Google authentication
or the connection does not complete, use the Apps Script-hosted UI or a
Google OAuth-backed API integration instead; do not weaken the deployment to
public access to work around a browser error.

## Data and photos

- **Vehicles** stores vehicle identity, details and Drive photo file IDs.
- **Fuel Entries** stores date, fuel price, odometer, amount and full-tank flag.
- Photos are resized in the browser before upload, then stored in Drive.
- Drive files remain private to your Google account; image previews require
  that same account to be signed in.
- The app continues to save locally if cloud sync is unavailable. Confirm the
  sync status before clearing browser storage or changing devices.

## Important limitations

- This is a single-owner setup, not a shared family account or public service.
- Google Sheets is suitable for a personal tracker, but it is not a high-volume
  transactional database.
- Browser testing and a live Google deployment are still required. Apps Script
  authentication behavior can vary by browser privacy settings; validate read,
  write and photo upload before relying on cross-device sync.
