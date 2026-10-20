"""Conservative two-stage same-material and local trademark verification (OpenCV + Pillow)."""
import base64, hashlib, io, json, math
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageOps

VERSION='dual-images-2.0'
Image.MAX_IMAGE_PIXELS=16_000_000
cv2.setNumThreads(1)


def decoded(data):
    im=Image.open(io.BytesIO(data)); im.load()
    fmt=im.format or 'unknown'
    im=ImageOps.exif_transpose(im).convert('RGBA')
    if min(im.size)<8: raise ValueError('图片尺寸不足')
    # Canonical decoded RGB on white, with dimensions included in the digest.
    bg=Image.new('RGBA',im.size,'white');bg.alpha_composite(im);im=bg.convert('RGB')
    return im,fmt


def hashes(data):
    im,fmt=decoded(data)
    rgb=np.asarray(im)
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    small=cv2.resize(gray,(32,32),interpolation=cv2.INTER_AREA).astype(np.float32)
    dct=cv2.dct(small)[:8,:8].flatten(); bits=dct>np.median(dct[1:])
    phash=''.join(f'{sum(int(v)<<i for i,v in enumerate(bits[j:j+4])):x}' for j in range(0,64,4))
    pixel=hashlib.sha256(f'{im.width}x{im.height}:RGB-white:'.encode()+im.tobytes()).hexdigest()
    return {'sha256':hashlib.sha256(data).hexdigest(),'pixelSha256':pixel,'width':im.width,'height':im.height,'format':fmt,'phash':phash}


def thumbnail(data):
    im,_=decoded(data);im.thumbnail((240,240))
    out=io.BytesIO();im.save(out,'JPEG',quality=60,optimize=True)
    if out.tell()>12000:im.thumbnail((160,160));out=io.BytesIO();im.save(out,'JPEG',quality=50)
    return 'data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode()


def features(data):
    im,_=decoded(data);im.thumbnail((1000,1000))
    rgb=np.asarray(im); gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    # SIFT is Apache-2.0 in maintained OpenCV, no external model/API.
    kp,des=cv2.SIFT_create(nfeatures=1000,contrastThreshold=.025).detectAndCompute(gray,None)
    return {'rgb':rgb,'gray':gray,'points':np.float32([k.pt for k in kp]),'des':des,'hashes':hashes(data)}


def foreground(gray):
    corners=np.array([gray[:3,:3].mean(),gray[:3,-3:].mean(),gray[-3:,:3].mean(),gray[-3:,-3:].mean()])
    mask=np.abs(gray.astype(float)-np.median(corners))>max(16,float(np.std(gray))*.3)
    y,x=np.where(mask)
    return (int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)) if len(x)>12 else (0,0,gray.shape[1],gray.shape[0])


def ssim(a,b):
    a=a.astype(np.float32); b=b.astype(np.float32)
    ux=cv2.GaussianBlur(a,(7,7),1.2);uy=cv2.GaussianBlur(b,(7,7),1.2)
    vx=cv2.GaussianBlur(a*a,(7,7),1.2)-ux*ux;vy=cv2.GaussianBlur(b*b,(7,7),1.2)-uy*uy
    cov=cv2.GaussianBlur(a*b,(7,7),1.2)-ux*uy
    return float(np.mean(((2*ux*uy+6.5025)*(2*cov+58.5225))/((ux*ux+uy*uy+6.5025)*(vx+vy+58.5225))))


def whole_material(candidate,reference):
    a,b=candidate['rgb'],reference['rgb']
    if abs((a.shape[1]/a.shape[0])/(b.shape[1]/b.shape[0])-1)>.035:return None
    # A uniform background must not hide a different product: also compare the foreground crop.
    a=cv2.resize(a,(320,320),interpolation=cv2.INTER_AREA);b=cv2.resize(b,(320,320),interpolation=cv2.INTER_AREA)
    ga=cv2.cvtColor(a,cv2.COLOR_RGB2GRAY);gb=cv2.cvtColor(b,cv2.COLOR_RGB2GRAY)
    x0,y0,x1,y1=foreground(gb);x0=max(0,x0-3);y0=max(0,y0-3);x1=min(320,x1+3);y1=min(320,y1+3)
    if min(x1-x0,y1-y0)<25 or float(gb[y0:y1,x0:x1].std())<12:return None
    score=ssim(ga[y0:y1,x0:x1],gb[y0:y1,x0:x1]);mae=float(np.mean(np.abs(a[y0:y1,x0:x1].astype(float)-b[y0:y1,x0:x1])))
    ea=cv2.Laplacian(ga[y0:y1,x0:x1],cv2.CV_32F);eb=cv2.Laplacian(gb[y0:y1,x0:x1],cv2.CV_32F)
    edge=float(np.corrcoef(ea.flatten(),eb.flatten())[0,1]) if ea.std()>0 and eb.std()>0 else 0
    if score>=.955 and mae<=10 and edge>=.85:
        return {'method':'aligned-pixels-ssim','similarity':round(min(99.9,score*100),1),'exact':False,'metrics':{'ssim':round(score,4),'mae':round(mae,3),'edgeCorrelation':round(edge,4)}}
    return None


