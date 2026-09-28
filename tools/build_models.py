#!/usr/bin/env python3
"""
Procedural 3D asset factory for DATA CABLE CHAOS: SERVER ROOM SLICE.

Builds every connector / hazard / prop model straight from code (numpy only)
and writes binary glTF 2.0 (.glb) files into assets/models/.
The shapes follow design/reference/assets.jpg:

    rj45.glb          blue CAT6 plug: clear body, gold contacts, latch, ribbed boot
    fiber_sc.glb      yellow fiber-optic SC plug with ceramic ferrule + light core
    terminal_fork.glb green terminal line: insulated sleeve + copper fork spade
    coax_f.glb        grey coax F-connector with hex nut + centre pin
    hv_end.glb        400V power cable end: taped jacket + stripped copper wires
    firewall.glb      spiked security firewall shield (brick wall, glowing mortar)
    packet.glb        corrupted data packet (neon wire-frame cube + glitch blocks)
    cut_lan.glb       sliced CAT6 cross-section: 4 twisted pairs sticking out
    cut_fiber.glb     sliced fiber: aramid yarn + glowing glass core
    cut_copper.glb    sliced power/terminal cable: thick copper strands

Convention: cable radius = 1 unit, connectors point along +Y starting at y=0,
so the game can scale them by the tube radius and attach them to cable ends.
Parts whose node name is "boot" / "jacket" get re-coloured at runtime.

Usage:  python3 tools/build_models.py
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "models"
OUT.mkdir(parents=True, exist_ok=True)

TAU = math.tau


# ==========================================================================
# Mesh container + primitives
# ==========================================================================
class Mesh:
    def __init__(self, pos=None, nrm=None, uv=None, idx=None):
        self.pos = np.zeros((0, 3), np.float32) if pos is None else np.asarray(pos, np.float32)
        self.nrm = np.zeros((0, 3), np.float32) if nrm is None else np.asarray(nrm, np.float32)
        self.uv = np.zeros((0, 2), np.float32) if uv is None else np.asarray(uv, np.float32)
        self.idx = np.zeros((0, 3), np.uint32) if idx is None else np.asarray(idx, np.uint32)

    def __add__(self, o: "Mesh") -> "Mesh":
        return Mesh(
            np.vstack([self.pos, o.pos]),
            np.vstack([self.nrm, o.nrm]),
            np.vstack([self.uv, o.uv]),
            np.vstack([self.idx, o.idx + len(self.pos)]),
        )

    # -- transforms --------------------------------------------------------
    def apply(self, m: np.ndarray) -> "Mesh":
        p = np.c_[self.pos, np.ones(len(self.pos))] @ m.T
        n = self.nrm @ np.linalg.inv(m[:3, :3])
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        idx = self.idx
        if np.linalg.det(m[:3, :3]) < 0:  # mirrored -> flip winding
            idx = idx[:, ::-1]
        return Mesh(p[:, :3], n, self.uv, idx)

    def move(self, x=0.0, y=0.0, z=0.0):
        return self.apply(translate(x, y, z))

    def rot(self, axis, ang):
        return self.apply(rotate(axis, ang))

    def scale(self, sx, sy=None, sz=None):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        return self.apply(np.diag([sx, sy, sz, 1.0]))


def translate(x, y, z):
    m = np.eye(4)
    m[:3, 3] = [x, y, z]
    return m


def rotate(axis, ang):
    x, y, z = np.asarray(axis, float) / np.linalg.norm(axis)
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    m = np.eye(4)
    m[:3, :3] = [
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ]
    return m


def merge(*meshes):
    out = Mesh()
    for m in meshes:
        out = out + m
    return out


def box(sx, sy, sz, cx=0.0, cy=0.0, cz=0.0):
    """Axis aligned box with flat normals."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [
        ((1, 0, 0), [(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)]),
        ((-1, 0, 0), [(-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz), (-hx, -hy, -hz)]),
        ((0, 1, 0), [(-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)]),
        ((0, -1, 0), [(-hx, -hy, hz), (-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz)]),
        ((0, 0, 1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)]),
    ]
    pos, nrm, uv, idx = [], [], [], []
    for n, quad in faces:
        b = len(pos)
        pos += quad
        nrm += [n] * 4
        uv += [(0, 0), (1, 0), (1, 1), (0, 1)]
        idx += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    return Mesh(pos, nrm, uv, idx).move(cx, cy, cz)


