#!/usr/bin/env python3
"""Build /es and /en locale trees + root redirect stubs from bilingual HTML sources."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "_src"
TODAY = date.today().isoformat()
SITE = "https://verbbe.com"

META = {
    "home": {
        "es": {
            "title": "Verbbe — Tu música, en tu casa",
            "description": "Reproductor iOS para los archivos que ya tienes. En el iPhone, en CarPlay, o desde un servidor que arrancas tú. Sin catálogo ajeno.",
            "og_description": "Reproduce los archivos de tu iPhone. Si quieres, también la carpeta del ordenador.",
        },
        "en": {
            "title": "Verbbe — Your music, at home",
            "description": "iOS player for the audio files you already have. On iPhone, in CarPlay, or from a server you run. No third-party catalog.",
            "og_description": "Play the files on your iPhone. Optionally stream the folder on your computer.",
        },
    },
    "artists": {
        "es": {
            "title": "Verbbe — Apoyar artistas",
            "description": "Lista pública de artistas. La app cruza el nombre de tus archivos con tiendas y webs oficiales. Si eres independiente, envía tu nombre y un enlace.",
            "og_description": "La app detecta el nombre del artista en tus archivos y muestra su tienda o web. Envía un enlace si falta el tuyo.",
        },
        "en": {
            "title": "Verbbe — Support artists",
            "description": "Public artist list. The app matches names from your files to official stores and sites. Independents can submit a name and link.",
            "og_description": "The app detects the artist name in your files and shows their store or site. Submit a link if yours is missing.",
        },
    },
    "privacy": {
        "es": {
            "title": "Verbbe — Política de privacidad",
            "description": "Política de privacidad de Verbbe: datos que se tratan, uso, conservación y cómo borrarlos.",
            "og_description": "Qué datos trata Verbbe, cómo se usan y cómo puedes borrarlos.",
        },
        "en": {
            "title": "Verbbe — Privacy Policy",
            "description": "Verbbe Privacy Policy: data collection, use, retention, and deletion.",
            "og_description": "What data Verbbe processes, how it is used, and how you can delete it.",
        },
    },
    "legal": {
        "es": {
            "title": "Verbbe — Aviso legal",
            "description": "Aviso legal de Verbbe: responsable, condiciones de uso del sitio y propiedad intelectual.",
            "og_description": "Aviso legal del sitio y de la app Verbbe.",
        },
        "en": {
            "title": "Verbbe — Legal Notice",
            "description": "Legal notice for Verbbe: responsible party, site terms, and intellectual property.",
            "og_description": "Legal notice for the Verbbe site and app.",
        },
    },
    "terms": {
        "es": {
            "title": "Verbbe — Términos y condiciones",
            "description": "Términos y condiciones de uso de Verbbe, la app y el servidor self-hosted.",
            "og_description": "Términos de uso de Verbbe.",
        },
        "en": {
            "title": "Verbbe — Terms and Conditions",
            "description": "Terms and conditions for using Verbbe, the app, and the self-hosted server.",
            "og_description": "Terms of use for Verbbe.",
        },
    },
}

# slug -> (source file relative to ROOT, path under locale, page key)
PAGES = [
    ("index.html", "", "home"),
    ("artists.html", "artists", "artists"),
    ("privacy.html", "privacy", "privacy"),
    ("legal.html", "legal", "legal"),
    ("terms.html", "terms", "terms"),
]


def locale_path(lang: str, slug: str) -> str:
    if slug:
        return f"/{lang}/{slug}/"
    return f"/{lang}/"


def has_lang_class(tag: Tag, lang: str) -> bool:
    classes = tag.get("class") or []
    return f"lang-{lang}" in classes


def strip_lang(soup: BeautifulSoup, keep: str) -> None:
    drop = "en" if keep == "es" else "es"
    # Remove opposite-language nodes (collect first — decompose mutates the tree)
    for tag in list(soup.select(f".lang-{drop}")):
        if tag.parent is not None:
            tag.decompose()
    # Strip keep-language class; unwrap empty-attr span/div wrappers
    for tag in list(soup.select(f".lang-{keep}")):
        if tag.parent is None:
            continue
        classes = [c for c in (tag.get("class") or []) if c != f"lang-{keep}"]
        if classes:
            tag["class"] = classes
        elif "class" in tag.attrs:
            del tag["class"]
        if tag.name in {"span", "div"} and not tag.attrs:
            tag.unwrap()

def rewrite_asset_srcs(soup: BeautifulSoup) -> None:
    for tag in soup.find_all(["img", "script", "link", "source"]):
        for attr in ("src", "href", "srcset"):
            val = tag.get(attr)
            if not val or val.startswith(("http://", "https://", "/", "#", "data:", "mailto:")):
                continue
            if val.startswith("assets/") or val.startswith("artists.json") or val.startswith("fonts/"):
                tag[attr] = "/" + val
            elif val.startswith("./assets/"):
                tag[attr] = val[1:]


def picture_for(src_png: str, width: int, height: int, **img_attrs) -> str:
    """Return HTML for picture/webp — applied via string replace after serialize for simplicity."""
    webp = src_png.replace(".png", ".webp")
    attrs = " ".join(f'{k}="{v}"' for k, v in img_attrs.items() if v is not None)
    return (
        f'<picture>'
        f'<source type="image/webp" srcset="{webp}" />'
        f'<img src="{src_png}" width="{width}" height="{height}" {attrs} />'
        f"</picture>"
    )


def upgrade_images(soup: BeautifulSoup, page_key: str) -> None:
    for img in soup.find_all("img"):
        src = img.get("src") or ""
        if "/assets/covers/" in src and src.endswith(".png"):
            webp = src.replace(".png", ".webp")
            loading = img.get("loading")
            fetchpriority = img.get("fetchpriority")
            # First cover keeps high priority; others lazy
            parent = img.parent
            picture = soup.new_tag("picture")
            source = soup.new_tag("source", type="image/webp", srcset=webp)
            picture.append(source)
            img["width"] = "800"
            img["height"] = "800"
            if not loading and fetchpriority != "high":
                img["loading"] = "lazy"
            img.replace_with(picture)
            picture.append(img)
        elif "/assets/device/" in src and src.endswith(".png"):
            webp = src.replace(".png", ".webp")
            picture = soup.new_tag("picture")
            source = soup.new_tag("source", type="image/webp", srcset=webp)
            picture.append(source)
            if img.get("data-stage-img") is not None or img.get("data-stage-next") is not None:
                pass
            elif not img.get("loading"):
                img["loading"] = "lazy"
            img.replace_with(picture)
            picture.append(img)

    # Fan covers: only first fetchpriority high; ensure lazy on rest
    if page_key == "home":
        covers = soup.select(".fan-card img")
        for i, img in enumerate(covers):
            if i == 0:
                img["fetchpriority"] = "high"
                if img.has_attr("loading"):
                    del img["loading"]
            else:
                img["loading"] = "lazy"
                if img.has_attr("fetchpriority"):
                    del img["fetchpriority"]


def rewrite_internal_links(soup: BeautifulSoup, lang: str) -> None:
    other = "en" if lang == "es" else "es"
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith(("http://", "https://", "mailto:", "tel:", "#")):
            # hash-only on home stays
            continue
        hash_part = ""
        path = href
        if "#" in href:
            path, hash_frag = href.split("#", 1)
            hash_part = "#" + hash_frag
        # strip query
        if "?" in path:
            path = path.split("?", 1)[0]

        mapping = {
            "": locale_path(lang, ""),
            "index.html": locale_path(lang, ""),
            "/": locale_path(lang, ""),
            "artists.html": locale_path(lang, "artists"),
            "privacy.html": locale_path(lang, "privacy"),
            "legal.html": locale_path(lang, "legal"),
            "terms.html": locale_path(lang, "terms"),
            "artists.json": "/artists.json",
        }
        if path in mapping:
            a["href"] = mapping[path] + (hash_part if hash_part else "")
        elif path.startswith("index.html"):
            a["href"] = locale_path(lang, "") + hash_part
        elif path.endswith(".html"):
            # leave other
            pass

    # Logo always home of locale
    for a in soup.select("a.yv-logo"):
        a["href"] = locale_path(lang, "")

    # Language switch: buttons -> links
    for btn in list(soup.select("[data-lang-btn]")):
        target = btn.get("data-lang-btn")
        if target not in ("es", "en"):
            continue
        # Find current page slug from a marker we'll set, or infer later
        link = soup.new_tag("a")
        link["href"] = "#"  # filled after we know slug
        link["data-lang-link"] = target
        link["hreflang"] = target
        classes = [c for c in (btn.get("class") or []) if c]
        if classes:
            link["class"] = classes
        if target == lang:
            link["aria-current"] = "true"
        link.string = btn.get_text(strip=True) or target.upper()
        btn.replace_with(link)


def fix_lang_links(soup: BeautifulSoup, lang: str, slug: str) -> None:
    for a in soup.select("a[data-lang-link]"):
        target = a["data-lang-link"]
        a["href"] = locale_path(target, slug)
        del a["data-lang-link"]
        # pressed state for styling if CSS used aria-pressed on buttons
        if target == lang:
            a["aria-pressed"] = "true"
        else:
            a["aria-pressed"] = "false"


def build_head(soup: BeautifulSoup, lang: str, slug: str, page_key: str) -> None:
    head = soup.head
    meta = META[page_key][lang]
    other = "en" if lang == "es" else "es"
    canon = SITE + locale_path(lang, slug)
    alt_es = SITE + locale_path("es", slug)
    alt_en = SITE + locale_path("en", slug)

    # Clear old head children we will rebuild selectively
    # Remove google fonts, old meta we'll replace
    for tag in list(head.children):
        if isinstance(tag, NavigableString) and not str(tag).strip():
            continue

    # Remove scripts that set data-lang from navigator
    for script in list(head.find_all("script")):
        text = script.string or ""
        if "verbbe.lang" in text or "application/ld+json" in (script.get("type") or ""):
            script.decompose()

    # Remove existing SEO tags to replace
    for sel in [
        "title",
        'meta[name="description"]',
        'link[rel="canonical"]',
        'link[rel="icon"]',
        'link[rel="apple-touch-icon"]',
        'link[rel="alternate"]',
        'meta[property^="og:"]',
        'meta[name^="twitter:"]',
        'link[href*="fonts.googleapis"]',
        'link[href*="fonts.gstatic"]',
        'link[rel="preconnect"]',
        'link[href="assets/style.css"]',
        'link[href="assets/site.css"]',
        'link[href="/assets/style.css"]',
        'link[href="/assets/site.css"]',
        'link[href="assets/fonts.css"]',
    ]:
        for t in head.select(sel):
            t.decompose()

    html = soup.find("html")
    html["lang"] = lang
    if html.has_attr("data-lang"):
        del html["data-lang"]

    # Ensure charset/viewport/theme exist
    def ensure_meta_charset():
        if not head.find("meta", attrs={"charset": True}):
            m = soup.new_tag("meta")
            m["charset"] = "utf-8"
            head.insert(0, m)

    ensure_meta_charset()

    def append_tag(tag):
        head.append(tag)

    title = soup.new_tag("title")
    title.string = meta["title"]
    append_tag(title)

    d = soup.new_tag("meta", attrs={"name": "description", "content": meta["description"]})
    append_tag(d)

    append_tag(soup.new_tag("link", rel="canonical", href=canon))
    append_tag(soup.new_tag("link", rel="icon", href="/favicon.svg", type="image/svg+xml"))
    append_tag(soup.new_tag("link", rel="apple-touch-icon", href="/assets/app-icon.png"))

    append_tag(soup.new_tag("link", rel="alternate", hreflang="es", href=alt_es))
    append_tag(soup.new_tag("link", rel="alternate", hreflang="en", href=alt_en))
    append_tag(soup.new_tag("link", rel="alternate", hreflang="x-default", href=alt_es))

    og = [
        ("og:type", "website"),
        ("og:site_name", "Verbbe"),
        ("og:url", canon),
        ("og:title", meta["title"]),
        ("og:description", meta["og_description"]),
        ("og:image", f"{SITE}/assets/og.png"),
        ("og:image:width", "1200"),
        ("og:image:height", "630"),
        ("og:image:alt", "Verbbe"),
        ("og:locale", "es_ES" if lang == "es" else "en_US"),
    ]
    for prop, content in og:
        append_tag(soup.new_tag("meta", attrs={"property": prop, "content": content}))
    append_tag(
        soup.new_tag(
            "meta",
            attrs={
                "property": "og:locale:alternate",
                "content": "en_US" if lang == "es" else "es_ES",
            },
        )
    )

    for name, content in [
        ("twitter:card", "summary_large_image"),
        ("twitter:title", meta["title"]),
        ("twitter:description", meta["og_description"]),
        ("twitter:image", f"{SITE}/assets/og.png"),
    ]:
        append_tag(soup.new_tag("meta", attrs={"name": name, "content": content}))

    append_tag(soup.new_tag("link", rel="stylesheet", href="/assets/fonts.css"))
    append_tag(soup.new_tag("link", rel="stylesheet", href="/assets/style.css"))
    append_tag(soup.new_tag("link", rel="stylesheet", href="/assets/site.css"))


def inject_home_jsonld(soup: BeautifulSoup, lang: str) -> None:
    meta = META["home"][lang]
    app_desc = meta["description"]
    faqs = []
    for details in soup.select("section#preguntas details"):
        summary = details.find("summary")
        panel = details.select_one(".ask-panel-inner p")
        if not summary or not panel:
            continue
        faqs.append(
            {
                "@type": "Question",
                "name": summary.get_text(" ", strip=True),
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": panel.get_text(" ", strip=True),
                },
            }
        )

    graph = [
        {
            "@type": "WebSite",
            "name": "Verbbe",
            "url": f"{SITE}/{lang}/",
            "inLanguage": lang,
        },
        {
            "@type": "SoftwareApplication",
            "name": "Verbbe",
            "url": f"{SITE}/{lang}/",
            "applicationCategory": "MusicApplication",
            "operatingSystem": "iOS",
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR"},
            "description": app_desc,
            "image": f"{SITE}/assets/og.png",
            "downloadUrl": "https://apps.apple.com/app/verbbe/id6803781873",
            "author": {"@type": "Organization", "name": "Verbbe", "url": SITE + "/"},
            "publisher": {"@type": "Organization", "name": "Verbbe", "url": SITE + "/"},
        },
    ]
    if faqs:
        graph.append({"@type": "FAQPage", "mainEntity": faqs})

    script = soup.new_tag("script", type="application/ld+json")
    script.string = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, indent=2)
    soup.head.append(script)


def inject_artists_static(soup: BeautifulSoup, lang: str) -> None:
    data_path = ROOT / "artists.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))
    artists = data.get("artists") or []
    grid = soup.select_one("#artist-grid")
    if not grid:
        return
    grid.clear()

    def https_url(raw: str | None) -> str | None:
        try:
            from urllib.parse import urlparse

            u = urlparse((raw or "").strip())
            if u.scheme != "https":
                return None
            return u.geturl()
        except Exception:
            return None

    items = []
    # Sort like the JS: with links first, then name
    def display_name(entry):
        names = entry.get("names") or []
        return names[0] if names else ""

    def live_links(entry):
        return [l for l in (entry.get("links") or []) if https_url(l.get("url"))]

    rows = sorted(
        artists,
        key=lambda e: (0 if live_links(e) else 1, display_name(e).lower()),
    )

    # Static SSR: first 12 for HTML; JS will re-render from fetch
    noscript_items = []
    for entry in rows[:12]:
        name = display_name(entry)
        if not name:
            continue
        links = live_links(entry)
        card = soup.new_tag("article")
        card["class"] = ["artist-card", "is-in"] + (["has-links"] if links else [])
        h3 = soup.new_tag("h3")
        h3.string = name
        card.append(h3)
        if links:
            chips = soup.new_tag("div")
            chips["class"] = ["artist-chips"]
            for link in links:
                url = https_url(link.get("url"))
                if not url:
                    continue
                a = soup.new_tag("a", href=url, rel="noopener noreferrer", target="_blank")
                a["class"] = ["artist-chip"]
                a.string = link.get("label") or ("Site" if lang == "en" else "Web")
                chips.append(a)
                noscript_items.append({"name": name, "url": url})
            card.append(chips)
        else:
            p = soup.new_tag("p")
            p["class"] = ["artist-none"]
            p.string = "No verified store yet" if lang == "en" else "Aún sin tienda verificada"
            card.append(p)
        grid.append(card)

    # ItemList JSON-LD for all with links
    list_elements = []
    pos = 1
    for entry in rows:
        name = display_name(entry)
        links = live_links(entry)
        if not name or not links:
            continue
        list_elements.append(
            {
                "@type": "ListItem",
                "position": pos,
                "name": name,
                "url": https_url(links[0].get("url")),
            }
        )
        pos += 1
        if pos > 100:
            break
    if list_elements:
        script = soup.new_tag("script", type="application/ld+json")
        script.string = json.dumps(
            {
                "@context": "https://schema.org",
                "@type": "ItemList",
                "name": "Verbbe artists" if lang == "en" else "Artistas Verbbe",
                "itemListElement": list_elements,
            },
            ensure_ascii=False,
            indent=2,
        )
        soup.head.append(script)

    # Fix fetch path in artists.js usage - script tag stays; update inline if needed
    # artists.js fetches "artists.json" relatively — from /es/artists/ that breaks.
    # We'll patch artists.js separately to use /artists.json


def wrap_main_docs(soup: BeautifulSoup, page_key: str) -> None:
    if page_key not in {"privacy", "legal", "terms"}:
        return
    wrap = soup.select_one(".doc-wrap")
    if not wrap or wrap.name == "main":
        return
    wrap.name = "main"
    if not wrap.get("id"):
        wrap["id"] = "doc"


def fix_legal_internal_urls(soup: BeautifulSoup, lang: str) -> None:
    for a in soup.find_all("a", href=True):
        if a["href"] == "https://verbbe.com/privacy.html":
            a["href"] = f"{SITE}/{lang}/privacy/"
        if a["href"] == "https://verbbe.com/":
            a["href"] = f"{SITE}/{lang}/"


def fix_script_srcs(soup: BeautifulSoup) -> None:
    for script in soup.find_all("script", src=True):
        src = script["src"]
        if src.startswith("assets/"):
            script["src"] = "/" + src
        elif src.startswith("./assets/"):
            script["src"] = src[1:]


def process_page(source_name: str, slug: str, page_key: str, lang: str) -> str:
    raw = (SRC / source_name).read_text(encoding="utf-8")
    soup = BeautifulSoup(raw, "lxml")
    strip_lang(soup, lang)
    rewrite_asset_srcs(soup)
    rewrite_internal_links(soup, lang)
    fix_lang_links(soup, lang, slug)
    build_head(soup, lang, slug, page_key)
    upgrade_images(soup, page_key)
    wrap_main_docs(soup, page_key)
    fix_legal_internal_urls(soup, lang)
    fix_script_srcs(soup)

    # Device image alts
    for img in soup.find_all("img"):
        if lang == "en" and img.get("data-alt-en"):
            img["alt"] = img["data-alt-en"]
        elif lang == "es" and img.get("data-alt-es"):
            img["alt"] = img["data-alt-es"]

    # Search placeholder
    search = soup.select_one("#artist-search")
    if search is not None:
        if lang == "en":
            search["placeholder"] = search.get("data-placeholder-en") or "Search artist"
        else:
            search["placeholder"] = search.get("data-placeholder-es") or "Buscar artista"

    if page_key == "home":
        inject_home_jsonld(soup, lang)
    if page_key == "artists":
        inject_artists_static(soup, lang)

    # Footer legal links on artists
    if page_key == "artists":
        foot = soup.select_one("footer.site-foot p.footer")
        if foot:
            foot.clear()
            if lang == "es":
                foot.append("Lista en ")
                a1 = soup.new_tag("a", href="/artists.json")
                a1.string = "artists.json"
                foot.append(a1)
                foot.append(" · ")
                for label, s in [("Privacidad", "privacy"), ("Aviso legal", "legal"), ("Términos", "terms")]:
                    a = soup.new_tag("a", href=locale_path(lang, s))
                    a.string = label
                    foot.append(a)
                    if s != "terms":
                        foot.append(" · ")
            else:
                foot.append("List at ")
                a1 = soup.new_tag("a", href="/artists.json")
                a1.string = "artists.json"
                foot.append(a1)
                foot.append(" · ")
                for label, s in [("Privacy", "privacy"), ("Legal notice", "legal"), ("Terms", "terms")]:
                    a = soup.new_tag("a", href=locale_path(lang, s))
                    a.string = label
                    foot.append(a)
                    if s != "terms":
                        foot.append(" · ")

    # Pretty output as HTML5
    html = str(soup)
    # lxml may add html/body — ensure doctype
    if not html.startswith("<!DOCTYPE"):
        html = "<!DOCTYPE html>\n" + html
    return html


def write_redirect_stub(path: Path, target_js_expr: str, default_path: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    html = f"""<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0;url={default_path}" />
    <link rel="canonical" href="{SITE}{default_path}" />
    <title>Redirecting…</title>
    <script>
      (function () {{
        var key = "verbbe.lang";
        var q = new URLSearchParams(location.search).get("lang");
        var s = null;
        try {{ s = localStorage.getItem(key); }} catch (e) {{}}
        var n = (navigator.language || "").toLowerCase().indexOf("es") === 0 ? "es" : "en";
        var lang = q === "es" || q === "en" ? q : s === "es" || s === "en" ? s : "es";
        var dest = {target_js_expr};
        location.replace(dest + location.hash);
      }})();
    </script>
  </head>
  <body>
    <p><a href="{default_path}">Continue</a></p>
  </body>
