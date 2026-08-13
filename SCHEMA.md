# Formato da edição

Grava em `edicao.json` e publica com `./publicar.sh edicao.json`.

```json
{
  "rotina": "financas-geopolitica",
  "data": "2026-08-12",
  "titulo": "Inflação nos EUA trava expectativa de cortes",
  "resumo": "Duas a três frases com o essencial do dia.",
  "itens": [
    {
      "titulo": "IPC acima do consenso",
      "texto": "Parágrafo de 3 a 6 frases. Termina com 'Porque interessa: ...'.",
      "impacto": "alto",
      "fontes": [{ "titulo": "Reuters", "url": "https://www.reuters.com/..." }]
    }
  ]
}
```

| Campo | Regra |
| --- | --- |
| `rotina` | `financas-geopolitica` ou `inteligencia-artificial` |
| `data` | `AAAA-MM-DD`, hoje em UTC |
| `titulo` | 3 a 200 caracteres |
| `resumo` | 20 a 2000 caracteres |
| `itens` | 1 a 20 |
| `itens[].titulo` | 3 a 200 caracteres |
| `itens[].texto` | 40 a 4000 caracteres, termina em `Porque interessa: ...` |
| `itens[].impacto` | `alto`, `medio` ou `baixo` |
| `itens[].fontes` | pelo menos uma, cada uma com `titulo` e `url` em `https` |

Se algo falhar, a resposta é `422` e o campo `detalhes` diz exatamente o quê. Corrige e volta a publicar — a mesma rotina no mesmo dia sobrepõe, não duplica.
