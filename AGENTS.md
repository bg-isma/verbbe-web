# Web (`web/`)

verbbe.com. HTML estático en GitHub Pages (`bg-isma/verbbe-web`). `CNAME` → verbbe.com.

## Estructura

- `/es/` y `/en/` — sitios por idioma (rutas limpias, p.ej. `/es/privacy/`)
- `_src/` — HTML bilingüe fuente; regenerar con `python3 scripts/build_locale_site.py`
- Stubs en root (`index.html`, `privacy.html`, …) redirigen al locale
- `assets/` CSS/JS/imagenes · `fonts/` Montserrat + IBM Plex Mono (woff2)
- `install.sh` y `cli/verbbe.mjs` (copia publicada del CLI)
- `artists.json` publicado (fuente: `../shared/artists/artists.json`)

## Reglas

- No hay bundler. Edita HTML/CSS/JS directo o regenera locales desde `_src/`.
- No confundir con `../server/web/` (panel admin).
- `artists.json`: edita la fuente en `shared/` y regenera; no forks el JSON a mano aquí salvo un hotfix de Pages.
- CLI público: la fuente es `../server/cli/`. Esta carpeta solo publica la copia.
- Mantén `CNAME` y `.nojekyll`.
- Tras cambiar `_src/` o meta SEO: `python3 scripts/build_locale_site.py` (requiere BeautifulSoup).
