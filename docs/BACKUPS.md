# Keep your plans when moving or upgrading

> **Before changing a saved installation:** stop it, make a private backup, keep the old app folder and verify the new copy. A local backup includes trip data and identity secrets. A hosted installation uses native database backups plus a separate private copy of its configuration.

## Local demo backup

Close the app with Control+C. In a terminal opened inside its folder, run:

```sh
npm run storage -- backup ../converge-backup.json
```

The command reads `.local/demo`, or the folder chosen in `CONVERGE_DATA_DIR`. It refuses to create a missing instance or replace an existing backup. Choose a new filename each time. It can preserve an older recognized local database before migration and does not migrate it while backing it up. A checksum binds the database archive and its identity information.

The single JSON file is **private and unencrypted**. It contains saved plans, contact details, response-link authority and identity secrets. Keep it out of GitHub and public file shares. The supported local backup/restore limit is 512MB; a larger backup is refused before writing the output. Back up with the matching app release whenever possible and keep that release available for recovery.

## Restore into a new folder

Use the release that matches the backup's migration set. Choose a new empty folder; restore never overwrites an existing installation.

```sh
npm run storage -- restore ../converge-backup.json ../converge-restored-data
```

The restore holds the database lock, checks the archive and migration ledger, and only marks the destination ready after the database closes. Restored sessions are new, but account ownership and private return links keep working. A failed restore stays visibly incomplete and will not be silently reset or reseeded.

Set `CONVERGE_DATA_DIR` to the restored folder before starting. For example, on Mac/Linux:

```sh
CONVERGE_DATA_DIR=../converge-restored-data npm run demo
```

On Windows PowerShell:

```powershell
$env:CONVERGE_DATA_DIR = '..\converge-restored-data'
npm run demo
```

Choose Quinn in the demo bar and verify your saved trip, then check a private response return link. Keep the original folder and backup until you are satisfied.

## Upgrade a local installation

1. Stop the old app, make the backup and retain its folder.
2. Extract the new release into a different folder and install/build it.
3. Copy the **entire** old `.local/demo` folder to the new release's `.local/demo`, including `instance.json` and `database`. Do not copy only the database subfolder or combine two instances.
4. From the new app folder, run `npm run storage -- migrate`. The owner command applies new migrations; ordinary startup refuses a version mismatch.
5. Start and verify your plans. On failure, keep the failed new folder for diagnosis and reopen the preserved old installation. Do not run an old binary against a migrated database.

For a completely fresh fictional sandbox, point `CONVERGE_DATA_DIR` to a new empty folder. There is no destructive reset button.

## Hosted upgrades

Back up PostgreSQL using your provider's supported process and preserve `ACTOR_KEY_SECRET` separately. Stop application writers, deploy the new code, and run `npm run setup -- migrate` with the owner connection string. Run `npm run setup -- status`, then start the server and verify sign-in, ownership, a test plan and maintenance. Database restore and application rollback must use matching versions. The local storage command deliberately refuses production mode.
