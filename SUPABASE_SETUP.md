# FuelTrack: multi-vehicle and cloud database setup

The application now supports multiple vehicles, vehicle-specific fuel histories,
separate mileage calculations, vehicle photos, and a combined spending overview.

## Run locally first

Open the project using a local web server (for example, VS Code Live Server).
The upgraded version migrates the original `fueltrack_entries` browser data
into a starter vehicle named **My Vehicle**. It does not delete the original key.

Without Supabase credentials, the app continues to work in local-only mode.
Data and resized photos remain in that browser's local storage.

## Enable the cloud database

1. Create a project at https://supabase.com/.
2. In the Supabase dashboard, open **SQL Editor** and run all of
   `supabase/schema.sql`.
3. In **Project Settings → API**, copy the Project URL and the anon/public key.
   Never use the `service_role` key in browser code.
4. Open `supabase-config.js` and set:
   `window.FUELTRACK_SUPABASE_URL` and `window.FUELTRACK_SUPABASE_ANON_KEY`.
5. Deploy the updated site over HTTPS, then open **Vehicles** in FuelTrack.
6. Create an account with email/password or sign in. Existing local vehicles
   and fuel records are merged into the signed-in account and synced.
7. Confirm email if Supabase email confirmation is enabled for the project.

## Data model

- `vehicles`: one row per vehicle, including the vehicle owner and photo paths.
- `fuel_entries`: one row per fill-up, linked to a vehicle using `vehicle_id`.
- `vehicle-photos` Storage bucket: private image files, scoped to the signed-in
  user's UUID. The app compresses selected images before storing them.

Row Level Security policies restrict each account to its own vehicles, fuel
entries, and photo files. Do not disable RLS or put a service-role key in the
front-end.

## Notes

- The application keeps a local copy and syncs changes to Supabase after sign-in.
- Each vehicle's odometer sequence and full-tank mileage calculation is isolated.
- Deleting a vehicle also deletes its related fuel entries via the foreign key.
- Back up important existing browser data before clearing site storage or
  switching browsers/devices for the first time.