def local_features(candidate,reference,category):
    cd,rd=candidate['des'],reference['des']
    if cd is None or rd is None or min(len(cd),len(rd))<8:return None
    pairs=cv2.BFMatcher().knnMatch(rd,cd,k=2)
    good=[p[0] for p in pairs if len(p)==2 and p[0].distance<.68*p[1].distance]
    # One candidate keypoint cannot provide multiple independent matches.
    good=list({m.trainIdx:m for m in sorted(good,key=lambda m:-m.distance)}.values())
    minimum=12 if category=='product' else 8
    if len(good)<minimum:return None
    rp=np.float32([reference['points'][m.queryIdx] for m in good]);cp=np.float32([candidate['points'][m.trainIdx] for m in good])
    h,mask=cv2.findHomography(rp,cp,cv2.RANSAC,2.8)
    if h is None or mask is None:return None
    valid=mask.ravel().astype(bool);count=int(valid.sum());ratio=count/len(good)
    if count<minimum or ratio<.8:return None
    rh,rw=reference['gray'].shape;ch,cw=candidate['gray'].shape
    x0,y0,x1,y1=foreground(reference['gray']);area=max(1,(x1-x0)*(y1-y0))
    coverage=float(cv2.contourArea(cv2.convexHull(rp[valid])))/area
    if coverage < (.45 if category=='product' else .30):return None
    corners=np.float32([[[0,0],[rw,0],[rw,rh],[0,rh]]]);poly=cv2.perspectiveTransform(corners,h)[0]
    if not np.isfinite(poly).all() or not cv2.isContourConvex(poly.astype(np.float32)):return None
    if (poly[:,0]<-cw*.1).any() or (poly[:,0]>cw*1.1).any() or (poly[:,1]<-ch*.1).any() or (poly[:,1]>ch*1.1).any():return None
    size=float(abs(cv2.contourArea(poly)))
    if size<900 or size>cw*ch*1.2:return None
    warped=cv2.warpPerspective(candidate['gray'],np.linalg.inv(h),(rw,rh),borderValue=255)
    overlap=cv2.warpPerspective(np.ones((ch,cw),np.uint8),np.linalg.inv(h),(rw,rh))
    cropa=warped[y0:y1,x0:x1];cropb=reference['gray'][y0:y1,x0:x1]
    if float(overlap[y0:y1,x0:x1].mean())<.95:return None
    score=ssim(cropa,cropb)
    if score < (.91 if category=='product' else .82):return None
    # Broad spatial support is mandatory for product material, so a shared small logo is insufficient.
    cells={(min(2,int((p[0]-x0)*3/max(1,x1-x0))),min(2,int((p[1]-y0)*3/max(1,y1-y0)))) for p in rp[valid]}
    if category=='product' and len(cells)<5:return None
    return {'method':'sift-ransac-verified-region','similarity':round(min(99.9,score*100),1),'exact':False,
            'region':[[round(float(x/cw),5),round(float(y/ch),5)] for x,y in poly],
            'metrics':{'inliers':count,'inlierRatio':round(ratio,4),'referenceCoverage':round(min(1,coverage),4),'ssim':round(score,4),'spatialCells':len(cells)}}


