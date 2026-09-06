import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupStoreFiles, restoreMissingFiles, type BackupBucket } from "./backup.ts";

const sha = (data: string): string => createHash("sha256").update(data).digest("hex");

function fakeBucket() {
  // Runtime-keyed object store (names arrive as `_backup/<file>` at call time).
  const objects = new Map<string, { data: Buffer; sha?: string; saves: number }>();
  const bucket: BackupBucket = {
    file(name) {
      const meta = objects.get(name);
      const md: { metadata?: Record<string, string> } = meta?.sha ? { metadata: { sha256: meta.sha } } : {};
      return {
        exists: async () => [objects.has(name)],
        download: async () => [objects.get(name)!.data],
        getMetadata: async () => [md],
        save: async (data, opts) => {
          const rec = objects.get(name) ?? { saves: 0, data: Buffer.alloc(0) };
          rec.data = Buffer.from(data);
          rec.sha = opts?.metadata?.metadata?.sha256;
          rec.saves += 1;
          objects.set(name, rec);
        },
      };
    },
  };
  return {
    bucket,
    saves: (name: string) => objects.get(name)?.saves ?? 0,
    storedSha: (name: string) => objects.get(name)?.sha,
  };
}

const dataDir = async () => {
  const dir = join(tmpdir(), "backup-test-", String(Math.random()).slice(2));
  await mkdir(dir, { recursive: true });
  return dir;
};

test("backup uploads local file with sha256 metadata, under _backup/", async () => {
  const { bucket, saves, storedSha } = fakeBucket();
  const dir = await dataDir();
  await writeFile(join(dir, "catalog.json"), "[]");

  await backupStoreFiles(bucket, dir, ["catalog.json"]);

  expect(saves("_backup/catalog.json")).toBe(1);
  expect(storedSha("_backup/catalog.json")).toBe(sha("[]"));
});

test("identical content is not re-uploaded; changed content is", async () => {
  const { bucket, saves } = fakeBucket();
  const dir = await dataDir();
  const path = join(dir, "catalog.json");
  await writeFile(path, "v1");
  await backupStoreFiles(bucket, dir, ["catalog.json"]);
  await backupStoreFiles(bucket, dir, ["catalog.json"]);
  expect(saves("_backup/catalog.json")).toBe(1); // unchanged → skipped

  await writeFile(path, "v2");
  await backupStoreFiles(bucket, dir, ["catalog.json"]);
  expect(saves("_backup/catalog.json")).toBe(2);
});

test("backup skips files that do not exist locally", async () => {
  const { bucket, saves } = fakeBucket();
  await backupStoreFiles(bucket, await dataDir(), ["catalog.json"]);
  expect(saves("_backup/catalog.json")).toBe(0);
});

test("restore writes a missing local file from the backup", async () => {
  const { bucket } = fakeBucket();
  const dir = await dataDir();
  await writeFile(join(dir, "catalog.json"), "good");
  await backupStoreFiles(bucket, dir, ["catalog.json"]);

  const fresh = await dataDir();
  const restored = await restoreMissingFiles(bucket, fresh, ["catalog.json"]);
  expect(restored).toBe(1);
  expect(await readFile(join(fresh, "catalog.json"), "utf8")).toBe("good");
});

test("restore never overwrites a present local file", async () => {
  const { bucket } = fakeBucket();
  const dir = await dataDir();
  await writeFile(join(dir, "users.json"), "remote");
  await backupStoreFiles(bucket, dir, ["users.json"]);

  const local = await dataDir();
  await writeFile(join(local, "users.json"), "local");
  const restored = await restoreMissingFiles(bucket, local, ["users.json"]);
  expect(restored).toBe(0);
  expect(await readFile(join(local, "users.json"), "utf8")).toBe("local");
});

test("restore replaces an empty (0-byte) local file", async () => {
  const { bucket } = fakeBucket();
  const dir = await dataDir();
  await writeFile(join(dir, "catalog.json"), "good");
  await backupStoreFiles(bucket, dir, ["catalog.json"]);

  const local = await dataDir();
  await writeFile(join(local, "catalog.json"), "");
  const restored = await restoreMissingFiles(bucket, local, ["catalog.json"]);
  expect(restored).toBe(1);
  expect(await readFile(join(local, "catalog.json"), "utf8")).toBe("good");
});

test("restore does nothing when no backup exists for the file", async () => {
  const { bucket } = fakeBucket();
  const restored = await restoreMissingFiles(bucket, await dataDir(), ["catalog.json"]);
  expect(restored).toBe(0);
});

test("null bucket: both ops are no-ops", async () => {
  const dir = await dataDir();
  await backupStoreFiles(null, dir, ["catalog.json"]);
  const restored = await restoreMissingFiles(null, dir, ["catalog.json"]);
  expect(restored).toBe(0);
});
