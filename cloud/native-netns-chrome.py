#!/usr/bin/env python3
"""Preserve driver pipes across sudo without granting Chromium privileges."""
import array,os,socket,struct,subprocess,sys
from pathlib import Path

if __name__=='__main__':
    chrome=os.environ['FJD_NETNS_CHROME'];attest=os.environ['FJD_NETNS_ATTESTATION']
    if os.getuid()==0:raise RuntimeError('browser-driver-must-be-unprivileged')
    keep='DISPLAY,XAUTHORITY,LANG,LC_ALL,PATH,HTTPS_PROXY,HTTP_PROXY,NO_PROXY,SSL_CERT_FILE,SSL_CERT_DIR,NODE_EXTRA_CA_CERTS'
    channel=attest+'.sock'
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as server:
        server.bind(channel);server.listen(1);server.settimeout(20)
        command=['sudo','-n','--preserve-env='+keep,'unshare','--net','--',sys.executable,str(Path(__file__).with_name('native_netns_child.py')),str(os.getpid()),str(os.getuid()),str(os.getgid()),attest,chrome,channel,*sys.argv[1:]]
        child=subprocess.Popen(command)
        with server.accept()[0] as connection:
            _,peer_uid,_=struct.unpack('3i',connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
            if peer_uid!=0:raise RuntimeError('invalid-isolation-launcher')
            connection.sendmsg([b'pipes'],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',[3,4]))])
        os.unlink(channel)
        raise SystemExit(child.wait())
