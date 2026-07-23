# Examples

## `halo-dashboard.html`

A real, unedited `pulse.html` produced by running mdpulse over
[github.com/halo-format/halo](https://github.com/halo-format/halo) (50 markdown
files). Open it in any browser — it is fully self-contained and needs no
network.

Generated with:

```bash
node dist/cli.js build --dir /path/to/halo
# -> writes .mdpulse/pulse.html
```

Highlights from this run:

- 50/50 files extracted, 0 failures
- 174 features on the map, every one cited (zero uncited/hallucinated entries)
- Features cross-checked against the current code tree (376 paths, 977
  identifiers inventoried) — zero false "doc drift" flags
- 125 metric series, 44 open loops, parsed mermaid architecture diagrams
- 3.4 MB, renders offline
