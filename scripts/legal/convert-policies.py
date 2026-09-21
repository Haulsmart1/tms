"""Convert the public policy PDFs in docs/TMS POLICIES/ into lib/legal/content/*.json.

Run by hand, never by npm, from the repo root:

    pip install pymupdf
    python scripts/legal/convert-policies.py

The legal text is copied VERBATIM. Structure comes from the PDF itself: 13.5pt
bold is a section heading, a Helvetica bullet glyph starts a list item, bold
spans stay bold, and tables come from PyMuPDF table detection. Nothing is
reworded here, and nothing should be: a change to the wording belongs in the
source document, then re-run this.

Only the documents in PUBLIC are converted. 00 (the publication checklist) and
11 to 14 are internal and must not be published; see
docs/superpowers/specs/2026-09-21-policy-pages-design.md.

PATCHES repairs the few places where a narrow table column in the PDF split a
word across lines. Each patch must match exactly once or the script stops, so a
revised PDF cannot be silently mis-patched.

Every judgement call the converter makes (a paragraph joined across a page
break, a table continued on the next page, a hyphen at a line end) is printed,
so the run can be checked against the PDFs.
"""
import pymupdf, sys, json, re, os
sys.stdout.reconfigure(encoding="utf-8")
LOG = []

SOURCE_DIR = os.path.join("docs", "TMS POLICIES")
OUT_DIR = os.path.join("lib", "legal", "content")

PUBLIC = {
    "01-Terms-and-Conditions.pdf": "terms",
    "02-Privacy-Notice.pdf": "privacy",
    "03-Cookie-Notice.pdf": "cookies",
    "04-Cancellation-and-Refund-Policy.pdf": "cancellation-policy",
    "05-Data-Processing-Agreement.pdf": "dpa",
    "06-Accessibility-Statement.pdf": "accessibility",
    "07-Service-Level-and-Support-Policy.pdf": "support-policy",
    "08-Acceptable-Use-Policy.pdf": "acceptable-use",
    "09-Sub-processor-List.pdf": "sub-processors",
    "10-Security-Overview.pdf": "security",
}

PATCHES = {
    "02-Privacy-Notice.pdf": [
        ("Support corres pondence", "Support correspondence"),
    ],
    "03-Cookie-Notice.pdf": [
        ("xero oauth state _ _", "xero_oauth_state"),
        ("xero oauth tenant _ _", "xero_oauth_tenant"),
        ("tms:quotation-draft:[depot ]", "tms:quotation-draft:[depot]"),
        ("tms:planning-draft:[depot] :[date]", "tms:planning-draft:[depot]:[date]"),
        ("tms:quotation-viewed:[ref erence]", "tms:quotation-viewed:[reference]"),
    ],
}

def norm(t): return re.sub(r"\s+", " ", t)

def merge_runs(runs):
    out = []
    for r in runs:
        if not r["text"]: continue
        if out and out[-1].get("bold", False) == r.get("bold", False):
            out[-1]["text"] += r["text"]
        else:
            out.append(dict(r))
    for r in out: r["text"] = norm(r["text"])
    if out:
        out[0]["text"] = out[0]["text"].lstrip(); out[-1]["text"] = out[-1]["text"].rstrip()
    clean = []
    for r in out:
        if not r["text"]: continue
        d = {"text": r["text"]}
        if r.get("bold"): d["bold"] = True
        clean.append(d)
    return clean

def append_line(runs, line_spans, name):
    """Append a visual line's spans to a run list, adding the wrap space."""
    if runs:
        last = runs[-1]["text"]
        if last.rstrip().endswith("-") and not last.rstrip().endswith(" -"):
            LOG.append(f"[{name}] hyphen wrap: ...{last[-30:]!r} + {line_spans[0]['text'][:20]!r}")
            runs[-1]["text"] = last.rstrip()
        else:
            runs.append({"text": " ", "bold": runs[-1].get("bold", False)})
    for s in line_spans:
        runs.append({"text": s["text"], "bold": "Bold" in s["font"]})

