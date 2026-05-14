import * as dotenv from 'dotenv';
import * as path from 'path';
import { SubmissionService } from '../api/submission/submission.service';
import { DatabaseService } from '../database/database.service';

const formIds = [
  '233020948970862',
  '240292243754859',
  '242344031547854',
  '242344031547854',
  '231070471355449',
  '253222378109859',
  '242592209273862',
  '231071474828458',
  '231431006427949',
  '240925275802861',
  '250484440276861',
  '242453848253865',
  '241922119075858',
  '241922513705856',
  '242534072021847',
  '240223117048041'
];
const pageLimit = 5000;

interface JotformSubmissionListItem {
    id?: string;
}

interface JotformSubmissionListResponse {
    responseCode?: number;
    message?: string;
    content?: JotformSubmissionListItem[];
}

function buildSubmissionsUrl(baseUrl: string, formIdValue: string, limit: number, offset: number, apiKey: string): string {
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = new URL(`form/${formIdValue}/submissions`, normalizedBaseUrl);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    return url.toString();
}

async function getSubmissionIdsByFormId(formIdValue: string): Promise<string[]> {
    const apiUrl = process.env.JOTFORM_API_URL;
    const apiKey = process.env.JOTFORM_APIKEY;

    if (!apiUrl || !apiKey) {
        throw new Error('JOTFORM_API_URL or JOTFORM_APIKEY is missing from .env');
    }

    const submissionIds: string[] = [];
    let offset = 0;

    while (true) {
        const url = buildSubmissionsUrl(apiUrl, formIdValue, pageLimit, offset, apiKey);
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error(`Failed to fetch submissions for form ${formIdValue}. Status: ${res.status} ${res.statusText}`);
        }

        const json = (await res.json()) as JotformSubmissionListResponse;
        const submissions = Array.isArray(json.content) ? json.content : [];

        submissionIds.push(
            ...submissions
                .map((submission) => String(submission.id ?? '').trim())
                .filter((submissionId) => Boolean(submissionId))
        );

        if (submissions.length < pageLimit) {
            break;
        }

        offset += pageLimit;
    }

    return submissionIds;
}

// To run: npm run sync:jotform-view-details:form
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
        for (const formId of formIds) {
            console.log(`Starting JotForm view details sync for form ${formId}...`);
            const submissionIds = await getSubmissionIdsByFormId(formId);
            console.log(`Fetched ${submissionIds.length} submission IDs for form ${formId}.`);

            const result = await submissionService.syncJotformViewDetailsForSubmissionIds(
                submissionIds.map((submissionId) => ({
                    submissionId,
                    jotformId: formId,
                }))
            );
            console.log(
                `JotForm view details sync complete for form ${formId}. Total: ${result.total}, Success: ${result.success}, Failed: ${result.failed}`
            );
        }
    } catch (error) {
        console.error('JotForm view details sync failed:', error);
        process.exit(1);
    }
}

main();
