import math, json, sys

C = 64.0
EYE = "#17181c"

def fmt(v): return f"{v:.1f}".rstrip("0").rstrip(".")

def polar_path(fn, n=180, rot=0.0, cx=C, cy=C):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        r = fn(t)
        a = t + math.radians(rot)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return "M" + " L".join(f"{fmt(x)} {fmt(y)}" for x, y in pts) + "Z"

def rounded_poly(verts, radius):
    n = len(verts); d = ""
    for i in range(n):
        p0, p1, p2 = verts[i - 1], verts[i], verts[(i + 1) % n]
        def toward(a, b, dist):
            dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy); k = min(dist, L / 2) / L
            return (a[0] + dx * k, a[1] + dy * k)
        s = toward(p1, p0, radius); e = toward(p1, p2, radius)
        d += ("M" if i == 0 else "L") + f"{fmt(s[0])} {fmt(s[1])} Q{fmt(p1[0])} {fmt(p1[1])} {fmt(e[0])} {fmt(e[1])} "
    return d + "Z"

def reg_poly(n, R, rot, cx=C, cy=C, stretch=None):
    out = []
    for i in range(n):
        a = math.radians(rot) + 2 * math.pi * i / n
        r = R * (stretch[i] if stretch else 1)
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out

def smooth_lobes(R, n, amp, sharp=1.0):
    def f(t):
        c = math.cos(n * t)
        return R * (1 + amp * (abs(c) ** sharp) * (1 if c > 0 else -1))
    return f

def circles(specs):
    return "".join(f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{fmt(r)}"/>' for x, y, r in specs)

def lobes(n, d, r, core, rot=0, cx=C, cy=C, jitter=None):
    out = [(cx, cy, core)]
    for i in range(n):
        a = math.radians(rot) + 2 * math.pi * i / n
        rr = r * (jitter[i] if jitter else 1)
        out.append((cx + d * math.cos(a), cy + d * math.sin(a), rr))
    return circles(out)

P = lambda d: f'<path d="{d}"/>'
shapes = {
    "coordinator": ("#3c82f6", P(rounded_poly([(50, 6), (96, 24), (122, 80), (44, 118), (8, 56)], 22))),
    "circle": ("#3c82f6", '<circle cx="64" cy="64" r="58"/>'),
    "teardrop": ("#ed702d", P(polar_path(lambda t: 50 * (1 + 0.5 * max(0.0, math.cos(t)) ** 9), rot=-125, cx=67, cy=70))),
    "star4": ("#eb4698", P(polar_path(lambda t: 38 + 24 * abs(math.cos(2 * t)) ** 2.6, n=280, rot=-12))),
    "square": ("#8c6640", P(rounded_poly(reg_poly(4, 64, 45 - 20), 12))),
    "hexagon": ("#8c6640", P(rounded_poly(reg_poly(6, 60, -12), 12))),
    "cloud7": ("#5ac67a", lobes(7, 34, 24, 40, rot=-90)),
    "splat": ("#895bf5", P(polar_path(lambda t: 44 + 17 * abs(math.cos(3 * t)) ** 2.4 * (1 if math.cos(3*t) > 0 else 0.85) + 2 * math.sin(7 * t), n=320, rot=-35))),
    "flower5": ("#f19d38", lobes(6, 34, 25, 40, rot=-75, jitter=[1, 1.06, .95, 1.04, .97, 1.02])),
    "blob4": ("#ea4045", lobes(5, 30, 30, 42, rot=-60, jitter=[1, .9, 1.05, .92, 1])),
    "bean": ("#54b9a6", circles([(64, 70, 44), (32, 72, 30), (98, 70, 28), (48, 44, 26), (84, 40, 26), (64, 92, 32)])),
    "triangle": ("#f4b740", P(rounded_poly(reg_poly(3, 66, -100, 64, 70), 22))),
}

def svg(color, path, ex=0, ey=0, k=1.0, rot=-24):
    eyes = "".join(
        f'<rect x="{fmt(x - 4.5*k)}" y="{fmt(y - 10.5*k)}" width="{fmt(9*k)}" height="{fmt(21*k)}" rx="{fmt(4.5*k)}" transform="rotate({rot} {fmt(x)} {fmt(y)})" fill="{EYE}"/>'
        for x, y in [(64 + ex - 9.5*k*(1.2 if rot < -30 else 1), 56.5 + ey + 1.5*k), (64 + ex + 9.5*k*(1.2 if rot < -30 else 1), 56.5 + ey - 1.5*k*(3 if rot < -30 else 1))])
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g fill="{color}">{path}</g>{eyes}</svg>'

out = {}
for k, (color, path) in shapes.items():
    ex, ey = (14, -18) if k == "circle" else (0, 0)
    out[k] = svg(color, path, ex, ey, 1.35 if k == "circle" else 1.0, -34 if k == "circle" else -24)
    open(f"scripts/agent-icons/{k}.svg", "w").write(out[k])
import subprocess
from PIL import Image
for k in list(out):
    open('/tmp/fit.svg','w').write(out[k]); subprocess.run(['rsvg-convert','-w','512','-h','512','/tmp/fit.svg','-o','/tmp/fit.png'])
    x0,y0,x1,y1 = Image.open('/tmp/fit.png').getchannel('A').getbbox(); x0,y0,x1,y1 = [v/4 for v in (x0,y0,x1,y1)]
    sc = 112 / max(x1-x0, y1-y0); tx = 64 - sc*(x0+x1)/2; ty = 64 - sc*(y0+y1)/2
    body = out[k].split('128 128">',1)[1].rsplit('</svg>',1)[0]
    out[k] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g transform="translate({fmt(tx)} {fmt(ty)}) scale({sc:.4f})">{body}</g></svg>'
    open(f"scripts/agent-icons/{k}.svg", "w").write(out[k])
json.dump(out, open("scripts/agent-icons/all.json", "w"))
