/**
 * FuelTrack Google Sheets + Drive backend.
 *
 * Deploy as a web app:
 *   Execute as: User accessing the web app
 *   Who has access: Only myself
 *
 * The app intentionally rejects requests when Google does not identify the
 * signed-in account. Do not change the deployment to "Anyone".
 */
const VEHICLES_TAB = 'Vehicles';
const ENTRIES_TAB = 'Fuel Entries';
const DRIVE_FOLDER_NAME = 'FuelTrack Vehicle Photos';

function setupFuelTrack(spreadsheetId) {
  if (!spreadsheetId) throw new Error('Pass your Google Sheet ID: setupFuelTrack("...")');
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  PropertiesService.getScriptProperties().setProperty('FUELTRACK_SPREADSHEET_ID', spreadsheetId);

  const vehicleSheet = getOrCreateSheet_(spreadsheet, VEHICLES_TAB);
  vehicleSheet.clear();
  vehicleSheet.appendRow(['Vehicle ID', 'Name', 'Brand', 'Model', 'Registration', 'Type', 'Photos JSON', 'Updated At']);

  const entrySheet = getOrCreateSheet_(spreadsheet, ENTRIES_TAB);
  entrySheet.clear();
  entrySheet.appendRow(['Entry ID', 'Vehicle ID', 'Date', 'Fuel Price', 'Odometer', 'Amount Paid', 'Full Tank', 'Updated At']);

  const folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  PropertiesService.getScriptProperties().setProperty('FUELTRACK_DRIVE_FOLDER_ID', folder.getId());
  return 'FuelTrack is ready. Spreadsheet: ' + spreadsheet.getUrl() + ' | Photos folder: ' + folder.getUrl();
}

function doGet(e) {
  try {
    requireOwner_();
    const data = readSnapshot_();
    const payload = { ok: true, data: data };
    const callback = e && e.parameter && e.parameter.callback;
    if (callback) {
      if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) throw new Error('Invalid callback.');
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return json_(payload);
  } catch (error) {
    return json_({ ok: false, error: error.message || String(error) });
  }
}

function doPost(e) {
  try {
    requireOwner_();
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'save') throw new Error('Unsupported action.');
    saveSnapshot_(body);
    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, error: error.message || String(error) });
  }
}

function requireOwner_() {
  const email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('Google could not identify your account. Sign in with the Google account that owns this Sheet.');
  // The deployment itself must also be restricted to "Only myself".
  return email;
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('FUELTRACK_SPREADSHEET_ID');
  if (!id) throw new Error('Run setupFuelTrack(spreadsheetId) once from the Apps Script editor.');
  return SpreadsheetApp.openById(id);
}

function getPhotoFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('FUELTRACK_DRIVE_FOLDER_ID');
  if (!id) throw new Error('Run setupFuelTrack(spreadsheetId) once from the Apps Script editor.');
  return DriveApp.getFolderById(id);
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function readSnapshot_() {
  const ss = getSpreadsheet_();
  const vs = getOrCreateSheet_(ss, VEHICLES_TAB);
  const es = getOrCreateSheet_(ss, ENTRIES_TAB);
  const vRows = vs.getLastRow() > 1 ? vs.getRange(2, 1, vs.getLastRow() - 1, 8).getValues() : [];
  const eRows = es.getLastRow() > 1 ? es.getRange(2, 1, es.getLastRow() - 1, 8).getValues() : [];
  const vehicles = vRows.filter(r => r[0]).map(r => ({
    id: String(r[0]), name: String(r[1] || ''), brand: String(r[2] || ''),
    model: String(r[3] || ''), registrationNumber: String(r[4] || ''),
    type: String(r[5] || 'Other'), photos: parseJson_(r[6], [])
  }));
  const entries = eRows.filter(r => r[0]).map(r => ({
    id: String(r[0]), vehicleId: String(r[1]), date: dateString_(r[2]),
    price: Number(r[3]), odo: r[4] === '' || r[4] == null ? null : Number(r[4]),
    amount: Number(r[5]), fullTank: r[6] !== false
  }));
  return { vehicles: vehicles, entries: entries };
}

function saveSnapshot_(snapshot) {
  if (!Array.isArray(snapshot.vehicles) || !Array.isArray(snapshot.entries)) {
    throw new Error('Invalid FuelTrack data.');
  }
  const ss = getSpreadsheet_();
  const folder = getPhotoFolder_();
  const vehicles = snapshot.vehicles.map(vehicle => {
    const photos = (vehicle.photos || []).map(photo => {
      if (photo.dataUrl && !photo.fileId) {
        const match = String(photo.dataUrl).match(/^data:image\/(jpeg|jpg|png|webp);base64,([\s\S]+)$/i);
        if (!match) throw new Error('A vehicle photo has an unsupported format.');
        const bytes = Utilities.base64Decode(match[2]);
        const extension = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
        const blob = Utilities.newBlob(bytes, 'image/' + extension,
          safeName_(vehicle.name) + '-' + safeName_(photo.id || Utilities.getUuid()) + '.' + extension);
        const file = folder.createFile(blob);
        photo = { id: photo.id || file.getId(), fileId: file.getId(),
          url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200' };
      } else if (photo.fileId) {
        photo = { id: photo.id || photo.fileId, fileId: photo.fileId,
          url: 'https://drive.google.com/thumbnail?id=' + photo.fileId + '&sz=w1200' };
      }
      return photo;
    });
    return { ...vehicle, photos: photos };
  });

  const vehicleSheet = getOrCreateSheet_(ss, VEHICLES_TAB);
  vehicleSheet.clearContents();
  vehicleSheet.appendRow(['Vehicle ID', 'Name', 'Brand', 'Model', 'Registration', 'Type', 'Photos JSON', 'Updated At']);
  if (vehicles.length) vehicleSheet.getRange(2, 1, vehicles.length, 8).setValues(vehicles.map(v => [
    v.id, v.name || '', v.brand || '', v.model || '', v.registrationNumber || '',
    v.type || 'Other', JSON.stringify(v.photos || []), new Date()
  ]));

  const entries = snapshot.entries;
  const entrySheet = getOrCreateSheet_(ss, ENTRIES_TAB);
  entrySheet.clearContents();
  entrySheet.appendRow(['Entry ID', 'Vehicle ID', 'Date', 'Fuel Price', 'Odometer', 'Amount Paid', 'Full Tank', 'Updated At']);
  if (entries.length) entrySheet.getRange(2, 1, entries.length, 8).setValues(entries.map(entry => [
    entry.id, entry.vehicleId, entry.date, Number(entry.price),
    entry.odo == null ? '' : Number(entry.odo), Number(entry.amount),
    entry.fullTank !== false, new Date()
  ]));
}

function parseJson_(value, fallback) {
  try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}
function dateString_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(value || '').slice(0, 10);
}
function safeName_(value) {
  return String(value || 'vehicle').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
