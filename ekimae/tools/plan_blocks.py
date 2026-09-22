#!/usr/bin/env python3
"""公式の平面図（plans/*.jpg）から「区画番号が図のどこにあるか」を割り出して
plans/blocks.json を作る。アプリはこれを使って、店の詳細から平面図を開いたときに
「その区画はここ」の○印を自動で出す。

番号の読み取りは機械ではやっていない。やっていることは2段階:

 1. 図の中から「番号ラベルらしい塊」の位置だけを機械で拾う
    （第3・第4ビルは色つきのチップ、第2ビルは区画の塗りの中の文字）
 2. 拾った塊を並べたコンタクトシート（chips/*_sheet.png）を人が目で読み、
    その並び順どおりに LABELS へ番号を書き写す

だから LABELS は手で作った対応表で、並び順が命。検出のしきい値をいじると
並びが変わって対応がズレる。いじったら必ず --sheets を作り直して読み直すこと。
確認用に plans/../chips/*_verify.png（図の上に割り当てた番号を重ねた画像）が出る。

使い方:
    python3 tools/plan_blocks.py --sheets   # コンタクトシートだけ作る（読み直し用）
    python3 tools/plan_blocks.py            # blocks.json と検証画像を作る

numpy と Pillow が要る。
"""
import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFont
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PLANS = os.path.join(ROOT, 'plans')
WORK = os.path.join(ROOT, 'plans', 'chips')


# 図の描き方が2種類ある。第3・第4ビルは色つきのチップ、第2ビルは区画の塗りに直接文字。
# 図ごとの検出のクセ。第1ビルは区画が緑の丸で、仕切りの壁線も緑なので、
# 彩度のしきい値を上げないと丸が壁と1つに繋がってしまう。
TUNE = {
    'b1-B1': {'sat_min': 75, 'hmax': 34, 'fill': 0.5, 'erode': False},
    'b1-B2': {'sat_min': 78, 'hmax': 34, 'fill': 0.5, 'erode': False},
}

STYLE = {
    'b1-B1': 'chip', 'b1-B2': 'chip',
    'b2-B1': 'glyph', 'b2-B2': 'glyph',
    'b3-B1': 'chip', 'b3-B2': 'chip', 'b4-B1': 'chip', 'b4-B2': 'chip',
    # うめよこ・バルチカ03 は区画そのものが単色のベタ塗り。番号は中に大きく
    # 書いてあるので、塗りの連結成分を拾えばそのまま区画の位置になる。
    'bkitte-B1': 'box',
    'bbar03-2F': 'box', 'bbar03-3F': 'box', 'bbar03-4F': 'box', 'bbar03-5F': 'box',
}

# 'box' スタイルで拾う塗りの色（RGB）と許容誤差。JPEG なので少し幅を持たせる。
BOX_FILL = {
    'bkitte-B1': ((233, 83, 120), 26),     # うめよこの桃色区画（赤い区画は物販なので拾わない）
    'bbar03-2F': ((212, 222, 234), 14),    # バルチカ03の淡い水色区画
    'bbar03-3F': ((212, 222, 234), 14),
    'bbar03-4F': ((212, 222, 234), 14),
    'bbar03-5F': ((212, 222, 234), 14),
}

