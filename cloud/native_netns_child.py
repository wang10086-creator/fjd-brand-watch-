"""Deny-only network namespace launcher, dropping privileges before Chromium."""
import fcntl,json,os,socket,stat,sys
from pathlib import Path

def launch(arguments):
    parent,uid,gid=map(int,arguments[:3]);attest,chrome=map(Path,arguments[3:5]);browser_args=arguments[5:]
    if os.geteuid()!=0 or uid<=0 or gid<=0 or not chrome.is_absolute():raise RuntimeError('invalid-isolation-launch')
    if Path(f'/proc/{parent}').stat().st_uid!=uid:raise RuntimeError('isolation-parent-mismatch')
    own=Path('/proc/self/ns/net').stat().st_ino;host=Path(f'/proc/{parent}/ns/net').stat().st_ino
    if own==host:raise RuntimeError('network-namespace-not-isolated')
    held=[]
    for number,flags in [(3,os.O_RDONLY),(4,os.O_WRONLY)]:
        p=f'/proc/{parent}/fd/{number}'
        if not (stat.S_ISFIFO(os.stat(p).st_mode) or stat.S_ISSOCK(os.stat(p).st_mode)):raise RuntimeError('invalid-debug-pipe')
        fd=os.open(p,flags);held.append(fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,10));os.close(fd)
    failures=[]
    for family,kind,target in [(socket.AF_INET,socket.SOCK_STREAM,('1.1.1.1',443)),(socket.AF_INET,socket.SOCK_DGRAM,('8.8.8.8',53))]:
        with socket.socket(family,kind) as s:
            s.settimeout(.25)
            try:s.connect(target)
            except OSError as error:failures.append(error.errno)
            else:raise RuntimeError('direct-network-unexpectedly-reachable')
    os.setgroups([]);os.setgid(gid);os.setuid(uid)
    if os.geteuid()!=uid or os.getegid()!=gid:raise RuntimeError('isolation-privilege-drop-failed')
    for source,destination in zip(held,[3,4]):os.dup2(source,destination,inheritable=True);os.set_inheritable(destination,True);os.close(source)
    attest.write_text(json.dumps({'pid':os.getpid(),'uid':os.geteuid(),'netns':own,'hostNetns':host,'directNetworkErrors':failures}))
    os.execv(str(chrome),[str(chrome),*browser_args])

if __name__=='__main__':launch(sys.argv[1:])
