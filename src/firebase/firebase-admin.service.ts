import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { loadFirebaseServiceAccount } from './firebase-service-account';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  onModuleInit() {
    // Initialize Firebase Admin SDK if not already initialized
    if (!admin.apps.length) {
      try {
        admin.initializeApp({
          credential: admin.credential.cert(loadFirebaseServiceAccount() as admin.ServiceAccount),
        });
        console.log('Firebase Admin initialized successfully');
      } catch (error) {
        console.error('Firebase Admin initialization error:', error);
      }
    }
  }

  getAuth() {
    return admin.auth();
  }
}