def lathe(profile, seg=24, flat=False, phase=0.0, arc=TAU):
    """Revolve a (radius, y) profile around +Y.  Normals come from the profile
    tangent so rims stay crisp when points are duplicated."""
    prof = np.asarray(profile, float)
    n = len(prof)
    # profile normals (2D, pointing outward)
    tang = np.gradient(prof, axis=0)
    pn = np.c_[tang[:, 1], -tang[:, 0]]
    pn /= np.maximum(np.linalg.norm(pn, axis=1, keepdims=True), 1e-9)
    # arc length for v
    L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(prof, axis=0), axis=1))]
    L = L / max(L[-1], 1e-9)

    if flat:  # faceted (hex nuts, square boots): per-face vertices
        pos, nrm, uv, idx = [], [], [], []
        for s in range(seg):
            a0 = phase + arc * s / seg
            a1 = phase + arc * (s + 1) / seg
            am = (a0 + a1) / 2
            for i in range(n - 1):
                (r0, y0), (r1, y1) = prof[i], prof[i + 1]
                p = [
                    (r0 * math.cos(a0), y0, r0 * math.sin(a0)),
                    (r0 * math.cos(a1), y0, r0 * math.sin(a1)),
                    (r1 * math.cos(a1), y1, r1 * math.sin(a1)),
                    (r1 * math.cos(a0), y1, r1 * math.sin(a0)),
                ]
                e1 = np.subtract(p[1], p[0]) if r0 > 1e-6 else np.subtract(p[2], p[3])
                e2 = np.subtract(p[3], p[0])
                fn = np.cross(e2, e1)
                if np.linalg.norm(fn) < 1e-9:
                    fn = np.array([math.cos(am), 0, math.sin(am)])
                fn /= np.linalg.norm(fn)
                b = len(pos)
                pos += p
                nrm += [fn] * 4
                uv += [(s / seg, L[i]), ((s + 1) / seg, L[i]), ((s + 1) / seg, L[i + 1]), (s / seg, L[i + 1])]
                idx += [(b, b + 2, b + 1), (b, b + 3, b + 2)]
        return Mesh(pos, nrm, uv, idx)

    cols = seg + 1
    pos, nrm, uv = [], [], []
    for s in range(cols):
        a = phase + arc * s / seg
        ca, sa = math.cos(a), math.sin(a)
        for i in range(n):
            r, y = prof[i]
            pos.append((r * ca, y, r * sa))
            nrm.append((pn[i, 0] * ca, pn[i, 1], pn[i, 0] * sa))
            uv.append((s / seg, L[i]))
    idx = []
    for s in range(seg):
        for i in range(n - 1):
            a = s * n + i
            b = (s + 1) * n + i
            idx += [(a, a + 1, b), (b, a + 1, b + 1)]
    return Mesh(pos, nrm, uv, idx)


def cylinder(r, y0, y1, seg=16, cap=True):
    prof = [(0, y0), (r, y0), (r, y0), (r, y1), (r, y1), (0, y1)] if cap else [(r, y0), (r, y1)]
    return lathe(prof, seg)


def cone(r, y0, y1, seg=12):
    return lathe([(0, y0), (r, y0), (r, y0), (0.0001, y1)], seg)


def torus(R, r, seg=32, rseg=12):
    pos, nrm, uv, idx = [], [], [], []
    for i in range(seg + 1):
        u = TAU * i / seg
        cu, su = math.cos(u), math.sin(u)
        for j in range(rseg + 1):
            v = TAU * j / rseg
            cv, sv = math.cos(v), math.sin(v)
            pos.append(((R + r * cv) * cu, r * sv, (R + r * cv) * su))
            nrm.append((cv * cu, sv, cv * su))
            uv.append((i / seg, j / rseg))
    for i in range(seg):
        for j in range(rseg):
            a = i * (rseg + 1) + j
            b = (i + 1) * (rseg + 1) + j
            idx += [(a, b, a + 1), (b, b + 1, a + 1)]
    return Mesh(pos, nrm, uv, idx)


