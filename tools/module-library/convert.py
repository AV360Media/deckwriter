"""Convert harness output (Companion module definitions) into Deckwright's compact library format."""
import json, sys

MODS = ["bmd-atem", "studiocoast-vmix", "resolume-arena", "zinc-oscpoint", "imimot-mitti"]
MAX_CHOICES = 400


def uw(v):
    """Unwrap Companion 5 {value, isExpression} wrappers."""
    if isinstance(v, dict) and "isExpression" in v and "value" in v:
        return v["value"]
    return v


def uw_opts(o):
    return {k: uw(v) for k, v in (o or {}).items()}


def hexc(n):
    try:
        return "#%06x" % (int(n) & 0xFFFFFF)
    except (TypeError, ValueError):
        return None


def conv_option(o):
    t = o.get("type")
    if t in ("static-text",) or not o.get("id"):
        return None
    out = {"id": o["id"], "l": o.get("label") or o["id"], "t": t}
    if "default" in o and o["default"] is not None:
        out["d"] = o["default"]
    if o.get("choices"):
        out["c"] = [[c.get("id"), str(c.get("label", c.get("id")))] for c in o["choices"][:MAX_CHOICES] if isinstance(c, dict)]
    for k_src, k_dst in (("min", "min"), ("max", "max"), ("step", "step")):
        if o.get(k_src) is not None:
            out[k_dst] = o[k_src]
    if o.get("allowCustom"):
        out["custom"] = 1
    if o.get("multiple") or t == "multidropdown":
        out["multi"] = 1
    tip = o.get("tooltip") or o.get("description")
    if tip:
        out["tip"] = str(tip)[:200]
    return out


def conv_defs(defs, kind):
    items = defs.items() if isinstance(defs, dict) else ((d.get("id"), d) for d in (defs or []))
    out = []
    for did, d in items:
        if not did or not isinstance(d, dict):
            continue
        e = {"id": did, "n": d.get("name") or d.get("label") or did}
        desc = d.get("description")
        if desc:
            e["desc"] = str(desc)[:240]
        opts = [x for x in (conv_option(o) for o in d.get("options") or []) if x]
        if opts:
            e["o"] = opts
        if kind == "fb":
            ft = d.get("type") or d.get("feedbackType")
            if ft and ft not in ("feedback",):
                e["ft"] = ft
            ds = d.get("defaultStyle") or {}
            st = {}
            if ds.get("bgcolor") is not None:
                st["bg"] = hexc(ds["bgcolor"])
            if ds.get("color") is not None:
                st["fg"] = hexc(ds["color"])
            if st:
                e["ds"] = st
        out.append(e)
    out.sort(key=lambda e: e["n"].lower())
    return out


def conv_action_list(lst):
    res = []
    for a in lst or []:
        if not isinstance(a, dict):
            continue
        aid = a.get("actionId") or a.get("definitionId") or a.get("action")
        if not aid:
            continue
        res.append({"a": aid, "o": uw_opts(a.get("options"))} if not a.get("delay") else {"a": aid, "o": uw_opts(a.get("options")), "delay": a.get("delay")})
    return res


def conv_steps_v1(steps):
    if isinstance(steps, dict):
        steps = [steps[k] for k in sorted(steps, key=lambda x: int(x))]
    out = []
    for s in steps or []:
        sets = s.get("action_sets", s) if isinstance(s, dict) else {}
        out.append({
            "down": conv_action_list(sets.get("down")),
            "up": conv_action_list(sets.get("up")),
            "rotL": conv_action_list(sets.get("rotate_left")),
            "rotR": conv_action_list(sets.get("rotate_right")),
        })
    return out or [{"down": [], "up": [], "rotL": [], "rotR": []}]


def conv_fb_v1(fbs):
    out = []
    for f in fbs or []:
        fid = f.get("feedbackId") or f.get("type")
        if not fid:
            continue
        st = {}
        s = f.get("style") or {}
        if s.get("bgcolor") is not None:
            st["bg"] = hexc(s["bgcolor"])
        if s.get("color") is not None:
            st["fg"] = hexc(s["color"])
        e = {"f": fid, "o": uw_opts(f.get("options"))}
        if st:
            e["s"] = st
        if f.get("isInverted"):
            e["inv"] = 1
        out.append(e)
    return out


def conv_presets_v1(presets):
    out = []
    items = presets.values() if isinstance(presets, dict) else presets
    for p in items or []:
        if not isinstance(p, dict) or p.get("type") != "button":
            continue
        s = p.get("style") or {}
        e = {
            "cat": p.get("category") or "Other",
            "n": p.get("name") or s.get("text") or "",
            "tx": s.get("text", ""),
            "sz": str(s.get("size", "auto")),
            "fg": hexc(s.get("color", 0xFFFFFF)),
            "bg": hexc(s.get("bgcolor", 0)),
            "st": conv_steps_v1(p.get("steps")),
            "fb": conv_fb_v1(p.get("feedbacks")),
        }
        if s.get("png64"):
            e["png"] = s["png64"]
        if s.get("alignment"):
            e["al"] = s["alignment"]
        if (p.get("options") or {}).get("rotaryActions"):
            e["rot"] = 1
        out.append(e)
    return out


import re
SIZES = [7, 14, 18, 24, 30, 44]
LOCAL = re.compile(r"\$\(local:([A-Za-z0-9_]+)\)")


def subst(v, vars):
    """Replace Companion 5 local-variable placeholders with concrete values."""
    if isinstance(v, str):
        m = LOCAL.fullmatch(v.strip())
        if m and m.group(1) in vars:
            return vars[m.group(1)]
        return LOCAL.sub(lambda mm: str(vars.get(mm.group(1), mm.group(0))), v)
    if isinstance(v, dict):
        return {k: subst(x, vars) for k, x in v.items()}
    if isinstance(v, list):
        return [subst(x, vars) for x in v]
    return v