# 平面図から検出した区画ラベルの並び（左上から右下へ）。
# 目視で読み取った値。リストは1つの塊に複数の番号が繋がっていたもの、
# ('V', [...]) は縦に並んでいたもの。None は階段や矢印などの誤検出。
LABELS = {
 'b4-B1': [
  '70-3','8','7-2','70-4','7-1','6','5',
  '70-5','3','26','2','1','22','18',
  '19','20-1','21','23','27',None,'20-2',
  '70-6','10','16','24','25','28','70-7',
  '15','11','32',None,'35','36',None,
  '37','12-1','38','71','17','29','12-2',
  '30','31','33-2','34','39','40','33-1',
  '41','14','43','45','46','47','48',
  '50','51','52','53',None,
 ],
 'b4-B2': [
  '70','11-1','10','11-2','8-2','8-1','71',
  '6','7','72','5-2','3','5','25-1',
  '2','29','30','31','1','22','23',
  '24','25-2','32-2','73-1','26','27','28',
  '32-1','73-2','19','20','74','12','41-1',
  '14-1','38',None,'19-2',None,'41-2','75',
  '76','77','14-2','33','34','21','36',
  '39','40','43','45-2','35','16','17',
  '18-2','18-1','47','50','51','52','53',
  '54',None,
 ],
 'b3-B2': [
  ['16','17-1','17-2'],'1','2','3','5','6','7',
  '8','10','11','12','14','15','89',
  '17-3','101','26',['27','28'],'29','30','34',
  '35',['36-1','36-2','37-1','37-2'],'38','90','102',None,'18',
  '31',['91','92'],'103','19','33','39','40',
  '41','43-1','43-2','105',('V',['20','21-1']),'32',['45','46'],
  '97','107','21-2','47',None,None,'50',
  '48','51','100-1','23-2',None,'23-3',['52','53','58'],
  '56-1','56-2','64-1','64-2','24','59-1','59-2',
  '61',['62','63'],'68','69','70','71',['112','114'],
  '72','73','74','75','76','77','78',
  '80',['81','82','83'],'85','86-1','86-2','87',None,
  '84',
 ],
}

LABELS['b2-B1'] = [
 '1','2','3-1','3-2','3-3','4','6-1',
 '6-2','10','12-1','12-2','11',None,None,
 '13','16','19','8-3','8-2','8-1','14-1',
 '20','14-2','17-1','21',None,'15','18',
 '8-4','8-5',None,None,'58-1',None,None,
 None,None,'36-1','58-2','36-2','43-1','28',
 '31-1',None,'35','36-3','43-2',None,'23',
 '29','31-2','37-1','37-2','60','27','30',
 '32','37-3','33','39','45','46','41',
 '47','48-1-1','48-1-2','48-2','48-3-1',None,None,
 '48-3-2','49',None,'50','51-1','51-2','52',
 '53','54','55','57',None,
]

LABELS['b2-B2'] = [
 '1','5-1','5-3','7-2','2','3','4',
 '5-2',None,None,'8','19-1-1','19-1-2','12-1',
 '12-2','16',None,None,'23-1','26','9',
 None,'15','19-2','22','23-2','17-1','20-1',
 '27-1','13','17-2','20-2',None,'24-1','24-2',
 '27-2','10','14',None,'18','21','25-1',
 '25-2','28-1',None,'28-2','11',None,'28-3',
 '50-1',None,None,'50-2','29','32-1','36',
 None,'40',None,'54','50-3','55','33',
 None,'41','47-1','51-1',None,'44-1','47-2',
 '51-2','31','35','37','42-1','48-1','52-1',
 '34-1','34-2','42-2','48-2','52-2','57-2','35-4',
 '45','49-1','49-2','57-3-2','57-3-1','58','43',
 None,'53',None,None,'59','60','61-1',
 '61-2','62-1','62-2','63-1','63-2',None,None,
 None,'64','65','66','67-1','67-2','70-1',
 '71',None,'68','69',None,None,
]

LABELS['b1-B1'] = [
 '02','03','04','05','06','07','08',
 '09','10','11','12','13','01','38',
 '39','42','36',None,'41','14','15',
 '16','40',None,None,None,None,None,
 None,'51','46','43','17','49','48',
 '20','50','47','45','44','35','34',
 '33','32','31','30',['29','28','27','26'],'25','24',
 '23','22','21',
]

LABELS['b1-B2'] = [
 '02','03','04','05','12','13','01',
 '06','11','07',None,None,'15','16',
 '09','23','24','10','25','26','17',
 '08',None,None,None,'57','49',None,
 None,'31',None,'18','19','58','59',
 '60','48','47','46','36','35',['34','33'],
 '32','28','20','37','21','61','62',
 '53','52','51','50','45','43','39',
 '38','22','63','64','56','55','54',
 '44','42','41','40','30','29','65',
 '84','66','67','68','69','70','71',
 '72','73','74','75','76','77','78',
 '79','80','81','82','83',
]

