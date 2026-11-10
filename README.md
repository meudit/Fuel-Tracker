# FuelTrack

A responsive fuel and running-cost tracker with support for multiple vehicles.

## Features

- Manage multiple cars, bikes, scooters and other vehicles.
- Store a gallery of photos for each vehicle.
- Track fuel price, amount, odometer and full/partial fill-ups.
- Keep logs and mileage insights separate for each vehicle.
- View combined fuel expenditure across all vehicles.
- Local-first storage, with optional Supabase authentication, database sync and private photo storage.

## Run

Serve the project using any static web server (for example, VS Code Live Server).
The app can be used without a backend; records and resized photos are saved in
that browser's local storage.

## Cloud database

To enable cloud persistence and sync across devices:

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Add the Supabase Project URL and anon/public key to `supabase-config.js`.
4. Open **Vehicles** in FuelTrack and create an account or sign in.

See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for the complete setup and security notes.
Never put a Supabase service-role key in front-end code.
