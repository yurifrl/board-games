/**
 * Last-good backup of the store files (catalog.json, users.json) to GCS, so a
 * lost/wiped volume can recover even while Obsidian is down. Objects live under
 * `_backup/<file>` in the assets bucket — `_backup/` cannot collide with asset
 * keys (`<uuid>/…`). Uploads are sha256-gated: the sync runs frequently and the
 * catalog rarely changes, so identical content is never re-uploaded. Restores
 * only ever fill a missing/empty local file — a present local copy always wins.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Storage } from "@google-cloud/storage";

/** The @google-cloud/storage File subset we need — injectable in tests. */
export interface BackupBucket {
  file(name: string): {
    exists(): Promise<[boolean]>;
    download(): Promise<[Buffer]>;
    getMetadata(): Promise<[{ metadata?: Record<string, string> }, ...unknown[]]>;
    save(
      data: Buffer | Uint8Array,
      opts?: {
        contentType?: string;
        resumable?: boolean;
        metadata?: { metadata?: Record<string, string> };
      },
    ): Promise<void>;
  };
}

/** The assets bucket by default; BACKUP_GCS_BUCKET overrides. Null = backups disabled. */
export function openBackupBucket(bucketName?: string): BackupBucket | null {
  const name = bucketName ?? process.env.BACKUP_GCS_BUCKET ?? process.env.ASSETS_GCS_BUCKET;
  if (!name) return null;
  return new Storage().bucket(name) as unknown as BackupBucket;
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
const objectName = (file: string): string => `_backup/${file}`;

/** Upload each store file whose content changed. Missing local files are skipped. */
export async function backupStoreFiles(
  bucket: BackupBucket | null,
  dataDir: string,
  files: string[],
): Promise<void> {
  if (!bucket) return;
  for (const file of files) {
    let data: Buffer;
    try {
      data = await readFile(`${dataDir}/${file}`);
    } catch {
      continue; // nothing local to back up yet
    }
    const sum = sha256(data);
    const obj = bucket.file(objectName(file));
    const [exists] = await obj.exists();
    if (exists) {
      const [md] = await obj.getMetadata();
      if (md.metadata?.sha256 === sum) continue; // unchanged
    }
    // resumable:false — simple multipart upload; faster and avoids the
    // resumable-session handshake entirely for files of this size.
    await obj.save(data, { resumable: false, contentType: "application/json", metadata: { metadata: { sha256: sum } } });
    console.log(`  backup: ${file} uploaded (${(data.byteLength / 1024).toFixed(0)}KB)`);
  }
}

/** Download each store file that is missing or empty locally. Present files win.
 * Returns how many files were restored. */
export async function restoreMissingFiles(
  bucket: BackupBucket | null,
  dataDir: string,
  files: string[],
): Promise<number> {
  if (!bucket) return 0;
  let restored = 0;
  for (const file of files) {
    const local = `${dataDir}/${file}`;
    const s = await stat(local).catch(() => null);
    if (s && s.size > 0) continue; // local copy wins
    const obj = bucket.file(objectName(file));
    const [exists] = await obj.exists();
    if (!exists) continue;
    const [buf] = await obj.download();
    // Atomic write (tmp + rename) so a reader never sees a half-written file.
    await mkdir(dirname(local), { recursive: true });
    const tmp = `${local}.restore-tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, local);
    restored++;
    console.log(`  restore: ${file} <- ${objectName(file)}`);
  }
  return restored;
}
