#!/usr/bin/env bash
# Publica uma edição na app Venera. Usado pelas routines do Claude Code.
# Uso: ./publicar.sh edicao.json
set -euo pipefail

ficheiro="${1:?uso: ./publicar.sh <ficheiro.json>}"
: "${VENERA_URL:?variável de ambiente VENERA_URL em falta}"
: "${VENERA_TOKEN:?variável de ambiente VENERA_TOKEN em falta}"

[ -f "$ficheiro" ] || { echo "ficheiro não existe: $ficheiro" >&2; exit 1; }

# Falha cedo se o JSON estiver malformado, antes de gastar o pedido.
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$ficheiro" \
  || { echo "JSON inválido em $ficheiro" >&2; exit 1; }

corpo=$(mktemp)
codigo=$(curl -sS --max-time 30 -o "$corpo" -w '%{http_code}' \
  -X POST "${VENERA_URL%/}/api/ingest" \
  -H "Authorization: Bearer ${VENERA_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @"$ficheiro")

echo "HTTP $codigo"
cat "$corpo"; echo

if [ "$codigo" != "200" ]; then
  echo "FALHA: a edição não foi publicada." >&2
  exit 1
fi

echo "OK publicado"
