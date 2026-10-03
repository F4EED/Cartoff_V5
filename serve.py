#!/usr/bin/env python3
"""Serveur statique avec HTTP Range (requis pour PMTiles) et API d'extraction.

Routes ajoutées, reprises de https://github.com/F4EED/pmtiles :

- ``GET /api/files`` — archives ``pmtiles/*.pmtiles``
- ``POST /api/extract`` — lance une extraction Protomaps (202 + id de job)
- ``GET /api/jobs/<id>`` — avancement
- ``GET /api/download/<nom>.pmtiles`` — téléchargement du résultat
- ``GET /pmtiles/overview.pmtiles`` — relais Range vers le build Protomaps
  (fond France utilisé pendant la sélection d'une zone)
"""

import argparse
import json
import os
import re
import socket
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import extract

SERVER_ID = "Cartoff/1.0 (PMTiles+Range)"


class PMTilesFriendlyHandler(SimpleHTTPRequestHandler):
    range_length = None
    server_version = "Cartoff"
    sys_version = "PMTiles+Range"

    def version_string(self):
        return SERVER_ID

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        path = self.path.split("?", 1)[0].lower()
        if path.endswith(".pmtiles"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def guess_type(self, path):
        if str(path).endswith(".pmtiles"):
            return "application/octet-stream"
        return super().guess_type(path)

    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_head(self):
        self.range_length = None
        path = self.translate_path(self.path.split("?", 1)[0])
        range_header = self.headers.get("Range")

        if not range_header or not os.path.isfile(path):
            return super().send_head()

        match = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header.strip())
        if not match:
            return super().send_head()

        try:
            file_obj = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(file_obj.fileno()).st_size
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else size - 1
        end = min(end, size - 1)

        if start > end or start >= size:
            self.send_error(416, "Requested Range Not Satisfiable")
            file_obj.close()
            return None

        file_obj.seek(start)
        length = end - start + 1
        self.range_length = length
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        return file_obj

    def _copy_bytes(self, source, length):
        remaining = length
        while remaining > 0:
            chunk = source.read(min(remaining, 64 * 1024))
            if not chunk:
                break
            self.wfile.write(chunk)
            remaining -= len(chunk)

    def _handle_api_get(self, path: str) -> bool:
        if path == "/api/files":
            self._send_json(200, {"files": extract.list_archives()})
            return True
        if path.startswith("/api/jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            job = extract.get_job(job_id)
            if not job:
                self._send_json(404, {"error": "Job introuvable."})
                return True
            self._send_json(200, job)
            return True
        if path.startswith("/api/download/"):
            filename = path.rsplit("/", 1)[-1]
            file_path = extract.download_path(filename)
            if not file_path:
                self._send_json(404, {"error": "Fichier introuvable."})
                return True
            self._send_file(file_path, download_name=file_path.name)
            return True
        if path.startswith("/api/"):
            self._send_json(404, {"error": "API inconnue."})
            return True
        return False

    def _proxy_overview(self) -> None:
        """Relaye une requête Range vers le build Protomaps mondial.

        Le CDN ne renvoie pas d'en-tête CORS : le navigateur ne peut pas le lire
        directement. Les requêtes PMTiles sont de petites plages d'octets.
        """
        try:
            url = extract.find_latest_build()
        except extract.ExtractError as exc:
            self._send_json(503, {"error": str(exc)})
            return
        range_header = self.headers.get("Range") or "bytes=0-16383"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Cartoff/1.0", "Range": range_header},
        )
        try:
            upstream = urllib.request.urlopen(req, timeout=45)
        except urllib.error.HTTPError as exc:
            if exc.code not in (200, 206):
                exc.close()
                self._send_json(502, {"error": "Fond d'aperçu indisponible."})
                return
            upstream = exc
        except OSError:
            self._send_json(502, {"error": "Fond d'aperçu indisponible."})
            return
        try:
            body = upstream.read()
            code = upstream.status
            self.send_response(code)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            content_range = upstream.headers.get("Content-Range")
            if content_range:
                self.send_header("Content-Range", content_range)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        finally:
            upstream.close()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/pmtiles/overview.pmtiles":
            self._proxy_overview()
            return
        if path.startswith("/api/download/"):
            filename = path.rsplit("/", 1)[-1]
            file_path = extract.download_path(filename)
            if not file_path:
                self._send_json(404, {"error": "Fichier introuvable."})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header(
                "Content-Disposition", f'attachment; filename="{file_path.name}"'
            )
            self.send_header("Content-Length", str(file_path.stat().st_size))
            self.end_headers()
            return
        if path.startswith("/api/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            return
        super().do_HEAD()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/pmtiles/overview.pmtiles":
            self._proxy_overview()
            return
        if self._handle_api_get(path):
            return
        f = self.send_head()
        if not f:
            return
        try:
            if self.range_length is not None:
                self._copy_bytes(f, self.range_length)
            else:
                self.copyfile(f, self.wfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            f.close()
            self.range_length = None

    def do_POST(self):
        parsed = urlparse(self.path)
        if unquote(parsed.path) != "/api/extract":
            self.send_error(404, "Not Found")
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 50_000:
            self._send_json(400, {"error": "Requête invalide."})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "JSON invalide."})
            return
        if not isinstance(payload, dict):
            self._send_json(400, {"error": "JSON invalide."})
            return
        try:
            job = extract.start_extract(payload)
        except extract.ExtractError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except (TypeError, ValueError):
            self._send_json(400, {"error": "Requête invalide."})
            return
        self._send_json(202, job)

    def _send_file(self, file_path: Path, download_name: str) -> None:
        try:
            file_obj = open(file_path, "rb")
        except OSError:
            self._send_json(404, {"error": "Fichier introuvable."})
            return
        size = file_path.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header(
            "Content-Disposition", f'attachment; filename="{download_name}"'
        )
        self.send_header("Content-Length", str(size))
        self.end_headers()
        try:
            self.copyfile(file_obj, self.wfile)
        finally:
            file_obj.close()


class ReuseThreadingServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def _port_in_use(port: int) -> bool:
    """True si un service écoute déjà sur ce port (fiable sous Windows)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def main():
    parser = argparse.ArgumentParser(
        description="Serveur Cartoff avec support HTTP Range (requis pour PMTiles)."
    )
    parser.add_argument("-p", "--port", type=int, default=8000)
    args = parser.parse_args()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    extract.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if _port_in_use(args.port):
        print(
            f"ERREUR : le port {args.port} est déjà utilisé.\n"
            f"  - Fermez les autres serveurs (python -m http.server, anciens serve.py...)\n"
            f"  - Sous Windows : double-cliquez start.bat (arrete le port puis relance)\n"
            f"  - Ou : netstat -ano | findstr :{args.port}",
            file=sys.stderr,
        )
        sys.exit(1)

    archives = extract.list_archives()
    if not archives:
        print(
            "AVERTISSEMENT : aucun fichier pmtiles/*.pmtiles — fond de carte gris.\n"
            "  - python scripts/unpack_large_file.py   (reconstitue loire.pmtiles)\n"
            "  - ou extrayez une zone depuis le panneau Fond de carte (réseau requis)",
            file=sys.stderr,
        )
    elif not any(item["name"] == "loire" for item in archives):
        print(
            "AVERTISSEMENT : pmtiles/loire.pmtiles introuvable.\n"
            "  Le menu chargera une autre archive. Les calques Loire restent ceux du 42.\n"
            "  - python scripts/unpack_large_file.py",
            file=sys.stderr,
        )

    server = ReuseThreadingServer(("", args.port), PMTilesFriendlyHandler)
    print(f"Cartoff: http://localhost:{args.port}/")
    print(f"  Server: {SERVER_ID}")
    print(f"  Archives PMTiles : {len(archives)}")
    print("  NE PAS utiliser python -m http.server (pas de HTTP Range -> carte grise)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt.")


if __name__ == "__main__":
    main()