LABELS['b3-B1'] = [
 '1','2','3','5','7','8',None,
 '10',['11-2','11-1'],'6','73','12','23','26',
 '27','28','29','30','21','22',None,
 '74-1','14',['31','37'],'74-2','25','32-1','32-2',
 '33','34-1','34-2','35','36','24','75-1',
 '15','75-2','16','38',None,'41','17',
 '40','76','39',None,None,'43','18',
 '19','45','57','58','47','48','49',
 '50','51','20-1','46','20-2','52-2','53',
 '54','55','56',None,'59-2','60','59-1',
 '61-1','61-2','62',None,'63','64','65',
 '66','67','68','69','70','71','72',
 '78',
]

# 自動では拾えなかったぶん。平面図を見て手で入れた位置（画像の縦横に対する割合）
# うめよこ / バルチカ03。区画のベタ塗りをそのまま拾うので、番号はコンタクトシート
# （plans/chips/*_sheet.png）を目視で読み写したもの。None は通路の帯やロゴの誤検出。
LABELS['bkitte-B1'] = [
 '002', '003', '001', '017', '016', None, '005',
 '004', '015', '014', '013', '012', '006', '008',
 '007', '009', '010', '011',
]

LABELS['bbar03-2F'] = ['201', None]

LABELS['bbar03-3F'] = ['303', '301', '304', '305', '306']

LABELS['bbar03-4F'] = [
 '407', '408', '410', '411', '412', '402', '403',
 '404', '405', '406', '414', '413', '401', '420',
 '415', '421', '418', '416', '419', '417',
]

LABELS['bbar03-5F'] = [
 '506', '507', '508', '509', '501', '502', '503',
 '504', '505', '512', '511', '522', '520', '519',
 '514', '513', '510', '521', '517', '515', '518',
 '516', None, None, None,
]


EXTRA = {
 'b2-B1': {'7-1': [0.5553, 0.1411]},
 'b2-B2': {'6-2': [0.5600, 0.1339], '7-1': [0.5847, 0.1536], '32-2': [0.1988, 0.6321]},
 'b3-B2': {'22-1': [0.1633, 0.5100], '22-2': [0.1633, 0.5400], '23-1': [0.1683, 0.5725]},
 'b4-B2': {'48': [0.4823, 0.8755]},
}

# ---- 1. チップ（第3・第4ビル: 色つきの番号ラベル）を拾う ----

def detect(path, erode=0, sat_min=55):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(int)
    H, W, _ = a.shape
    mx = a.max(2); mn = a.min(2); sat = mx - mn
    # チップは「濃い色で塗りつぶした小さな角丸長方形」。
    # 淡い水色の区画・白背景・細い枠線と区別するため、彩度が高いか
    # 十分に暗いピクセルだけを拾う。
    mask = (sat >= sat_min) | (mx <= 110)
    for _ in range(erode):
        # 細い区画線（濃い青）を通じてチップ同士が1つに繋がってしまうので、
        # 輪郭を1px削って線を消してから塊を数える。削ったぶんは後で戻す。
        m = mask
        e = m.copy()
        e[:, 1:] &= m[:, :-1]
        e[:, :-1] &= m[:, 1:]
        e[1:, :] &= m[:-1, :]
        e[:-1, :] &= m[1:, :]
        mask = e
    lbl = -np.ones((H, W), dtype=int)
    boxes = []
    stack = []
    nid = 0
    m = mask
    for y in range(H):
        row = m[y]
        for x in range(W):
            if not row[x] or lbl[y, x] >= 0:
                continue
            lbl[y, x] = nid
            stack.append((y, x))
            x0 = x1 = x; y0 = y1 = y; n = 0
            while stack:
                cy, cx = stack.pop()
                n += 1
                if cx < x0: x0 = cx
                if cx > x1: x1 = cx
                if cy < y0: y0 = cy
                if cy > y1: y1 = cy
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny, nx2 = cy+dy, cx+dx
                    if 0 <= ny < H and 0 <= nx2 < W and m[ny, nx2] and lbl[ny, nx2] < 0:
                        lbl[ny, nx2] = nid
                        stack.append((ny, nx2))
            nid += 1
            bw = x1-x0+1; bh = y1-y0+1
            area = bw*bh
            fill = n/area
            boxes.append(dict(x0=x0,y0=y0,x1=x1,y1=y1,w=bw,h=bh,n=n,fill=round(fill,2)))
    return im, boxes


