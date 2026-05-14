import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as mime from 'mime-types';
import * as path from 'path';

type UploadConfig = {
    accountName: string;
    accountKey: string;
    containerName: string;
    localSourceRoot: string;
    submissionFolder?: string;
    dryRun: boolean;
};

type LocalFile = {
    filePath: string;
    blobName: string;
};

function getArgValue(name: string): string | undefined {
    const prefix = `--${name}=`;
    const arg = process.argv.find((item) => item.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
}

function getConfig(): UploadConfig {
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });

    const accountName = process.env.JOTFORM_DOCS_STORAGE_ACCOUNT_NAME || process.env.STORAGE_ACCOUNT_NAME || '';
    const accountKey = process.env.JOTFORM_DOCS_STORAGE_ACCOUNT_KEY || process.env.STORAGE_ACCOUNT_KEY || '';
    const containerName = process.env.JOTFORM_DOCS_CONTAINER_NAME || 'jotform-submission-docs';
    const localSourceRoot = process.env.JOTFORM_DOCS_LOCAL_SOURCE_ROOT || 'prod';
    const submissionFolder = getArgValue('submission-folder') || getArgValue('folder');
    const dryRun = process.argv.includes('--dry-run') || process.env.JOTFORM_DOCS_DRY_RUN === 'true';

    if (!accountName) {
        throw new Error('Missing storage account. Set STORAGE_ACCOUNT_NAME or JOTFORM_DOCS_STORAGE_ACCOUNT_NAME.');
    }

    if (!accountKey && !dryRun) {
        throw new Error('Missing storage key. Set STORAGE_ACCOUNT_KEY or JOTFORM_DOCS_STORAGE_ACCOUNT_KEY.');
    }

    return {
        accountName,
        accountKey: accountKey || '',
        containerName,
        localSourceRoot,
        submissionFolder,
        dryRun,
    };
}

function getUploadSourceDirectory(localSourceRoot: string, submissionFolder?: string): string {
    if (!submissionFolder) {
        return localSourceRoot;
    }

    const resolvedRoot = path.resolve(localSourceRoot);
    const resolvedSubmissionFolder = path.resolve(localSourceRoot, submissionFolder);

    if (resolvedSubmissionFolder !== resolvedRoot && !resolvedSubmissionFolder.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`Submission folder must be inside source folder: ${localSourceRoot}`);
    }

    return resolvedSubmissionFolder;
}

async function getFiles(localSourceRoot: string, currentDirectory = localSourceRoot): Promise<LocalFile[]> {
    const entries = await fsp.readdir(currentDirectory, { withFileTypes: true });
    const files: LocalFile[] = [];

    for (const entry of entries) {
        if (entry.name === '.DS_Store') {
            continue;
        }

        const entryPath = path.join(currentDirectory, entry.name);

        if (entry.isDirectory()) {
            files.push(...await getFiles(localSourceRoot, entryPath));
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        files.push({
            filePath: entryPath,
            blobName: path.relative(localSourceRoot, entryPath).split(path.sep).join('/'),
        });
    }

    return files;
}

async function uploadJotformSubmissionDocs(): Promise<void> {
    const config = getConfig();
    const uploadSourceDirectory = getUploadSourceDirectory(config.localSourceRoot, config.submissionFolder);

    if (!fs.existsSync(config.localSourceRoot)) {
        throw new Error(`Source folder not found: ${config.localSourceRoot}`);
    }

    if (!fs.existsSync(uploadSourceDirectory)) {
        throw new Error(`Upload folder not found: ${uploadSourceDirectory}`);
    }

    const files = await getFiles(config.localSourceRoot, uploadSourceDirectory);

    if (files.length === 0) {
        console.log(`No files found in ${uploadSourceDirectory}`);
        return;
    }

    console.log(`Source: ${config.localSourceRoot}`);
    if (config.submissionFolder) {
        console.log(`Submission folder: ${config.submissionFolder}`);
    }
    console.log(`Target: ${config.accountName}/${config.containerName}`);
    console.log(`Files found: ${files.length}`);

    if (config.dryRun) {
        for (const file of files) {
            console.log(`[dry-run] ${file.filePath} -> ${config.containerName}/${file.blobName}`);
        }
        return;
    }

    const sharedKeyCredential = new StorageSharedKeyCredential(config.accountName, config.accountKey);
    const blobServiceClient = new BlobServiceClient(`https://${config.accountName}.blob.core.windows.net`, sharedKeyCredential);
    const containerClient = blobServiceClient.getContainerClient(config.containerName);

    await containerClient.createIfNotExists();

    let uploadedCount = 0;
    for (const file of files) {
        const contentType = mime.lookup(file.filePath) || 'application/octet-stream';
        const blockBlobClient = containerClient.getBlockBlobClient(file.blobName);

        await blockBlobClient.uploadFile(file.filePath, {
            blobHTTPHeaders: {
                blobContentType: contentType,
            },
        });

        uploadedCount += 1;
        console.log(`[uploaded ${uploadedCount}/${files.length}] ${config.containerName}/${file.blobName}`);
    }

    console.log(`Upload complete. Uploaded ${uploadedCount} file(s).`);
}

uploadJotformSubmissionDocs().catch((error) => {
    console.error('JotForm submission document upload failed:', error);
    process.exit(1);
});
