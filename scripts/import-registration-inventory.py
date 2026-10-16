import openpyxl,json,re,hashlib,sys
from pathlib import Path
if len(sys.argv)!=2:raise SystemExit('Usage: python3 scripts/import-registration-inventory.py /path/to/inventory.xlsx (run from repository root)')
p=Path(sys.argv[1])
w=openpyxl.load_workbook(p,data_only=True)
c=json.load(open('brand-catalog.json'))
old={d.strip():e for e in c['entries'] for d in e['descriptions']}
old['Svea齿轮（图形）']=next(e for e in c['entries'] if e['canonicalName']=='SVEA 齿轮图形')
world=json.loads(Path('world-markets.js').read_text().split('export const worldMarkets=')[1].rstrip(';\n'))
byname={v['name']:k for k,v in world.items()}
byname.update({'阿联酋':'AE','中国':'CN','香港':'HK','台湾':'TW','印尼':'ID','俄罗斯联邦':'RU','北马其顿共和国':'MK','澳洲':'AU','波黑':'BA','波斯尼亚和黑塞哥维那':'BA','捷克共和国':'CZ','BY':'BY'})
byname.update({'欧盟':'EU','非洲知识产权组织':'OAPI','比荷卢':'BX','科索沃':'XK'})
regional={'EU':'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(),'BX':['BE','NL','LU'],'OAPI':'BJ BF CM CF TD KM CG CI GQ GA GN GW ML MR NE SN TG'.split()}
assets={a['sha256']:a for a in c['assets']};added=[];unknown=[];rows=[]
for e in c['entries']:e['registrationReferences']=[]
for s in list(w)[:3]:
 images={}
 for im in s._images:
  b=im._data();h=hashlib.sha256(b).hexdigest();asset=assets.get(h)
  if not asset:
   name='register-'+h[:16]+'.'+im.format
   Path('assets/excel/'+name).write_bytes(b)
   asset={'file':name,'filePath':'images/'+name,'path':'images/'+name,'sha256':h,'width':im.width,'height':im.height,'visibleReferences':[],'hiddenOnly':False,'review':'spreadsheet-source'}
   c['assets'].append(asset);assets[h]=asset;added.append(name)
  row=im.anchor._from.row+1
  images.setdefault(row,[]).append(asset['file'])
 for i,r in enumerate(s.values,1):
  country,_,desc=r[:3]
  if not desc or str(desc).strip()=='商标描述':continue
  desc=str(desc).strip();entry=old.get(desc)
  if not entry:unknown.append({'sheet':s.title,'row':i,'description':desc});continue
  raw=str(country or '').strip();normalized=re.sub(r'^马德里\s*[-—–]\s*','',raw).strip();code=byname.get(normalized)
  markets=regional.get(code,[code] if code else [])
  ref={'sheet':s.title,'row':i,'descriptionCell':'C'+str(i),'jurisdictionCell':'A'+str(i),'description':desc,'jurisdictionLabel':raw,'jurisdictionCode':code,'markets':markets,'route':'madrid' if s.title.startswith('马德里') else 'direct','status':'用户清单所列地域 · 注册状态未核验'}
  entry['registrationReferences'].append(ref);rows.append(ref)
  if desc not in entry['descriptions']:entry['descriptions'].append(desc)
  for name in images.get(i,[]):
   if name not in entry['assetFiles']:entry['assetFiles'].append(name)
# Keep stable entry IDs; family grouping is presentation metadata, not a change to saved selections.
families={'FJDynamics': ['FJDynamics','FJD 盾牌图形','FJDynamics + 豐疆知能 + 盾牌','FJ DYNAMICS + 丰疆智能 + 盾牌','FJD 旧盾牌图形','FJ DYNAMICS + 旧盾牌','FJD'], 'Sveaverken / SVEA':['Sveaverken','Sveaverken + SVEA 齿轮组合','Svea','SVEA 齿轮图形']}
c['families']=[];used=set()
for name,names in families.items():
 members=[e['id'] for e in c['entries'] if e['canonicalName'] in names];used.update(members)
 c['families'].append({'id':'family-'+hashlib.sha256(name.encode()).hexdigest()[:10],'name':name,'members':members,'basis':'清单描述中的同一文字、图形及组合样式归并；不推定权利人'})
for e in c['entries']:
 if e['id'] not in used:c['families'].append({'id':e['id'],'name':e['canonicalName'],'members':[e['id']],'basis':'原商标参照组'})
c['registrationInventory']={'sourceFile':p.name,'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'importedAt':'2026-10-16','records':len(rows),'jurisdictions':len(set(r['jurisdictionCode'] for r in rows if r['jurisdictionCode'])),'unmapped':[r for r in rows if not r['jurisdictionCode']],'unmatchedDescriptions':unknown,'limitations':'原表仅有国家/地区、图样、描述；未提供注册号、尼斯类别、申请人、有效期及法律状态。马德里指定地区不等于已获准保护。EU、BX、OAPI 按组织成员市场展开，仅供关联筛选。'}
Path('brand-catalog.json').write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'rows':len(rows),'families':len(c['families']),'unmatched':unknown,'unmapped':c['registrationInventory']['unmapped'],'newImages':len(added)},ensure_ascii=False))