def trademark_template(candidate,reference):
    # Independent high-resolution multi-scale edge + foreground verification. No 32px score is used.
    r=reference['gray'];x0,y0,x1,y1=foreground(r);r=r[y0:y1,x0:x1]
    if min(r.shape)<10 or max(r.shape)<35:return None
    mask=(np.abs(r.astype(float)-np.median([*r[0,:],*r[-1,:],*r[:,0],*r[:,-1]]))>25).astype(np.uint8)
    edges=cv2.Canny(r,60,160)
    contours,_=cv2.findContours(edges,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
    # Do not confirm generic circles, rectangles or a largely empty raster by template correlation.
    if np.count_nonzero(edges)<80 or sum(len(c) for c in contours)<45:return None
    c=candidate['gray'];ce=cv2.Canny(c,60,160);best=None
    maxscale=min(c.shape[0]/r.shape[0],c.shape[1]/r.shape[1],4)
    minscale=max(24/r.shape[1],12/r.shape[0],.20)
    cx0,cy0,cx1,cy1=foreground(c)
    extra=[1,(cx1-cx0)/r.shape[1],(cy1-cy0)/r.shape[0]]
    for scale in sorted(set([*np.geomspace(minscale,maxscale,max(2,int(math.log(maxscale/minscale+1)*30))),*extra])):
        w,h=int(round(r.shape[1]*scale)),int(round(r.shape[0]*scale))
        if w>c.shape[1] or h>c.shape[0] or min(w,h)<10:continue
        template=cv2.Canny(cv2.resize(r,(w,h)),60,160)
        if np.count_nonzero(template)<40:continue
        values=cv2.matchTemplate(ce,template,cv2.TM_CCOEFF_NORMED);_,score,_,(x,y)=cv2.minMaxLoc(values)
        if score<.90:continue
        patch=c[y:y+h,x:x+w];target=cv2.resize(r,(w,h));pm=(np.abs(patch.astype(float)-np.median([*patch[0,:],*patch[-1,:],*patch[:,0],*patch[:,-1]]))>25)
        rm=cv2.resize(mask,(w,h),interpolation=cv2.INTER_NEAREST)>0
        union=np.count_nonzero(pm|rm);iou=np.count_nonzero(pm&rm)/max(1,union)
        # Foreground overlap and independently verified edges must both pass.
        if score>=.965 and iou>=.91:
            result={'method':'multiscale-edge-mask','similarity':round(min(99.9,100*min(score,iou)),1),'exact':False,
                    'region':[[x/c.shape[1],y/c.shape[0]],[(x+w)/c.shape[1],y/c.shape[0]],[(x+w)/c.shape[1],(y+h)/c.shape[0]],[x/c.shape[1],(y+h)/c.shape[0]]],
                    'metrics':{'edgeNcc':round(score,4),'maskIou':round(iou,4)}}
            if not best or result['similarity']>best['similarity']:best=result
    return best


def compare(candidate,reference,category,allow_template=True):
    a,b=candidate['hashes'],reference['hashes']
    if a['sha256']==b['sha256']:
        return {'method':'sha256','similarity':100,'exact':True}
    if a['width']==b['width'] and a['height']==b['height'] and a['pixelSha256']==b['pixelSha256']:
        return {'method':'decoded-pixels','similarity':100,'exact':True}
    distance=(int(a['phash'],16)^int(b['phash'],16)).bit_count()
    if distance<=12:
        whole=whole_material(candidate,reference)
        if whole:return whole
    local=local_features(candidate,reference,category)
    if local:return local
    if category=='trademark' and allow_template:
        template=trademark_template(candidate,reference)
        if template:return template
    # Similarity alone remains a candidate and can never produce a confirmed badge.
    if distance<=8:
        return {'method':'phash-candidate-only','similarity':min(99.9,round((1-distance/64)*100,1)),'exact':False,'suspected':True,'metrics':{'phashDistance':distance}}
    return None


def candidate_rank(candidate,reference):
    """Cheap shortlist: all hashes + SIFT descriptors, no semantic/model-name guesses."""
    a,b=candidate['hashes'],reference['hashes']
    if a['sha256']==b['sha256'] or a['pixelSha256']==b['pixelSha256']:return 10000
    d=(int(a['phash'],16)^int(b['phash'],16)).bit_count()
    points=0
    if candidate['des'] is not None and reference['des'] is not None and len(candidate['des'])>=2:
        pairs=cv2.BFMatcher().knnMatch(reference['des'],candidate['des'],k=2)
        points=len({p[0].trainIdx for p in pairs if len(p)==2 and p[0].distance<.72*p[1].distance})
    return points*4+max(0,16-min(d,64-d))