</html>
"""
    path.write_text(html, encoding="utf-8")


def write_sitemap() -> None:
    urls = []
    for lang in ("es", "en"):
        for _, slug, _ in PAGES:
            path = locale_path(lang, slug)
            alt_es = locale_path("es", slug)
            alt_en = locale_path("en", slug)
            urls.append(
                f"""  <url>
    <loc>{SITE}{path}</loc>
    <lastmod>{TODAY}</lastmod>
    <xhtml:link rel="alternate" hreflang="es" href="{SITE}{alt_es}" />
    <xhtml:link rel="alternate" hreflang="en" href="{SITE}{alt_en}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="{SITE}{alt_es}" />
  </url>"""
            )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n'
        '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )
    (ROOT / "sitemap.xml").write_text(xml, encoding="utf-8")


def write_robots() -> None:
    text = """# Search engines and App Store review.
User-agent: Googlebot
Allow: /

User-agent: Googlebot-Image
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Applebot
Allow: /

User-agent: DuckDuckBot
Allow: /

# AI / training crawlers. Scanners ignore this file; block those in Cloudflare.
User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: Google-CloudVertexBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Claude-Web
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: Amazonbot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: meta-externalagent
Disallow: /

User-agent: FacebookBot
Disallow: /

User-agent: cohere-ai
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: *
Allow: /

