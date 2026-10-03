# Cartoff a besoin de serve.py : HTTP Range (PMTiles) et l'API d'extraction.
# Une image nginx qui ne copie que index.html n'affiche ni le fond ni les calques.
FROM python:3.12-slim

WORKDIR /app

COPY . .

# Les morceaux GitHub sont dans l'image ; l'archive reconstituee ne l'est pas
# (voir .dockerignore). On la recompose ici pour que le fond Loire soit present.
RUN if [ ! -f pmtiles/loire.pmtiles ]; then python scripts/unpack_large_file.py; fi

EXPOSE 8000

CMD ["python", "serve.py", "-p", "8000"]
