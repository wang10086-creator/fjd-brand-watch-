"""Deny-only network namespace launcher, dropping privileges before Chromium."""
import array,fcntl,json,os,socket,stat,struct,sys
from pathlib import Path

def launch(arguments):
    parent,uid,gid=map(int,arguments[:3]);attest,chrome,channel=map(Path,arguments[3:6]);browser_args=arguments[6:]
    if os.geteuid()!=0 or uid<=0 or gid<=0 or not chrome.is_absolute():raise RuntimeError('invalid-isolation-launch')
    if Path(f'/proc/{parent}').stat().st_uid!=uid:raise RuntimeError('isolation-parent-mismatch')
    own=Path('/proc/self/ns/net').stat().st_ino;host=Path(f'/proc/{parent}/ns/net').stat().st_ino
    if own==host:raise RuntimeError('network-namespace-not-isolated')
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as control:
        control.connect(str(channel))
        peer,peer_uid,_=struct.unpack('3i',control.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
        if peer!=parent or peer_uid!=uid:raise RuntimeError('isolation-control-peer-mismatch')
        _,ancillary,_,_=control.recvmsg(32,socket.CMSG_SPACE(2*array.array('i').itemsize))
        received=[]
        for level,kind,value in ancillary:
            if level==socket.SOL_SOCKET and kind==socket.SCM_RIGHTS:
                a=array.array('i');a.frombytes(value[:len(value)-len(value)%a.itemsize]);received.extend(a)
        if len(received)!=2:raise RuntimeError('invalid-debug-pipe-count')
        held=[]
        for fd in received:
            mode=os.fstat(fd).st_mode
            if not(stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):raise RuntimeError('invalid-debug-pipe')
            held.append(fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,10));os.close(fd)
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
