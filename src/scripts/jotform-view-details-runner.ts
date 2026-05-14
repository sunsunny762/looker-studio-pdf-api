import * as dotenv from 'dotenv';
import * as path from 'path';
import { SubmissionService } from '../api/submission/submission.service';
import { DatabaseService } from '../database/database.service';

// To run: npm run sync:jotform-view-details
async function main() {
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });

    const databaseService = new DatabaseService();
    await databaseService.initialise();

    if (!databaseService.isConnected) {
        console.error('Database connection failed.');
        process.exit(1);
    }

    const submissionService = new SubmissionService(databaseService, null as any);

    try {
        console.log('Starting JotForm view details sync...');
        const result = await submissionService.syncAllJotformViewDetails();
        console.log(`JotForm view details sync complete. Total: ${result.total}, Success: ${result.success}, Failed: ${result.failed}`);
    } catch (error) {
        console.error('JotForm view details sync failed:', error);
        process.exit(1);
    }
}

main();
