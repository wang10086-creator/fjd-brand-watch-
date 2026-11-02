#!/usr/bin/env python3
"""Preserve driver pipes across sudo without granting Chromium privileges."""
import os,subprocess,sys
from pathlib import Path

if __name__=='__main__':
    chrome=os.environ['FJD_NETNS_CHROME'];attest=os.environ['FJD_NETNS_ATTESTATION']
    if os.getuid()==0:raise RuntimeError('browser-driver-must-be-unprivileged')
    keep='DISPLAY,XAUTHORITY,LANG,LC_ALL,PATH,HTTPS_PROXY,HTTP_PROXY,NO_PROXY,SSL_CERT_FILE,SSL_CERT_DIR,NODE_EXTRA_CA_CERTS'
    command=['sudo','-n','--preserve-env='+keep,'unshare','--net','--',sys.executable,str(Path(__file__).with_name('native_netns_child.py')),str(os.getpid()),str(os.getuid()),str(os.getgid()),attest,chrome,*sys.argv[1:]]
    raise SystemExit(subprocess.call(command))
