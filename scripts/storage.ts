import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {runtimeConfig} from '../src/lib/runtime/config';
import {openLocalStore} from '../src/lib/storage/local';
import {backupLocal,restoreLocal} from '../src/lib/storage/backup';

async function main(){
  const [command,file,destination]=process.argv.slice(2);
  if(!['backup','restore','migrate'].includes(command||''))throw new Error('Usage: npm run storage -- backup FILE | restore FILE NEW_FOLDER | migrate. Stop the app first.');
  if(process.env.CONVERGE_MODE==='production')throw new Error('Use native PostgreSQL/provider backups for production. This command only handles local demo data.');
  process.env.CONVERGE_MODE='demo';
  if(command==='restore') {
    if(!file||!destination)throw new Error('Restore needs a backup file and a new empty folder.');
    await restoreLocal(file,destination);
    console.log('Restored into the new folder. Browser sessions are new; actor ownership and private response return links are preserved. Set CONVERGE_DATA_DIR to this folder to use it.');
  } else if(command==='backup') {
    if(!file)throw new Error('Choose a new backup file path.');
    await backupLocal(runtimeConfig().dataDirectory,file);
    console.log('Backup written without replacing an existing file. Keep it private: it contains saved plans, contact details and return-link authority.');
  } else {
    const directory=runtimeConfig().dataDirectory;
    const marker=await lstat(path.join(directory,'instance.json')).catch(()=>null);
    if(!marker?.isFile()||marker.isSymbolicLink())throw new Error('Choose an existing local demo to migrate.');
    const local=await openLocalStore(directory,{migrate:true});
    await local.close();
    console.log('Local database migrations completed.');
  }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Storage command failed');process.exitCode=1;});
