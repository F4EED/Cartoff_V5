# go-pmtiles

> **Cartoff :** `install.bat` ou `./install.sh` télécharge ici go-pmtiles v1.31.2 (`pmtiles.exe` sous Windows, `pmtiles` sous Linux). Le binaire n’est pas versionné. `extract.py` et `scripts/build_loire_pmtiles.py` l’appellent pour créer une archive. La consultation d’un fond déjà présent n’en a pas besoin. `levelDiff: 0` est dans `js/basemap.js`. Voir [README PMTiles](../README.md).

The single-file utility for creating and working with [PMTiles](https://github.com/protomaps/PMTiles) archives.

## Installation

See [Releases](https://github.com/protomaps/go-pmtiles/releases) for your OS and architecture.

## Docs

See [docs.protomaps.com/pmtiles/cli](https://docs.protomaps.com/pmtiles/cli) for usage.

See [Go package docs](https://pkg.go.dev/github.com/protomaps/go-pmtiles/pmtiles) for API usage.

## Development

Run the program in development:

```sh
go run main.go
```

Run the test suite:

```sh
go test ./pmtiles
```
