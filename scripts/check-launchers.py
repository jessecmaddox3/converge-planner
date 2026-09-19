#!/usr/bin/env python3
"""Exercise the desktop launcher from an extracted release ZIP with spaces."""
import json,os,signal,socket,subprocess,tempfile,time,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 version=json.loads((ROOT/'package.json').read_text())['version']
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 origin=f'http://127.0.0.1:{port}'
 with tempfile.TemporaryDirectory(prefix='converge launcher ') as temporary:
  base=Path(temporary)
  with zipfile.ZipFile(ROOT/'artifacts'/f'converge-planner-{version}.zip') as source:source.extractall(base)
  project=base/f'converge-planner-{version}'
  env={key:value for key,value in os.environ.items() if not key.startswith(('CONVERGE_','SUPABASE_','DATABASE_','ANTHROPIC_','VERCEL','AWS_LAMBDA'))}
  env.update(PORT=str(port),CONVERGE_LAUNCH_NO_OPEN='1',NEXT_TELEMETRY_DISABLED='1')
  command=['cmd','/d','/c',str(project/'Start.cmd')] if os.name=='nt' else ['bash',str(project/'Start.command')]
  with (base/'launcher.log').open('w+',encoding='utf-8',errors='replace') as log:
   process=subprocess.Popen(command,cwd=project,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=os.name!='nt')
   try:
    deadline=time.monotonic()+480
    while True:
     if process.poll() is not None:raise RuntimeError('Launcher exited early: '+str(process.returncode))
     try:
      log.seek(0)
      if 'Open '+origin not in log.read():raise OSError('Launcher has not announced its own server.')
      with urllib.request.urlopen(origin+'/demo',timeout=3) as response:
       assert 'Converge' in response.read().decode()
      break
     except OSError:
      if time.monotonic()>deadline:raise RuntimeError('Launcher did not become ready within eight minutes.')
      time.sleep(.4)
    assert (project/'.local/demo/instance.json').is_file()
    assert (project/'node_modules/.converge-lock').is_file()
    assert (project/'.next/converge-source').is_file()
    print('PASS: fresh release ZIP, folder with spaces, actual desktop Start file, first dependency install/build, own loopback server.')
   except Exception:
    log.flush();log.seek(0);print(log.read(),flush=True);raise
   finally:
    if os.name=='nt':subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    else:
     try:os.killpg(process.pid,signal.SIGTERM)
     except ProcessLookupError:pass
    process.wait(timeout=30)
if __name__=='__main__':main()