def sweep(points, radius, seg=10, cap=True):
    """Sweep a circle along a polyline (parallel transport frames)."""
    P = np.asarray(points, float)
    n = len(P)
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.array([0, 0, 1.0]) if abs(T[0, 2]) < 0.9 else np.array([1.0, 0, 0])
    N = np.cross(T[0], ref)
    N /= np.linalg.norm(N)
    frames = []
    for i in range(n):
        if i > 0:
            N = N - T[i] * np.dot(N, T[i])
            N /= np.linalg.norm(N)
        B = np.cross(T[i], N)
        frames.append((N.copy(), B))
    radii = np.broadcast_to(np.asarray(radius, float), (n,))
    pos, nrm, uv, idx = [], [], [], []
    for i in range(n):
        Ni, Bi = frames[i]
        for s in range(seg + 1):
            a = TAU * s / seg
            d = Ni * math.cos(a) + Bi * math.sin(a)
            pos.append(P[i] + d * radii[i])
            nrm.append(d)
            uv.append((i / (n - 1), s / seg))
    for i in range(n - 1):
        for s in range(seg):
            a = i * (seg + 1) + s
            b = (i + 1) * (seg + 1) + s
            idx += [(a, b, a + 1), (b, b + 1, a + 1)]
    m = Mesh(pos, nrm, uv, idx)
    if cap:
        for end, sign in ((0, -1), (n - 1, 1)):
            Ni, Bi = frames[end]
            c = len(m.pos)
            cp = [P[end]] + [P[end] + (Ni * math.cos(TAU * s / seg) + Bi * math.sin(TAU * s / seg)) * radii[end] for s in range(seg)]
            cn = [T[end] * sign] * (seg + 1)
            cu = [(0.5, 0.5)] + [(0.5 + 0.5 * math.cos(TAU * s / seg), 0.5 + 0.5 * math.sin(TAU * s / seg)) for s in range(seg)]
            ci = []
            for s in range(seg):
                a, b = c + 1 + s, c + 1 + (s + 1) % seg
                ci.append((c, a, b) if sign < 0 else (c, b, a))
            m = m + Mesh(cp, cn, cu, np.asarray(ci) - c)
    return m


def _ear_clip(poly):
    """Triangulate a simple 2D polygon (CCW)."""
    pts = [tuple(p) for p in poly]
    idx = list(range(len(pts)))
    tris = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0

    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = pts[i0], pts[i1], pts[i2]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(pts[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            break
        else:
            break
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


def extrude(poly, depth, bevel_uv=1.0):
    """Extrude a 2D polygon (x, y) along Z from -depth/2..+depth/2."""
    P = np.asarray(poly, float)
    area = 0.5 * np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1])
    if area < 0:
        P = P[::-1]
    n = len(P)
    h = depth / 2
    tris = _ear_clip(P)
    pos, nrm, uv, idx = [], [], [], []
    mn, mx = P.min(0), P.max(0)
    span = np.maximum(mx - mn, 1e-9)
    for z, sgn in ((h, 1), (-h, -1)):
        b = len(pos)
        for p in P:
            pos.append((p[0], p[1], z))
            nrm.append((0, 0, sgn))
            uv.append(tuple((p - mn) / span))
        for t in tris:
            idx.append((b + t[0], b + t[1], b + t[2]) if sgn > 0 else (b + t[0], b + t[2], b + t[1]))
    for i in range(n):
        a, c = P[i], P[(i + 1) % n]
        e = c - a
        fn = np.array([e[1], -e[0], 0.0])
        fn /= max(np.linalg.norm(fn), 1e-9)
        b = len(pos)
        pos += [(a[0], a[1], -h), (c[0], c[1], -h), (c[0], c[1], h), (a[0], a[1], h)]
        nrm += [fn] * 4
        uv += [(0, 0), (1, 0), (1, bevel_uv), (0, bevel_uv)]
        idx += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    return Mesh(pos, nrm, uv, idx)


def ribbed_profile(r0, r1, y0, y1, ribs, depth, steps=6):
    """Strain-relief boot: tapered radius with sinusoidal ridges."""
    pts = [(0.0, y0), (r0, y0)]
    N = ribs * steps
    for i in range(N + 1):
        t = i / N
        r = r0 + (r1 - r0) * t + depth * (0.5 + 0.5 * math.sin(TAU * ribs * t - math.pi / 2))
        pts.append((r, y0 + (y1 - y0) * t))
    return pts


