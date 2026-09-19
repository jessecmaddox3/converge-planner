#!/usr/bin/env python3
"""Build a deterministic source ZIP from the exact reviewed file allowlist."""
import hashlib,json,stat,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 version=json.loads((ROOT/'package.json').read_text())['version']
 files=json.loads((ROOT/'release-files.json').read_text())
 assert len(files)==len(set(files)) and files==sorted(files),'Release allowlist must be sorted and unique.'
 output=ROOT/'artifacts';output.mkdir(exist_ok=True)
 archive=output/f'converge-planner-{version}.zip';manifest=[]
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as bundle:
  for name in files:
   relative=Path(name);assert not relative.is_absolute() and '..' not in relative.parts
   assert not any(part in {'.git','node_modules','.next','.local','private','.vercel','artifacts','__pycache__'} for part in relative.parts)
   assert not relative.name.startswith('.env') or name=='.env.example'
   source=ROOT/relative;assert source.is_file() and not source.is_symlink(),name
   content=source.read_bytes();info=zipfile.ZipInfo(f'converge-planner-{version}/'+name,(2026,1,1,0,0,0));info.create_system=3
   info.external_attr=(stat.S_IFREG|(0o755 if name in {'Start.command','start.sh'} else 0o644))<<16
   info.compress_type=zipfile.ZIP_DEFLATED;bundle.writestr(info,content)
   manifest.append({'path':name,'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)})
 digest=hashlib.sha256(archive.read_bytes()).hexdigest()
 (output/'SHA256SUMS').write_text(digest+'  '+archive.name+'\n')
 (output/f'converge-planner-{version}-files.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps({'archive':archive.name,'files':len(files),'sha256':digest}))
if __name__=='__main__':main()
