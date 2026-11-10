# FuelTrack

A responsive fuel and running-cost tracker with support for multiple vehicles.

## Features

- Manage multiple cars, bikes, scooters and other vehicles.
- Store a gallery of photos for each vehicle in your private Google Drive.
- Track fuel price, amount, odometer and full/partial fill-ups.
- Keep logs and mileage insights separate for each vehicle.
- View combined fuel expenditure across all vehicles.
- Local-first browser cache with optional Google Sheets sync.

## Run locally

Serve the project using any static web server (for example, VS Code Live Server).
Without a configured Apps Script URL, the app works in local-only mode.

## Google Sheets + Drive backend

This version is designed for one person using their own Google account. Follow
[GOOGLE_SHEETS_SETUP.md](GOOGLE_SHEETS_SETUP.md) to connect a private Google
Sheet and Drive folder through the included Apps Script backend.

**Security:** deploy the Apps Script web app with access set to **Only myself**
and execution set to **User accessing the web app**. Do not make the Sheet or
photo folder public. Do not deploy the endpoint as "Anyone".
