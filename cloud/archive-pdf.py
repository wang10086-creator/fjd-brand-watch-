"""Retired PDF interface. Historical files/metadata remain readable; no new PDFs."""
import json,sys
def render(*args,**kwargs):
    return None
if __name__=='__main__':
    json.load(sys.stdin)
    print('[]')
