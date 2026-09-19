#!/usr/bin/env python3
"""Refresh the lockfile inventory and preserve installed dependency notices."""
import json,re,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 lock=json.loads((ROOT/'package-lock.json').read_text());inventory=[]
 target=ROOT/'licenses/npm';target.mkdir(parents=True,exist_ok=True)
 for name,meta in sorted(lock['packages'].items()):
  if not name:continue
  package=name.rsplit('node_modules/',1)[-1]
  row={'package':package,'version':meta.get('version'),'license':meta.get('license','see upstream package'),'resolved':meta.get('resolved'),'integrity':meta.get('integrity'),'development':bool(meta.get('dev')),'optional':bool(meta.get('optional')),'notices':[]}
  folder=ROOT/name
  if folder.is_dir():
   for source in sorted(folder.iterdir()):
    if source.is_file() and not source.is_symlink() and re.match(r'^(licen[cs]e|copying|notice)([._-]|$)',source.name,re.I):
     relative=Path('licenses/npm')/(re.sub(r'[^a-zA-Z0-9._-]','_',package)+'-'+str(meta.get('version'))+'-'+source.name)
     destination=ROOT/relative;destination.write_bytes(source.read_bytes());row['notices'].append(str(relative))
  inventory.append(row)
 (ROOT/'licenses/npm-dependencies.json').write_text(json.dumps(inventory,indent=2)+'\n')
 print(f'{len(inventory)} locked dependencies inventoried; installed package notices preserved.')
if __name__=='__main__':main()