Sitemap: https://verbbe.com/sitemap.xml
"""
    (ROOT / "robots.txt").write_text(text, encoding="utf-8")


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"Missing bilingual sources at {SRC} (copy originals into _src/)")

    # Build all locale pages first (never read root stubs as sources)
    for lang in ("es", "en"):
        for source, slug, key in PAGES:
            html = process_page(source, slug, key, lang)
            out_dir = ROOT / lang / slug if slug else ROOT / lang
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / "index.html"
            out_path.write_text(html, encoding="utf-8")
            print("wrote", out_path.relative_to(ROOT))

    # Root chooser + legacy .html stubs (after locale pages exist)
    (ROOT / "index.html").write_text(
        """<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0;url=/es/" />
    <link rel="canonical" href="https://verbbe.com/es/" />
    <title>Verbbe</title>
    <script>
      (function () {
        var key = "verbbe.lang";
        var q = new URLSearchParams(location.search).get("lang");
        var s = null;
        try { s = localStorage.getItem(key); } catch (e) {}
        var lang = q === "es" || q === "en" ? q : s === "es" || s === "en" ? s : "es";
        var base = lang === "en" ? "/en/" : "/es/";
        location.replace(base + location.hash);
      })();
    </script>
  </head>
  <body>
    <p><a href="/es/">Verbbe</a></p>
  </body>
</html>
""",
        encoding="utf-8",
    )

    stubs = {
        "artists.html": ("artists", "/es/artists/"),
        "privacy.html": ("privacy", "/es/privacy/"),
        "legal.html": ("legal", "/es/legal/"),
        "terms.html": ("terms", "/es/terms/"),
    }
    for filename, (slug, default) in stubs.items():
        (ROOT / filename).write_text(
            f"""<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0;url={default}" />
    <link rel="canonical" href="{SITE}{default}" />
    <title>Redirecting…</title>
    <script>
      (function () {{
        var key = "verbbe.lang";
        var q = new URLSearchParams(location.search).get("lang");
        var s = null;
        try {{ s = localStorage.getItem(key); }} catch (e) {{}}
        var lang = q === "es" || q === "en" ? q : s === "es" || s === "en" ? s : "es";
        location.replace("/" + lang + "/{slug}/" + location.hash);
      }})();
    </script>
  </head>
  <body>
    <p><a href="{default}">Continue</a></p>
  </body>
</html>
""",
            encoding="utf-8",
        )
        print("stub", filename)

    write_sitemap()
    write_robots()
    print("sitemap + robots updated")


if __name__ == "__main__":
    main()
