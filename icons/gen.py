# 체인 링크 아이콘 생성. 모든 좌표는 512 캔버스, 중심 (256,256) 기준으로 계산한다.
import sys, os
out = sys.argv[1]
BG, FG = '#1f6feb', '#ffffff'

def rings(S, outer_h, outer_w, overlap, interlock, gap):
    """스타디움 링 2개. 반환: svg 조각, 글리프 외곽 bbox"""
    h = outer_h - S; rx = h / 2; w = outer_w - S
    total = outer_w * 2 - overlap
    x0 = 256 - total / 2                      # 왼쪽 링 외곽 시작
    lx = x0 + S / 2; rxx = x0 + outer_w - overlap + S / 2
    y = 256 - h / 2
    def ring(x): return f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{rx:g}" fill="none" stroke="{{c}}" stroke-width="{{s}}"/>'
    L, R = ring(lx), ring(rxx)
    parts = [L.format(c=FG, s=S), R.format(c=FG, s=S)]
    if interlock:
        K = S + 2 * gap
        parts += [
            '<clipPath id="top"><rect x="0" y="0" width="512" height="256"/></clipPath>',
            '<clipPath id="bot"><rect x="0" y="256" width="512" height="256"/></clipPath>',
            f'<g clip-path="url(#top)">{L.format(c=BG, s=K)}{L.format(c=FG, s=S)}</g>',
            f'<g clip-path="url(#bot)">{R.format(c=BG, s=K)}{R.format(c=FG, s=S)}</g>',
        ]
    bbox = (x0, 256 - outer_h / 2, x0 + total, 256 + outer_h / 2)
    return '\n  '.join(parts), bbox

def svg(name, glyph, padded):
    if padded:
        bg = '<rect x="64" y="64" width="384" height="384" rx="78" fill="%s"/>' % BG
        body = f'<g transform="translate(256 256) scale(0.75) translate(-256 -256)">\n  {glyph}\n  </g>'
    else:
        bg = '<rect width="512" height="512" rx="104" fill="%s"/>' % BG
        body = glyph
    doc = f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">\n  {bg}\n  {body}\n</svg>\n'
    open(os.path.join(out, name + '.svg'), 'w').write(doc)

large, bb = rings(S=44, outer_h=176, outer_w=236, overlap=60, interlock=True, gap=18)
small, bs = rings(S=68, outer_h=208, outer_w=250, overlap=70, interlock=False, gap=0)
print('large glyph bbox', bb, 'center', ((bb[0]+bb[2])/2, (bb[1]+bb[3])/2))
print('small glyph bbox', bs, 'center', ((bs[0]+bs[2])/2, (bs[1]+bs[3])/2))
svg('padded', large, True)      # 128, 48
svg('full', large, False)       # 비교용
svg('small', small, False)      # 32, 24, 16
