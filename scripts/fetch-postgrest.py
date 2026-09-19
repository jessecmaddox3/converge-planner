#!/usr/bin/env python3
"""Fetch the pinned official test-only PostgREST binary and verify its digest."""
import hashlib,json,platform,tarfile,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ASSETS={
 ('Linux','x86_64'):('postgrest-v16.3-linux-static-x86-64.tar.xz','4eb414eb948c8800863cc8c9896a17b611b2dccf9ff581f4d57f42ec9ccee40d'),
 ('Darwin','arm64'):('postgrest-v16.3-macos-aarch64.tar.xz','b4b6f45030c7ca94a653d775d74ed48037f7428b0a5a52eae6a90d654a2f0e41'),
}
def main():
 key=(platform.system(),platform.machine());assert key in ASSETS,'Install PostgREST 16.3 manually on this test platform.'
 name,digest=ASSETS[key];root=ROOT/'artifacts/postgrest';root.mkdir(parents=True,exist_ok=True)
 archive=root/name;url='https://github.com/PostgREST/postgrest/releases/download/v16.3/'+name
 urllib.request.urlretrieve(url,archive);assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest,'Official artifact checksum mismatch'
 with tarfile.open(archive) as source:
  entry=next(e for e in source.getmembers() if Path(e.name).name=='postgrest');assert entry.isfile();(root/'postgrest').write_bytes(source.extractfile(entry).read())
 (root/'postgrest').chmod(0o755);print(root/'postgrest')
if __name__=='__main__':main()