# ---- 2. 文字（第2ビル: 区画の塗りの中に書かれた番号）を拾う ----

def cc(mask):
    H, W = mask.shape
    lbl = -np.ones((H, W), dtype=np.int32)
    out = []
    nid = 0
    for y in range(H):
        row = mask[y]
        for x in range(W):
            if not row[x] or lbl[y, x] >= 0:
                continue
            lbl[y, x] = nid
            st = [(y, x)]
            n = 0; x0 = x1 = x; y0 = y1 = y
            while st:
                cy, cx = st.pop()
                n += 1
                if cx < x0: x0 = cx
                if cx > x1: x1 = cx
                if cy < y0: y0 = cy
                if cy > y1: y1 = cy
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                    ny, nx = cy+dy, cx+dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and lbl[ny, nx] < 0:
                        lbl[ny, nx] = nid
                        st.append((ny, nx))
            nid += 1
            out.append(dict(n=n, x0=x0, y0=y0, x1=x1, y1=y1, w=x1-x0+1, h=y1-y0+1))
    return out

def grow(m, k):
    for _ in range(k):
        e = m.copy()
        e[:, 1:] |= m[:, :-1]; e[:, :-1] |= m[:, 1:]
        e[1:, :] |= m[:-1, :]; e[:-1, :] |= m[1:, :]
        m = e
    return m

def shrink(m, k):
    for _ in range(k):
        e = m.copy()
        e[:, 1:] &= m[:, :-1]; e[:, :-1] &= m[:, 1:]
        e[1:, :] &= m[:-1, :]; e[:-1, :] &= m[1:, :]
        m = e
    return m

def labels(name):
    im = Image.open(os.path.join(PLANS, name + '.jpg')).convert('RGB')
    a = np.asarray(im).astype(int)
    mx = a.max(2); mn = a.min(2); sat = mx - mn
    fill = (sat >= 40) & (mx >= 90) & (mx <= 245)
    # 文字は塗りの中に空いた白い穴。塗りを膨らませてから縮めると穴が埋まるので、
    # その「埋めた領域」の中の白いところ＝文字、として取り出す
    solid = shrink(grow(fill, 5), 5)
    # 文字は白抜きのものと黒のものが混ざっている
    white = mn >= 170
    dark = mx <= 150
    text = (white | dark) & solid
    def isglyph(g):
        if not (2 <= g['w'] <= 20 and 4 <= g['h'] <= 19 and g['n'] >= 6):
            return False
        # 区画の仕切り線は黒く細長い。文字と混ざると番号の箱が伸びてしまう
        if g['w'] <= 3 and g['h'] >= 9: return False
        if g['h'] <= 3 and g['w'] >= 9: return False
        # ハイフンは小さな塗りつぶしなので、大きいものだけを「線」として弾く
        if g['w'] >= 6 and g['h'] >= 6 and g['n'] / (g['w'] * g['h']) > 0.85: return False
        return True
    gs = [g for g in cc(text) if isglyph(g)]
    # 近い字どうしをまとめて1つの番号にする
    gs.sort(key=lambda g: (g['y0'], g['x0']))
    groups = []
    for g in gs:
        for gr in groups:
            if (g['x0'] <= gr['x1'] + 6 and g['x1'] >= gr['x0'] - 6
                    and g['y0'] <= gr['y1'] + 2 and g['y1'] >= gr['y0'] - 2):
                gr['x0'] = min(gr['x0'], g['x0']); gr['x1'] = max(gr['x1'], g['x1'])
                gr['y0'] = min(gr['y0'], g['y0']); gr['y1'] = max(gr['y1'], g['y1'])
                break
        else:
            groups.append(dict(g))
    # まとめた結果さらに隣接したものが出るので、落ち着くまで繰り返す
    changed = True
    while changed:
        changed = False
        for i in range(len(groups)):
            for j in range(len(groups)-1, i, -1):
                p, q = groups[i], groups[j]
                if (p['x0'] <= q['x1'] + 6 and p['x1'] >= q['x0'] - 6
                        and p['y0'] <= q['y1'] + 2 and p['y1'] >= q['y0'] - 2):
                    p['x0'] = min(p['x0'], q['x0']); p['x1'] = max(p['x1'], q['x1'])
                    p['y0'] = min(p['y0'], q['y0']); p['y1'] = max(p['y1'], q['y1'])
                    groups.pop(j); changed = True
    for g in groups:
        g['w'] = g['x1']-g['x0']+1; g['h'] = g['y1']-g['y0']+1
    groups = [g for g in groups if g['w'] >= 5 and g['h'] >= 5]
    groups.sort(key=lambda g: (round(g['y0']/16), g['x0']))
    return im, groups