def convert(path):
    name = os.path.basename(path)
    doc = pymupdf.open(path)
    items = []  # flow items in reading order
    for pno, page in enumerate(doc):
        tables = page.find_tables().tables
        tb = [pymupdf.Rect(t.bbox) for t in tables]
        page_items = []
        for t in tables:
            rows = [[norm((c or "").replace("\n", " ")).strip() for c in row] for row in t.extract()]
            # header = first row if its first cell text is bold
            first_cell = pymupdf.Rect(t.rows[0].cells[0]) if t.rows[0].cells[0] else None
            bold_head = False
            if first_cell:
                for b in page.get_text("dict", clip=first_cell)["blocks"]:
                    for l in b.get("lines", []):
                        for s in l["spans"]:
                            if s["text"].strip(): bold_head = bold_head or "Bold" in s["font"]
            page_items.append({"kind": "table", "y": t.bbox[1], "rows": rows, "bold_head": bold_head, "page": pno})
        # group spans into visual lines by baseline
        lines = {}
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    if not s["text"].strip() and not s["text"]: continue
                    r = pymupdf.Rect(s["bbox"])
                    if round(s["size"], 1) == 8.5 and r.y0 > 780: continue  # footer
                    c = pymupdf.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
                    if any(c in t for t in tb): continue
                    key = round(s["origin"][1])
                    k = next((k for k in lines if abs(k - key) <= 2), key)
                    lines.setdefault(k, []).append(s)
        for k in sorted(lines):
            spans = sorted(lines[k], key=lambda s: s["bbox"][0])
            page_items.append({"kind": "line", "y": k, "spans": spans, "page": pno,
                               "x0": spans[0]["bbox"][0], "x1": spans[-1]["bbox"][2]})
        page_items.sort(key=lambda i: i["y"])
        items += page_items

    out = {"source": name, "title": None, "company": [], "intro": [], "sections": []}
    blocks = out["intro"]
    cur = None        # current open block (p or ul)
    prev = None       # previous line item
    mode = "start"
    for it in items:
        if it["kind"] == "table":
            head = it["rows"][0] if it["bold_head"] else None
            body = it["rows"][1:] if it["bold_head"] else it["rows"]
            last = blocks[-1] if blocks else None
            if last and last["kind"] == "table" and prev is None and (head is None or head == last["head"]):
                LOG.append(f"[{name}] merged table continuation on page {it['page']+1} ({len(body)} rows)")
                last["rows"] += body
            else:
                blocks.append({"kind": "table", "head": head, "rows": body})
            cur = None; prev = None
            continue
        spans = it["spans"]; s0 = spans[0]; size = round(s0["size"], 1)
        text = norm("".join(s["text"] for s in spans)).strip()
        if not text: continue
        if size == 20.0: out["title"] = text; continue
        if size == 13.0: continue                       # product name under the title
        if size == 10.5:
            if "Bold" not in s0["font"]: out["company"].append(text)
            continue
        if size == 13.5:
            sec = {"heading": text, "blocks": []}
            out["sections"].append(sec); blocks = sec["blocks"]; cur = None; prev = it
            continue
        is_bullet = s0["font"] == "Helvetica"
        new_page = prev is not None and prev["kind"] == "line" and it["page"] != prev["page"]
        gap = (it["y"] - prev["y"]) if (prev is not None and not new_page) else None
        if is_bullet:
            body = spans[1:]
            if not (cur and cur["kind"] == "ul"):
                cur = {"kind": "ul", "items": []}; blocks.append(cur)
            cur["items"].append([]); append_line(cur["items"][-1], body, name)
        elif cur and cur["kind"] == "ul" and it["x0"] > 75:
            append_line(cur["items"][-1], spans, name)
            if new_page: LOG.append(f"[{name}] bullet continues across page {it['page']}: {text[:50]!r}")
        else:
            cont = False
            if cur and cur["kind"] == "p" and prev is not None:
                if new_page:
                    numbered = re.match(r"^\d+(\.\d+)*\.?\s", text)
                    cont = (not numbered) and prev["x1"] > 470 and "Bold" not in s0["font"]
                    LOG.append(f"[{name}] page break p{it['page']}->{it['page']+1}: {'JOIN' if cont else 'new para'}: prev.x1={prev['x1']:.0f} next={text[:50]!r}")
                else:
                    cont = gap is not None and gap < 17.5
            if not cont:
                cur = {"kind": "p", "runs": []}; blocks.append(cur)
            append_line(cur["runs"], spans, name)
        prev = it
    # finalise runs
    def fin(bl):
        for b in bl:
            if b["kind"] == "p": b["runs"] = merge_runs(b["runs"])
            if b["kind"] == "ul": b["items"] = [merge_runs(i) for i in b["items"]]
    fin(out["intro"])
    for s in out["sections"]: fin(s["blocks"])
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for pdf, slug in PUBLIC.items():
        d = convert(os.path.join(SOURCE_DIR, pdf))
        # Lift the "Version 1.0. Effective September 2026." line out of the intro.
        version = [b for b in d["intro"] if b["kind"] == "p" and re.match(r"^Version \d", b["runs"][0]["text"])]
        if len(version) != 1:
            sys.exit(f"{pdf}: expected exactly one version line, found {len(version)}")
        d["intro"].remove(version[0])
        d["versionLine"] = "".join(r["text"] for r in version[0]["runs"])
        d["slug"] = slug
        text = json.dumps(d, ensure_ascii=False, indent=2)
        for old, new in PATCHES.get(pdf, []):
            old_j, new_j = json.dumps(old, ensure_ascii=False)[1:-1], json.dumps(new, ensure_ascii=False)[1:-1]
            if text.count(old_j) != 1:
                sys.exit(f"{pdf}: patch {old!r} matched {text.count(old_j)} times, expected 1")
            text = text.replace(old_j, new_j)
        with open(os.path.join(OUT_DIR, slug + ".json"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text + "\n")
        print(f"wrote {slug}.json ({len(d['sections'])} sections)")
    print("\n".join(LOG))

main()
