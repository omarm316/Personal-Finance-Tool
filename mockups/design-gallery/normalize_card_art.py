import os,sys
import numpy as np
from PIL import Image,ImageDraw
SP=sys.argv[1]; OUT='mockups/design-gallery/card-art'; os.makedirs(OUT,exist_ok=True)
A='assets/card_logos_color/';S='static/cards/'
M={'chase_sapphire_preferred':A+'chase_sapphire_preferred.png','chase_sapphire_reserve':A+'chase_sapphire_reserve.png',
'chase_freedom_flex':A+'chase_freedom_flex.png','chase_freedom_unlimited':A+'chase_freedom_unlimited.png','chase_freedom':A+'chase_freedom_visa.png',
'capital_one_venture':A+'capitalone_venture.png','capital_one_venture_x':A+'capitalone_venturex.png',
'citi_double_cash':A+'citi_double_cash.png','citi_strata':A+'citi_strata.png','citi_strata_elite':A+'citi_strata_elite.png','citi_strata_premier':A+'citi_strata_premier.png',
'marriott_bonvoy_boundless':A+'ritz_carlton.png','amex_gold':A+'amex_gold.png','amex_platinum':A+'amex_platinum.png',
'amex_blue_business_plus':SP+'/avif/blue-business-plus.png','amex_business_gold':SP+'/avif/business-gold.png',
'citi_custom_cash':S+'citi_custom_cash.png','delta_gold':S+'delta_gold.png','hilton_aspire':S+'hilton_aspire.png','hyatt_personal':S+'hyatt_personal.png',
'united_explorer':S+'united_explorer.png','united_quest':S+'united_quest.png','us_bank_cash_plus':S+'us_bank_cash_plus.png'}
W,H,R=1000,630,44
mask=Image.new('L',(W*4,H*4),0);ImageDraw.Draw(mask).rounded_rectangle((0,0,W*4-1,H*4-1),R*4,fill=255);mask=mask.resize((W,H),Image.LANCZOS)
def bbox(im):
    a=np.array(im).astype(float);h,w,_=a.shape
    # a line is margin if mostly transparent, or a nearly uniform white strip
    def margin(l):
        al=l[:,3];vis=l[al>16]
        if (al>16).mean()<.5:return True
        return vis[:,:3].min(axis=1).mean()>238 and vis[:,:3].std()<7
    t=0
    while t<h//6 and margin(a[t]):t+=1
    b=h
    while b>h-h//6 and margin(a[b-1]):b-=1
    l=0
    while l<w//6 and margin(a[:,l]):l+=1
    r=w
    while r>w-w//6 and margin(a[:,r-1]):r-=1
    return l,t,r,b
for k,p in M.items():
    im=Image.open(p).convert('RGBA');sw,sh=im.size
    if k=='united_quest':im=im.rotate(-1.0,Image.BICUBIC,expand=False)
    l,t,r,b=bbox(im);c=im.crop((l,t,r,b));rat=c.width/c.height
    out=c.convert('RGBA').resize((W,H),Image.LANCZOS)
    # flatten any leftover transparency onto the nearest edge colours, then apply one corner
    bg=Image.new('RGBA',(W,H),tuple(int(x) for x in np.array(out)[np.array(out)[:,:,3]>200][:,:3].mean(axis=0))+(255,))
    bg.alpha_composite(out);bg.putalpha(mask);bg.save(f'{OUT}/{k}.png',optimize=True)
    print(f'{k:30}{sw}x{sh} card={c.width}x{c.height} r={rat:.3f} stretch={1.587/rat-1:+.1%}{"  LOWRES" if c.width<480 else ""}')
fs=list(M);cw,ch=420,280;cols=4;rows=(len(fs)+3)//4
Sh=Image.new('RGB',(cols*cw,rows*ch),(255,0,255));D=ImageDraw.Draw(Sh)
for i,k in enumerate(fs):
    o=Image.open(f'{OUT}/{k}.png');o.thumbnail((cw-16,ch-30));Sh.paste(o,((i%4)*cw+8,(i//4)*ch+22),o);D.text(((i%4)*cw+8,(i//4)*ch+6),k,fill='white')
Sh.save(SP+'/sheet3.png')