# ---- 3. 目で読むためのコンタクトシート ----

def chip_boxes(name, erode):
    t = TUNE.get(name, {})
    im, boxes = detect(os.path.join(PLANS, name + '.jpg'), erode=erode,
                       sat_min=t.get('sat_min', 55))
    lo = 1 if erode else 0
    hmax = t.get('hmax', 26)
    fmin = t.get('fill', 0.58)
    keep = [b for b in boxes if 9-2*lo <= b['h'] <= hmax and 10-2*lo <= b['w'] <= 130
            and b['n'] >= (40 if lo else 80)
            and b['fill'] >= fmin and 0.6 <= b['w']/b['h'] <= 9.0]
    for b in keep:
        b['x0'] -= lo; b['y0'] -= lo; b['x1'] += lo; b['y1'] += lo
        b['w'] += 2*lo; b['h'] += 2*lo
    return im, keep


def chips(name):
    # 黒いチップは白抜きの数字が大きく、1px削ると輪郭ごと消えてしまう。
    # 逆に削らないと、細い区画線を伝って隣のチップと1つに繋がる。
    # そこで両方で拾って重ね合わせ、小さく切れている方を優先して残す。
    im, a = chip_boxes(name, 0)
    # 丸い区画の図（第1ビル）は彩度で分離できるので、削ると輪郭が崩れるだけ
    b = [] if TUNE.get(name, {}).get('erode') is False else chip_boxes(name, 1)[1]
    keep = []
    for c in sorted(a + b, key=lambda x: x['w'] * x['h']):
        cx = (c['x0'] + c['x1']) / 2
        cy = (c['y0'] + c['y1']) / 2
        if any(k['x0'] <= cx <= k['x1'] and k['y0'] <= cy <= k['y1'] for k in keep):
            continue
        keep.append(c)
    keep.sort(key=lambda b: (round(b['y0']/14), b['x0']))
    return im, keep