def v2_size(fs):
    if fs in (None, "", "auto"):
        return "auto"
    try:
        pt = float(fs) / 2.1
    except (TypeError, ValueError):
        return "auto"
    return str(min(SIZES, key=lambda x: abs(x - pt)))


def build_v2(p, cat, label, vars):
    m = (p or {}).get("model") or {}
    if p.get("type") != "button" or not m:
        return None
    defaults = {}
    for lv in m.get("localVariables") or []:
        if lv.get("variableName"):
            defaults[lv["variableName"]] = uw((lv.get("options") or {}).get("startup_value"))
    vars = {**defaults, **vars}
    text, size, fg, bg, png = "", "auto", "#ffffff", "#000000", None
    for layer in (m.get("style") or {}).get("layers") or []:
        lt = layer.get("type")
        if lt == "text" and not text:
            text = str(subst(uw(layer.get("text")), vars) or "")
            size = v2_size(uw(layer.get("fontsize")))
            c = hexc(uw(layer.get("color")))
            if c:
                fg = c
        elif lt == "box" and bg == "#000000":
            c = hexc(uw(layer.get("color")))
            if c:
                bg = c
        elif lt == "image" and not png:
            v = uw(layer.get("base64Image") or layer.get("image"))
            if isinstance(v, str) and len(v) > 40:
                png = v
    steps = []
    st = m.get("steps") or {}
    for k in sorted(st, key=lambda x: int(x) if str(x).isdigit() else 0):
        sets = (st[k] or {}).get("action_sets") or {}
        steps.append({key: subst(conv_action_list(sets.get(src)), vars) for key, src in
                      (("down", "down"), ("up", "up"), ("rotL", "rotate_left"), ("rotR", "rotate_right"))})
    fbs = []
    for f in m.get("feedbacks") or []:
        fid = f.get("definitionId")
        if not fid or f.get("connectionId") == "internal":
            continue
        s = {}
        for ov in f.get("styleOverrides") or []:
            val = uw(ov.get("override"))
            if ov.get("elementProperty") != "color" or not isinstance(val, (int, float)):
                continue
            if str(ov.get("elementId", "")).startswith("box"):
                s["bg"] = hexc(val)
            elif str(ov.get("elementId", "")).startswith("text"):
                s["fg"] = hexc(val)
        e = {"f": fid, "o": subst(uw_opts(f.get("options")), vars)}
        if s:
            e["s"] = s
        if uw(f.get("isInverted")):
            e["inv"] = 1
        fbs.append(e)
    e = {"cat": cat, "n": (label or p.get("name") or text).replace("\n", " "), "tx": text, "sz": size, "fg": fg, "bg": bg,
         "st": steps or [{"down": [], "up": [], "rotL": [], "rotR": []}], "fb": fbs}
    if png:
        e["png"] = png
    if (m.get("options") or {}).get("rotaryActions"):
        e["rot"] = 1
    return e


def conv_presets_v2(presets, meta):
    presets = presets if isinstance(presets, dict) else {}
    out, used = [], set()
    ui = (meta or {}).get("uiPresets") or {}
    for sec in sorted(ui.values(), key=lambda x: x.get("order", 0)):
        for d in sorted((sec.get("definitions") or {}).values(), key=lambda x: x.get("order", 0)):
            name, dn = sec.get("name", ""), d.get("name")
            cat = name if not dn or dn == name else f"{name} · {dn}"
            if d.get("type") == "template":
                base_id = (d.get("definition") or {}).get("id")
                base = presets.get(base_id)
                if not base:
                    continue
                used.add(base_id)
                common = d.get("commonVariableValues") or {}
                for tv in d.get("templateValues") or []:
                    vars = dict(common)
                    vars[d.get("templateVariableName")] = tv.get("value")
                    e = build_v2(base, cat, tv.get("label"), vars)
                    if e:
                        out.append(e)
            else:
                for pv in sorted((d.get("presets") or {}).values(), key=lambda x: x.get("order", 0)):
                    p = presets.get(pv.get("id"))
                    if not p:
                        continue
                    used.add(pv.get("id"))
                    e = build_v2(p, cat, pv.get("label"), {})
                    if e:
                        out.append(e)
    for pid, p in presets.items():
        if pid not in used:
            e = build_v2(p, "Other", None, {})
            if e:
                out.append(e)
    return out


def main():
    lib = {}
    for mid in MODS:
        d = json.load(open(f"out-{mid}.json"))
        v2 = str(d.get("apiVersion", "")).startswith("2")
        presets = conv_presets_v2(d.get("presets"), d.get("presetMeta")) if v2 else conv_presets_v1(d.get("presets"))
        lib[mid] = {
            "v": d.get("version"),
            "actions": conv_defs(d.get("actions"), "act"),
            "feedbacks": conv_defs(d.get("feedbacks"), "fb"),
            "presets": presets,
            "config": [x for x in (conv_option(o) for o in d.get("configFields") or []) if x],
        }
        print(mid, d.get("version"), len(lib[mid]["actions"]), "actions", len(lib[mid]["feedbacks"]), "feedbacks", len(presets), "presets",
              len(lib[mid]["config"]), "config", len(json.dumps(lib[mid], separators=(",", ":"))) // 1024, "KB")
    s = json.dumps(lib, separators=(",", ":"), ensure_ascii=False)
    open("library.json", "w").write(s)
    print("total", len(s) // 1024, "KB")


main()