# ==========================================================================
# Materials (glTF metallic-roughness)
# ==========================================================================
def mat(color, metal=0.0, rough=0.5, emissive=(0, 0, 0), strength=1.0, alpha=1.0, double=False):
    return dict(color=color, metal=metal, rough=rough, emissive=emissive, strength=strength, alpha=alpha, double=double)


M = {
    "clear": mat((0.75, 0.9, 1.0), 0.0, 0.08, alpha=0.38, double=True),
    "gold": mat((1.0, 0.78, 0.34), 1.0, 0.22, emissive=(0.25, 0.16, 0.02)),
    "copper": mat((0.95, 0.55, 0.3), 1.0, 0.28, emissive=(0.18, 0.07, 0.02)),
    "chrome": mat((0.86, 0.88, 0.92), 1.0, 0.18),
    "tin": mat((0.82, 0.84, 0.9), 0.55, 0.3, emissive=(0.06, 0.06, 0.08)),
    "steel": mat((0.55, 0.58, 0.64), 0.9, 0.35),
    "ceramic": mat((0.96, 0.96, 0.93), 0.0, 0.3),
    "boot": mat((0.12, 0.45, 1.0), 0.0, 0.45, emissive=(0.02, 0.12, 0.35)),
    "rubber_black": mat((0.04, 0.04, 0.05), 0.0, 0.7),
    "tape": mat((0.03, 0.03, 0.035), 0.0, 0.35),
    "fiber_light": mat((1.0, 0.95, 0.7), 0.0, 0.2, emissive=(1.0, 0.85, 0.45), strength=6.0),
    "core_glow": mat((0.7, 1.0, 1.0), 0.0, 0.2, emissive=(0.4, 1.0, 1.0), strength=5.0),
    "aramid": mat((1.0, 0.85, 0.35), 0.0, 0.8, emissive=(0.25, 0.18, 0.02)),
    "fire": mat((1.0, 0.22, 0.02), 0.0, 0.5, emissive=(1.0, 0.18, 0.0), strength=2.2),
    "brick": mat((0.22, 0.035, 0.03), 0.2, 0.55, emissive=(0.08, 0.005, 0.0)),
    "shield": mat((0.14, 0.14, 0.17), 0.85, 0.3),
    "blade": mat((0.92, 0.95, 1.0), 1.0, 0.08, emissive=(0.25, 0.3, 0.4)),
    "neon_cyan": mat((0.05, 0.8, 1.0), 0.0, 0.3, emissive=(0.0, 0.75, 1.0), strength=1.8),
    "neon_magenta": mat((1.0, 0.1, 0.8), 0.0, 0.3, emissive=(1.0, 0.05, 0.75), strength=1.8),
    "glitch_core": mat((0.3, 0.05, 0.4), 0.0, 0.2, emissive=(0.25, 0.0, 0.4), strength=1.0, alpha=0.5, double=True),
    "white_plastic": mat((0.85, 0.88, 0.95), 0.0, 0.35),
    "wire_orange": mat((1.0, 0.45, 0.05), 0.0, 0.45, emissive=(0.3, 0.1, 0.0)),
    "wire_green": mat((0.1, 0.85, 0.25), 0.0, 0.45, emissive=(0.02, 0.25, 0.05)),
    "wire_blue": mat((0.1, 0.35, 1.0), 0.0, 0.45, emissive=(0.02, 0.08, 0.3)),
    "wire_brown": mat((0.45, 0.22, 0.08), 0.0, 0.5, emissive=(0.08, 0.03, 0.0)),
    "wire_white": mat((0.92, 0.92, 0.9), 0.0, 0.5, emissive=(0.1, 0.1, 0.1)),
    "wire_black": mat((0.06, 0.06, 0.07), 0.0, 0.45),
    "wire_grey": mat((0.55, 0.55, 0.58), 0.0, 0.45),
    "wire_yellowgreen": mat((0.7, 0.85, 0.1), 0.0, 0.45, emissive=(0.12, 0.15, 0.0)),
    "jacket": mat((0.2, 0.2, 0.22), 0.0, 0.5),
}


