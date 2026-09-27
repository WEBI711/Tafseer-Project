"""Tiny browse-only viewer for the tafseer DB. Run:

    ingestion/.venv/bin/python -m uvicorn app.viewer:app --reload --port 8000

then open http://localhost:8000
"""
from __future__ import annotations

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

load_dotenv(Path(__file__).parent.parent / "ingestion" / ".env")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://tafseer:tafseer@localhost:5433/tafseer")

app = FastAPI(title="Tafseer DB Viewer")


def q(sql: str, args: tuple = ()) -> list[dict]:
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            cols = [d.name for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]


PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><title>Tafseer DB</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, sans-serif; margin: 0; display: flex; height: 100vh; }
  aside { width: 230px; overflow-y: auto; border-right: 1px solid #8884; padding: 12px; }
  main { flex: 1; overflow-y: auto; padding: 24px 32px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  .item { display: block; width: 100%; text-align: left; border: 0; background: none;
          padding: 5px 8px; cursor: pointer; border-radius: 6px; font: inherit;
          color: inherit; }
  .item:hover { background: #8882; }
  .item.active { background: #06f3; font-weight: 600; }
  .num { color: #888; font-size: 12px; margin-right: 6px; }
  .ayah { margin: 24px 0; max-width: 720px; }
  .ayah .ar { font-size: 26px; text-align: right; direction: rtl; margin: 8px 0; }
  .ayah .tr { color: #888; }
  .ayah .no { color: #06f; font-size: 12px; }
  .commentary { border-left: 3px solid #06f6; padding: 6px 12px; margin: 10px 0;
                white-space: pre-wrap; }
  .stats { color: #888; font-size: 13px; margin-bottom: 8px; }
</style>
</head>
<body>
<aside><h1>Juz / Surah</h1><div id="nav"></div></aside>
<main><div id="content"><p class="stats">Loading…</p></div></main>
<script>
const $ = id => document.getElementById(id);
async function j(url) { return (await fetch(url)).json(); }

function ayahHTML(a) {
  return `<div class="ayah">
    <span class="no">Surah ${a.surah_number}:${a.number}</span>
    <div class="ar">${a.text_ar ?? ''}</div>
    ${a.translation ? `<div class="tr">${a.translation}</div>` : ''}
    ${(a.commentary||[]).map(c => `<div class="commentary">${c.content}</div>`).join('')}
  </div>`;
}

async function showSurah(n) {
  const d = await j(`/api/surah/${n}`);
  document.querySelectorAll('.item').forEach(e => e.classList.remove('active'));
  document.querySelector(`[data-surah="${n}"]`)?.classList.add('active');
  $('content').innerHTML = `<h1>${n}. ${d.name_en}</h1>` +
    `<p class="stats">${d.ayahs.length} ayahs · ${d.commentary_count} commentary blocks</p>` +
    (d.intro && d.intro[0] ? `<div class="commentary">${d.intro.join('\n\n')}</div>` : '') +
    d.ayahs.map(ayahHTML).join('');
  $('content').scrollTo(0, 0);
}

(async () => {
  const rows = await j('/api/index');
  let html = '';
  let juz = null;
  for (const r of rows) {
    if (r.juz !== juz) { juz = r.juz; html += `<p class="stats">Juz ${juz}</p>`; }
    html += `<button class="item" data-surah="${r.number}">
      <span class="num">${r.number}</span>${r.name_en}</button>`;
  }
  $('nav').innerHTML = html;
  document.querySelectorAll('.item').forEach(b =>
    b.onclick = () => showSurah(+b.dataset.surah));
  if (rows.length) showSurah(rows[0].number);
})();
</script>
</body></html>"""


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return PAGE


@app.get("/api/index")
def api_index() -> list[dict]:
    return q(
        """
        SELECT j.number AS juz, s.number, s.name_en
        FROM surah s JOIN juz j ON j.id = s.juz_id
        ORDER BY j.number, s.number
        """
    )


@app.get("/api/surah/{number}")
def api_surah(number: int) -> dict:
    surah = q("SELECT id, number, name_en, intro FROM surah WHERE number = %s", (number,))
    if not surah:
        return {"error": "not found"}
    s = surah[0]
    ayahs = q(
        """
        SELECT a.id, a.number, a.text_ar, a.translation,
               COALESCE(json_agg(json_build_object('content', c.content)
                                 ORDER BY c.ord) FILTER (WHERE c.id IS NOT NULL), '[]') AS commentary
        FROM ayah a
        LEFT JOIN commentary c ON c.ayah_id = a.id
        WHERE a.surah_id = %s
        GROUP BY a.id, a.number, a.text_ar, a.translation
        ORDER BY a.ord, a.number
        """,
        (s["id"],),
    )
    notes = q(
        "SELECT content FROM commentary WHERE surah_id = %s AND ayah_id IS NULL ORDER BY ord",
        (s["id"],),
    )
    intro = (s["intro"] or "").split("\n\n") if s["intro"] else []
    if notes:
        intro = intro + [n["content"] for n in notes]
    return {
        "number": s["number"],
        "name_en": s["name_en"],
        "intro": intro,
        "commentary_count": sum(len(a["commentary"]) for a in ayahs),
        "ayahs": ayahs,
    }