def filled_boxes(name):
    """区画が単色ベタ塗りの図（うめよこ・バルチカ03）から、その塗りの塊を拾う。

    チップ検出と違って色をピンポイントで指定するので、通路・壁・アイコンは
    はじめから入ってこない。番号の読み取りはこれまでどおり人がやる。
    """
    im = Image.open(os.path.join(PLANS, name + '.jpg')).convert('RGB')
    col, tol = BOX_FILL[name]
    a = np.asarray(im).astype(int)
    H, W, _ = a.shape
    mask = np.abs(a - np.array(col)).max(axis=2) <= tol
    # ここで grow/shrink はしない。区画どうしは細い枠線1本で接しているだけなので、
    # 少しでも膨らませると隣の区画と1つの塊に融けてしまう。
    bs = [b for b in cc(mask) if b['n'] >= max(120, (W * H) // 4000)]
    bs.sort(key=lambda b: (round(((b['y0'] + b['y1']) / 2) / (H / 6)),
                           (b['x0'] + b['x1']) / 2))
    return im, bs


def boxes_for(name):
    st = STYLE[name]
    if st == 'glyph':
        return labels(name)
    if st == 'box':
        return filled_boxes(name)
    return chips(name)


def contact_sheet(name):
    im, bs = boxes_for(name)
    cols, cw, ch, scale = 7, 170, 110, 5
    pad = 10 if STYLE[name] == 'glyph' else 3
    rows = (len(bs) + cols - 1) // cols
    out = Image.new('RGB', (cols*cw, max(1, rows)*ch), (255, 255, 255))
    d = ImageDraw.Draw(out)
    for i, b in enumerate(bs):
        c = im.crop((b['x0']-pad, b['y0']-pad+3, b['x1']+pad+1, b['y1']+pad-2))
        k = min(scale, (cw-30)/max(1, c.width), (ch-20)/max(1, c.height))
        c = c.resize((max(1, round(c.width*k)), max(1, round(c.height*k))), Image.LANCZOS)
        cx, cy = (i % cols)*cw, (i//cols)*ch
        d.rectangle([cx, cy, cx+cw-1, cy+ch-1], outline=(200, 200, 200))
        d.text((cx+4, cy+2), str(i), fill=(200, 0, 0))
        out.paste(c, (cx+24, cy+16))
    os.makedirs(WORK, exist_ok=True)
    out.save(os.path.join(WORK, name + '_sheet.png'))
    print('%s: %d個 -> chips/%s_sheet.png' % (name, len(bs), name))
    return bs


# ---- 4. blocks.json を書き出す ----

def build():
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
    except Exception:
        font = None
    os.makedirs(WORK, exist_ok=True)
    out = {}
    for key in sorted(LABELS):
        im, bs = boxes_for(key)
        names = LABELS[key]
        if len(bs) != len(names):
            raise SystemExit(
                '%s: 検出%d個に対して LABELS が%d個。検出条件を変えたなら '
                '--sheets でコンタクトシートを作り直して読み直すこと。'
                % (key, len(bs), len(names)))
        W, H = im.size
        spots = {}
        for b, lab in zip(bs, names):
            if lab is None:
                continue
            vertical = False
            if isinstance(lab, tuple):
                vertical, lab = (lab[0] == 'V'), lab[1]
            group = lab if isinstance(lab, list) else [lab]
            # 1つの塊に複数の番号がくっついていたら、塊を等分して割り当てる
            for i, nm in enumerate(group):
                n = len(group)
                if vertical:
                    cx = (b['x0'] + b['x1'] + 1) / 2
                    cy = b['y0'] + (b['y1'] - b['y0'] + 1) * (i + 0.5) / n
                else:
                    cx = b['x0'] + (b['x1'] - b['x0'] + 1) * (i + 0.5) / n
                    cy = (b['y0'] + b['y1'] + 1) / 2
                spots[nm] = [round(cx/W, 4), round(cy/H, 4)]
        spots.update(EXTRA.get(key, {}))
        out[key] = spots
        print('%s: %d区画' % (key, len(spots)))

        big = im.resize((W*2, H*2), Image.LANCZOS)
        d = ImageDraw.Draw(big)
        for nm, (x, y) in spots.items():
            px, py = x*W*2, y*H*2
            d.rectangle([px-16, py-8, px+16, py+8], fill=(255, 255, 255), outline=(220, 0, 0))
            d.text((px-14, py-7), nm, fill=(200, 0, 0), font=font)
        big.save(os.path.join(WORK, key + '_verify.png'))

    path = os.path.join(PLANS, 'blocks.json')
    json.dump(out, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('書き出し:', path)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheets', action='store_true', help='コンタクトシートだけ作る')
    a = ap.parse_args()
    if a.sheets:
        for k in sorted(LABELS):
            contact_sheet(k)
    else:
        build()
