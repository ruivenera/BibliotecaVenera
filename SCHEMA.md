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

---

# Painel — tudo opcional

Além dos itens, a edição pode trazer um `painel` com dados estruturados. A app desenha
cada bloco que exista e ignora os que faltarem, por isso podes mandar só os que fizerem
sentido nesse dia.

**O painel nunca faz falhar a publicação.** Ao contrário dos campos de cima, aqui o
Worker limpa em vez de recusar: um bloco malformado é descartado em silêncio e a edição
publica na mesma. A edição é o que interessa; o painel é o resumo por cima dela.

O painel tem duas metades, como o relatório tinha: **mercado** em cima, **geopolítica**
por baixo, separadas na app.

```json
"painel": {
  "indices": [
    { "nome": "S&P 500", "valor": "7 748,50", "variacao": 0.26, "leitura": "Fecho em alta" }
  ],
  "accoes": [
    { "nome": "NVDA", "valor": "217,48", "variacao": 1.4, "leitura": "Acordo de financiamento" }
  ],
  "carteira": [
    { "nome": "IREN", "valor": "41,10", "variacao": 3.2, "leitura": "Arrastada pelos neoclouds" }
  ],
  "destaque": {
    "nome": "NBIS",
    "descricao": "Nebius Group",
    "valor": "78,20",
    "variacao": 12.4,
    "texto": "Duas ou três frases sobre o movimento do dia."
  },
  "oportunidades": ["Uma linha por oportunidade de mercado."],
  "riscos": ["Uma linha por risco de mercado."],
  "veredicto": {
    "tom": "neutro",
    "titulo": "Pausa longa",
    "texto": "Duas a três frases a fechar a leitura de mercado."
  },

  "geopolitica": {
    "risco": {
      "indice": 72,
      "nivel": "Elevado",
      "tendencia": "sobe",
      "conflitos": 8,
      "alertas": 3,
      "hotspots": "Ormuz, Taiwan",
      "expostos": "energia, transporte marítimo"
    },
    "alertas": [
      { "nivel": "critico", "texto": "Estreito de Ormuz continua fechado ao tráfego civil." }
    ],
    "conflitos": [
      { "nome": "Irão · Ormuz", "probabilidade": "65%", "situacao": "Estreito fechado" }
    ],
    "oportunidades": ["Uma linha por oportunidade geopolítica."],
    "riscos": ["Uma linha por risco a 30 dias."],
    "impacto_carteira": [
      { "nome": "IREN", "sentido": "positivo", "justificacao": "Energia contratada fora da zona de risco." }
    ],
    "veredicto": {
      "tom": "baixa",
      "titulo": "Risco elevado",
      "texto": "Duas a três frases a fechar a leitura geopolítica."
    }
  }
}
```

| Bloco | Regra |
| --- | --- |
| `indices`, `accoes`, `carteira` | até 12 linhas; `nome` obrigatório, `valor` e `leitura` texto, `variacao` número em percentagem |
| `destaque` | precisa de `nome`; o resto é opcional |
| `oportunidades`, `riscos` | até 8 linhas de texto cada |
| `veredicto.tom` | `alta`, `baixa` ou `neutro` — dá a cor |
| `geopolitica.risco.indice` | 0 a 100 |
| `geopolitica.risco.tendencia` | `sobe`, `desce` ou `estavel` |
| `geopolitica.alertas[].nivel` | `critico`, `elevado` ou `moderado` — dá a cor do sinal |
| `geopolitica.conflitos` | até 12 linhas; `nome` obrigatório |
| `geopolitica.impacto_carteira[].sentido` | `positivo`, `neutro` ou `negativo` |

A metade geopolítica aceita os mesmos `oportunidades`, `riscos` e `veredicto` que a de
mercado, e são independentes: uma leitura de mercado pode ser neutra e a geopolítica de
baixa no mesmo dia.

A `variacao` vai como número, não como texto: é a app que lhe põe o sinal, a seta e a cor.
Manda `-2.4`, não `"▼ -2,4%"`.

## Capítulos — para o curso de IA

Cada item pode dizer que capítulo é. A app mostra o número e a rubrica por cima do título.

```json
{ "capitulo": 3, "rubrica": "Código", "titulo": "Uma crew de duas pessoas", "...": "..." }
```

| Campo | Regra |
| --- | --- |
| `capitulo` | 1 a 99 |
| `rubrica` | texto curto, até 40 caracteres (`Conceito`, `Código`, `Ferramenta do dia`, `Desafio`…) |

## Progresso — só para o curso de IA

A rotina de IA é um curso. Pode mandar onde vai:

```json
"progresso": { "dia": 29, "nivel": "Intermédio", "percentagem": 12, "leitura_min": 14 }
```

| Campo | Regra |
| --- | --- |
| `dia` | número da aula |
| `nivel` | texto curto |
| `percentagem` | 0 a 100 |
| `leitura_min` | minutos estimados de leitura |
