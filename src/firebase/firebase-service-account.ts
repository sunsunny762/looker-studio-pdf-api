import * as fs from 'fs';
import * as path from 'path';

export function loadFirebaseServiceAccount(): Record<string, unknown> {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    return JSON.parse(serviceAccountJson);
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve(__dirname, '../../firebase/default.json');

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      'Missing Firebase service account. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_PATH, GOOGLE_APPLICATION_CREDENTIALS, or provide firebase/default.json locally.',
    );
  }

  return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
}