# ==========================================================================
# GLB writer
# ==========================================================================
def write_glb(path: Path, parts: list[tuple[str, str, Mesh]], extras=None):
    """parts: (node_name, material_key, mesh). Parts sharing a name+material
    are merged into one primitive."""
    groups: dict[tuple[str, str], Mesh] = {}
    order = []
    for name, mkey, mesh in parts:
        k = (name, mkey)
        if k not in groups:
            groups[k] = Mesh()
            order.append(k)
        groups[k] = groups[k] + mesh

    blob = bytearray()
    views, accessors = [], []

    def add_view(data: bytes, target):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(data)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target})
        return len(views) - 1

    def add_acc(arr, ctype, typ, target, minmax=False):
        v = add_view(arr.tobytes(), target)
        acc = {"bufferView": v, "componentType": ctype, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            acc["min"] = arr.min(0).tolist()
            acc["max"] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    mat_keys = sorted({k[1] for k in order})
    materials = []
    used_ext = set()
    for key in mat_keys:
        d = M[key]
        m = {
            "name": key,
            "pbrMetallicRoughness": {
                "baseColorFactor": [*d["color"], d["alpha"]],
                "metallicFactor": d["metal"],
                "roughnessFactor": d["rough"],
            },
            "emissiveFactor": list(d["emissive"]),
        }
        if d["alpha"] < 1:
            m["alphaMode"] = "BLEND"
        if d["double"]:
            m["doubleSided"] = True
        if d["strength"] != 1.0:
            m["extensions"] = {"KHR_materials_emissive_strength": {"emissiveStrength": d["strength"]}}
            used_ext.add("KHR_materials_emissive_strength")
        materials.append(m)

    meshes, nodes = [], []
    for name, mkey in order:
        g = groups[(name, mkey)]
        pa = add_acc(g.pos.astype(np.float32), 5126, "VEC3", 34962, True)
        na = add_acc(g.nrm.astype(np.float32), 5126, "VEC3", 34962)
        ua = add_acc(g.uv.astype(np.float32), 5126, "VEC2", 34962)
        ia = add_acc(g.idx.astype(np.uint32).reshape(-1), 5125, "SCALAR", 34963)
        meshes.append({
            "name": name,
            "primitives": [{"attributes": {"POSITION": pa, "NORMAL": na, "TEXCOORD_0": ua},
                            "indices": ia, "material": mat_keys.index(mkey)}],
        })
        nodes.append({"name": name, "mesh": len(meshes) - 1})

    root = {"name": path.stem, "children": list(range(len(nodes)))}
    if extras:
        root["extras"] = extras
    nodes.append(root)
    gltf = {
        "asset": {"version": "2.0", "generator": "cable-chaos build_models.py"},
        "scene": 0,
        "scenes": [{"nodes": [len(nodes) - 1]}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    if used_ext:
        gltf["extensionsUsed"] = sorted(used_ext)
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    while len(blob) % 4:
        blob.append(0)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942))
        f.write(blob)
    tri = sum(len(groups[k].idx) for k in order)
    print(f"  {path.name:18s} {len(order):2d} parts  {tri:6d} tris  {path.stat().st_size/1024:6.1f} KB")


# ==========================================================================
# Models
# ==========================================================================
PAIR_COLORS = ["wire_orange", "wire_green", "wire_blue", "wire_brown"]


def model_rj45():
    parts = []
    # ribbed strain relief boot (square-ish via 4 flat facets at 45deg + round ribs)
    parts.append(("boot", "boot", lathe(ribbed_profile(1.12, 1.32, -0.2, 2.2, 5, 0.12), 20)))
    parts.append(("boot", "boot", lathe([(0, 2.1), (1.55, 2.1), (1.55, 2.1), (1.55, 2.8), (1.55, 2.8), (0, 2.8)],
                                        4, flat=True, phase=math.pi / 4)))
    # clear plug body (slightly tapered towards the tip)
    body = lathe([(0, 2.8), (1.6, 2.8), (1.6, 2.8), (1.5, 5.9), (1.5, 5.9), (0, 5.9)], 4, flat=True, phase=math.pi / 4)
    parts.append(("plug", "clear", body.scale(1.05, 1, 0.78)))
    # 8 conductors visible through the clear body
    for i in range(8):
        x = -0.84 + i * 0.24
        col = PAIR_COLORS[i // 2] if i % 2 == 0 else "wire_white"
        parts.append(("wires", col, cylinder(0.09, 2.7, 5.4, 8).move(x, 0, -0.05)))
        parts.append(("contacts", "gold", box(0.12, 1.25, 0.34, x, 5.2, 0.62)))
    # latch clip on the underside
    clip = extrude([(2.9, -0.95), (5.5, -0.95), (5.5, -1.08), (3.3, -1.62), (2.9, -1.55)], 0.8)
    parts.append(("clip", "clear", clip.apply(swap_xy_to_yz())))
    return parts


def swap_xy_to_yz():
    """Map extrude space (x=along, y=up, z=width) -> connector space (y=along, z=up, x=width)."""
    m = np.zeros((4, 4))
    m[3, 3] = 1
    # extrude x -> y, extrude y -> z, extrude z -> x
    m[1, 0] = 1
    m[2, 1] = 1
    m[0, 2] = 1
    return m


def model_fiber():
    parts = []
    parts.append(("boot", "boot", lathe(ribbed_profile(1.1, 1.28, -0.2, 2.3, 6, 0.1), 20)))
    parts.append(("ring", "chrome", lathe([(0, 2.2), (1.35, 2.2), (1.35, 2.2), (1.35, 2.9), (1.35, 2.9), (0, 2.9)], 24)))
    housing = lathe([(0, 2.9), (1.55, 2.9), (1.55, 2.9), (1.55, 5.4), (1.55, 5.4), (1.2, 5.6), (1.2, 5.6), (0, 5.6)],
                    4, flat=True, phase=math.pi / 4)
    parts.append(("housing", "white_plastic", housing))
    parts.append(("boot", "boot", box(1.9, 1.6, 0.25, 0, 4.2, 1.12)))  # coloured key tab
    parts.append(("ferrule", "ceramic", cylinder(0.45, 5.5, 6.9, 20)))
    parts.append(("ferrule_tip", "fiber_light", lathe([(0, 6.9), (0.45, 6.9), (0.45, 6.9), (0.3, 7.05), (0, 7.1)], 20)))
    return parts


def model_terminal():
    parts = []
    parts.append(("boot", "boot", lathe(ribbed_profile(1.08, 1.2, -0.2, 1.4, 3, 0.08), 20)))
    parts.append(("boot", "boot", lathe([(0, 1.3), (1.25, 1.3), (1.2, 2.6), (0.75, 3.0), (0, 3.0)], 20)))
    parts.append(("barrel", "copper", lathe([(0, 2.8), (0.6, 2.8), (0.6, 3.8), (0.45, 4.1), (0, 4.1)], 20)))
    fork = [(-0.55, 3.9), (0.55, 3.9), (0.7, 4.4), (1.2, 5.0), (1.2, 6.6), (0.95, 6.8), (0.55, 6.6),
            (0.45, 5.4), (-0.45, 5.4), (-0.55, 6.6), (-0.95, 6.8), (-1.2, 6.6), (-1.2, 5.0), (-0.7, 4.4)]
    parts.append(("spade", "tin", extrude(fork, 0.22)))
    return parts


def model_coax():
    parts = []
    parts.append(("boot", "jacket", lathe([(0, -0.2), (1.1, -0.2), (1.2, 0.8), (1.2, 0.8), (0, 0.8)], 20)))
    crimp = [(0, 0.8)] + [(1.3 + 0.06 * math.sin(i * 1.6), 0.8 + i * 0.12) for i in range(14)] + [(0, 0.8 + 13 * 0.12)]
    parts.append(("crimp", "chrome", lathe(crimp, 24)))
    parts.append(("nut", "steel", lathe([(0.9, 2.4), (1.75, 2.4), (1.75, 2.4), (1.75, 3.8), (1.75, 3.8), (0.9, 3.8)],
                                        6, flat=True)))
    thread = [(0.9, 3.8)] + [(1.1 + (0.1 if i % 2 else 0), 3.8 + i * 0.12) for i in range(12)] + [(0.9, 3.8 + 11 * 0.12)]
    parts.append(("thread", "chrome", lathe(thread, 24)))
    parts.append(("dielectric", "white_plastic", cylinder(0.85, 3.8, 5.0, 20)))
    parts.append(("pin", "copper", lathe([(0, 4.9), (0.16, 4.9), (0.16, 6.2), (0.05, 6.4), (0, 6.4)], 10)))
    return parts


def model_hv_end():
    parts = []
    # thick black tape wrap with slightly irregular bulges (like the reference)
    prof = [(0, -0.2)]
    for i in range(25):
        t = i / 24
        prof.append((1.1 + 0.08 * math.sin(t * 19) + 0.05 * math.sin(t * 7 + 1), -0.2 + t * 2.6))
    prof.append((0, 2.4))
    parts.append(("tape", "tape", lathe(prof, 20)))
    wires = [("wire_brown", 0), ("wire_black", 1), ("wire_grey", 2), ("wire_blue", 3), ("wire_yellowgreen", 4)]
    for col, i in wires:
        ang = TAU * i / 5 + 0.3
        ox, oz = 0.5 * math.cos(ang), 0.5 * math.sin(ang)
        spread = 0.55 + 0.1 * i
        pts = []
        for k in range(12):
            t = k / 11
            pts.append((ox * (1 + spread * t * 2.2), 2.2 + t * 3.0, oz * (1 + spread * t * 2.2)))
        parts.append(("wires", col, sweep(pts, 0.32, 12)))
        tip0 = np.array(pts[-1])
        d = tip0 - np.array(pts[-2])
        d /= np.linalg.norm(d)
        tip = [tip0 + d * s for s in np.linspace(0, 1.0, 5)]
        parts.append(("copper", "copper", sweep(tip, 0.22, 10)))
    return parts


def model_firewall():
    parts = []
    # octagonal armoured plate
    R = 3.2
    octo = [(R * math.cos(TAU * i / 8 + TAU / 16), R * math.sin(TAU * i / 8 + TAU / 16)) for i in range(8)]
    parts.append(("shield", "shield", extrude(octo, 0.5)))
    # glowing mortar behind the bricks
    inner = [(2.75 * math.cos(TAU * i / 8 + TAU / 16), 2.75 * math.sin(TAU * i / 8 + TAU / 16)) for i in range(8)]
    parts.append(("fire", "fire", extrude(inner, 0.2).move(0, 0, 0.3)))
    # brick wall (clipped to the octagon interior)
    bw, bh, gap = 1.05, 0.52, 0.09
    rows = 9
    for r in range(rows):
        y = -2.3 + r * (bh + gap)
        off = 0 if r % 2 == 0 else (bw + gap) / 2
        for c in range(-4, 5):
            x = c * (bw + gap) + off
            x0, x1 = x - bw / 2, x + bw / 2
            # clip to inner octagon approximately (circle radius 2.55)
            if max(math.hypot(x0, y), math.hypot(x1, y), math.hypot(x0, y + bh), math.hypot(x1, y + bh)) > 2.62:
                continue
            parts.append(("bricks", "brick", box(bw, bh, 0.35, x, y + bh / 2, 0.5)))
    # razor spikes around the rim ("scharfe Firewall")
    for i in range(16):
        a = TAU * i / 16
        spike = cone(0.32, 0, 1.5, 8).apply(rotate((0, 0, 1), a - math.pi / 2)).move(3.05 * math.cos(a), 3.05 * math.sin(a), 0)
        parts.append(("spikes", "blade", spike))
    # front + back centre spikes
    parts.append(("spikes", "blade", cone(0.35, 0.6, 2.0, 8).apply(rotate((1, 0, 0), math.pi / 2)).move(0, 0, 0.0)))
    parts.append(("spikes", "blade", cone(0.35, 0.6, 2.0, 8).apply(rotate((1, 0, 0), -math.pi / 2))))
    # rim ring
    parts.append(("rim", "chrome", torus(3.0, 0.14, 48, 8).rot((1, 0, 0), math.pi / 2).move(0, 0, 0.28)))
    return parts


def model_packet():
    parts = []
    s = 1.0
    t = 0.12
    for axis in range(3):
        for a in (-s, s):
            for b in (-s, s):
                size = [t, t, t]
                size[axis] = 2 * s + t
                c = [0, 0, 0]
                o = [i for i in range(3) if i != axis]
                c[o[0]], c[o[1]] = a, b
                parts.append(("frame", "neon_cyan" if (a > 0) ^ (b > 0) else "neon_magenta", box(*size, *c)))
    parts.append(("core", "glitch_core", box(1.7, 1.7, 1.7)))
    # displaced glitch shards
    rng = np.random.default_rng(404)
    for _ in range(7):
        sz = rng.uniform(0.2, 0.55, 3)
        c = rng.uniform(-1.2, 1.2, 3)
        parts.append(("glitch", "neon_magenta" if rng.random() > 0.5 else "neon_cyan", box(*sz, *c)))
    return parts


def cut_filler():
    """Dark disc that closes the open tube end behind a cut cross-section."""
    return ("filler", "rubber_black", cylinder(0.86, -0.02, 0.03, 20))


def model_cut_lan():
    """Cross-section of a sliced CAT6 cable: 4 twisted pairs + pull string."""
    parts = [cut_filler()]
    parts.append(("jacket_ring", "boot", lathe([(0.8, 0.0), (1.0, 0.0), (1.0, 0.0), (1.0, 0.18), (1.0, 0.18), (0.8, 0.18), (0.8, 0.0)], 20)))
    for p in range(4):
        base_a = TAU * p / 4 + TAU / 8
        cx, cz = 0.42 * math.cos(base_a), 0.42 * math.sin(base_a)
        splay = 0.35
        for k in range(2):
            pts = []
            for i in range(10):
                t = i / 9
                tw = TAU * 1.2 * t + k * math.pi
                pts.append((cx * (1 + splay * t * 1.6) + 0.16 * math.cos(tw), t * 1.35, cz * (1 + splay * t * 1.6) + 0.16 * math.sin(tw)))
            col = PAIR_COLORS[p] if k == 0 else "wire_white"
            parts.append(("wires", col, sweep(pts, 0.14, 8)))
            tip = np.array(pts[-1])
            parts.append(("copper", "copper", cylinder(0.07, 0, 0.3, 6).move(*tip)))
    return parts


def model_cut_fiber():
    parts = [cut_filler()]
    parts.append(("jacket_ring", "boot", lathe([(0.75, 0.0), (1.0, 0.0), (1.0, 0.0), (1.0, 0.18), (1.0, 0.18), (0.75, 0.18)], 20)))
    rng = np.random.default_rng(7)
    for i in range(14):
        a = rng.uniform(0, TAU)
        r = rng.uniform(0.25, 0.7)
        L = rng.uniform(0.6, 1.2)
        pts = [(r * math.cos(a) * (1 + 0.6 * t), t * L, r * math.sin(a) * (1 + 0.6 * t)) for t in np.linspace(0, 1, 6)]
        parts.append(("aramid", "aramid", sweep(pts, 0.05, 5)))
    parts.append(("buffer", "white_plastic", cylinder(0.22, 0, 0.8, 12)))
    parts.append(("core", "fiber_light", cylinder(0.1, 0.7, 1.6, 10)))
    return parts


def model_cut_copper():
    parts = [cut_filler()]
    parts.append(("jacket_ring", "boot", lathe([(0.82, 0.0), (1.0, 0.0), (1.0, 0.0), (1.0, 0.18), (1.0, 0.18), (0.82, 0.18)], 20)))
    parts.append(("insulation", "white_plastic", cylinder(0.72, 0, 0.35, 16)))
    rng = np.random.default_rng(3)
    for i in range(19):
        a = rng.uniform(0, TAU)
        r = math.sqrt(rng.uniform(0, 1)) * 0.55
        L = rng.uniform(0.7, 1.15)
        pts = [(r * math.cos(a) * (1 + 0.5 * t) + 0.05 * math.sin(t * 6 + i), 0.3 + t * L, r * math.sin(a) * (1 + 0.5 * t)) for t in np.linspace(0, 1, 6)]
        parts.append(("copper", "copper", sweep(pts, 0.075, 6)))
    return parts


MODELS = {
    "rj45": model_rj45,
    "fiber_sc": model_fiber,
    "terminal_fork": model_terminal,
    "coax_f": model_coax,
    "hv_end": model_hv_end,
    "firewall": model_firewall,
    "packet": model_packet,
    "cut_lan": model_cut_lan,
    "cut_fiber": model_cut_fiber,
    "cut_copper": model_cut_copper,
}

if __name__ == "__main__":
    print("Building models ->", OUT)
    for name, fn in MODELS.items():
        write_glb(OUT / f"{name}.glb", fn())
